import { prisma } from '../../prisma';
import { getSystemSettings } from '../../routes/settings';
import { sendPush } from '../../routes/wallet';
import { LimitEngine } from '../LimitEngine';
import { contributeNow, executeTontineCycle, getTontineVaultWallet, notifyUpcomingCycle, resolveRenewalPoll, retryFailedContributions } from '../tontineService';

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), create: jest.fn() },
        systemAccount: { upsert: jest.fn() },
        tontineGroup: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        tontineParticipant: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
        tontineCycle: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
        tontineContribution: { upsert: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
        transaction: { findFirst: jest.fn() },
        wallet: { findUnique: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
        $transaction: jest.fn(),
    },
}));

jest.mock('../../routes/settings', () => ({
    getSystemSettings: jest.fn(),
}));

jest.mock('../../routes/wallet', () => ({
    sendPush: jest.fn(),
    getOrCreateCorporateWallet: jest.fn().mockResolvedValue({ wallet: { id: 'w_corporate', balance: 0 } }),
}));

jest.mock('../LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn() },
}));

const VAULT_WALLET = { id: 'vault_wallet_1', balance: 0 };

describe('getTontineVaultWallet', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait retourner le wallet du coffre tontine (upsert par kind, existant ou créé)', async () => {
        (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'sa_vault', kind: 'TONTINE_VAULT', wallet: VAULT_WALLET });

        const wallet = await getTontineVaultWallet();

        expect(wallet).toBe(VAULT_WALLET);
        expect(prisma.systemAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { kind: 'TONTINE_VAULT' },
            create: expect.objectContaining({ kind: 'TONTINE_VAULT', name: 'COFFRE TONTINE (SYSTEME)' }),
        }));
    });

    it('devrait lever une exception si le coffre n\'a pas de wallet associé', async () => {
        (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'sa_vault', wallet: null });

        await expect(getTontineVaultWallet()).rejects.toThrow('Coffre Tontine sans portefeuille associé.');
    });
});

describe('executeTontineCycle', () => {
    // amount/status par défaut = un dépôt unique qui complète toute la part (5000, la
    // valeur de `contribution` utilisée par tous les groupes de ce describe) : reflète le
    // comportement historique "un seul prélèvement pour tout le montant" que ces tests
    // vérifient. collectParticipantContribution lit désormais amount/status directement sur
    // le retour de cet upsert (incrément atomique côté base, voir tontineService.ts) plutôt
    // que de le recalculer lui-même — le mock doit donc renvoyer le total déjà à jour.
    const buildDebitTx = () => ({
        wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        tontineContribution: {
            // Relecture fraîche à l'intérieur de la transaction (voir tontineService.ts) —
            // personne n'a encore rien versé pour ce cycle dans ces tests.
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'contrib_1', amount: 5000, status: 'PAID' }),
            update: jest.fn().mockResolvedValue({}),
        },
        notification: { create: jest.fn().mockResolvedValue({}) },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'sa_vault', kind: 'TONTINE_VAULT', wallet: VAULT_WALLET });
        (getSystemSettings as jest.Mock).mockResolvedValue({});
        (LimitEngine.verifyAndIncrementConsumption as jest.Mock).mockResolvedValue(undefined);
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(buildDebitTx()));
        (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({});
        (prisma.tontineCycle.upsert as jest.Mock).mockResolvedValue({ id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 1, totalCollected: 0 });
        (prisma.tontineCycle.update as jest.Mock).mockResolvedValue({});
        (prisma.tontineContribution.upsert as jest.Mock).mockResolvedValue({});
        // Baseline "personne n'a encore rien versé pour ce cycle" — jest.clearAllMocks() ne
        // réinitialise QUE l'historique d'appels, jamais une implémentation posée par un test
        // précédent (mockResolvedValue). Sans cette ligne, le test "devrait compter une
        // cotisation déjà entièrement versée" (qui positionne amount:5000 ci-dessous) polluait
        // tous les tests suivants du describe : chacun voyait alors ce participant comme déjà
        // entièrement payé et sautait silencieusement le débit réel.
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue(null);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        (console.log as jest.Mock).mockRestore();
    });

    it('devrait retourner un échec si le groupe est introuvable', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

        const result = await executeTontineCycle('group_missing');

        expect(result).toEqual({ success: false, message: 'Group not found' });
    });

    it('devrait ignorer les participants non ACTIVE', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u1', status: 'PAUSED', payoutOrder: 1 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(0);
        expect(result.failedCount).toBe(0);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('devrait ouvrir un sondage de relance (PENDING_RENEWAL) et ne rien prélever si tous les participants actifs ont déjà reçu leur cagnotte', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', status: 'ACTIVE', currentCycle: 3, contribution: 5000,
            participants: [
                { userId: 'u1', status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: true, user: { pushToken: 'tok1' } },
                { userId: 'u2', status: 'ACTIVE', payoutOrder: 2, hasReceivedPayout: true, user: { pushToken: 'tok2' } },
            ],
        });

        const result = await executeTontineCycle('g1');

        expect(result.completed).toBe(true);
        expect(result.debitedCount).toBe(0);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
        expect(prisma.tontineCycle.upsert).not.toHaveBeenCalled();
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'g1' },
            data: expect.objectContaining({ status: 'PENDING_RENEWAL', renewalDeadline: expect.any(Date) }),
        }));
        expect(prisma.tontineParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { renewalVote: null },
        }));
        expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ userId: 'u1', title: 'Tontine terminée — continuer ?' })]),
        }));
        expect(sendPush).toHaveBeenCalledTimes(2);
    });

    it('devrait marquer le groupe COMPLETED sans sondage si plus aucun participant actif ne reste', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', status: 'ACTIVE', currentCycle: 3, contribution: 5000,
            participants: [{ userId: 'u1', status: 'LEFT', payoutOrder: 1, hasReceivedPayout: true }],
        });

        const result = await executeTontineCycle('g1');

        expect(result.completed).toBe(true);
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { status: 'COMPLETED' } });
        expect(prisma.notification.createMany).not.toHaveBeenCalled();
        expect(sendPush).not.toHaveBeenCalled();
    });

    it('ne devrait rien refaire si le groupe est déjà en sondage de relance (idempotence)', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', status: 'PENDING_RENEWAL', currentCycle: 3, contribution: 5000,
            participants: [{ userId: 'u1', status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: true, user: { pushToken: 'tok1' } }],
        });

        const result = await executeTontineCycle('g1');

        expect(result.completed).toBe(true);
        expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
        expect(prisma.notification.createMany).not.toHaveBeenCalled();
        expect(sendPush).not.toHaveBeenCalled();
    });

    it('devrait compter une cotisation déjà entièrement versée (dépôt libre déjà complet) sans re-débiter', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        // Contrairement à l'ancien modèle (idempotence par référence Transaction exacte),
        // "déjà payé" se lit désormais sur le montant CUMULÉ de TontineContribution.
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 5000, status: 'PAID' });

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(1);
        expect(result.totalPot).toBe(5000);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('devrait marquer un échec si le wallet du participant est introuvable', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

        const result = await executeTontineCycle('g1');

        expect(result.failedCount).toBe(1);
        expect(result.debitedCount).toBe(0);
    });

    it('devrait débiter avec succès un participant et incrémenter le pot', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(1);
        expect(result.totalPot).toBe(5000);
        expect(LimitEngine.verifyAndIncrementConsumption).toHaveBeenCalled();
    });

    it('devrait notifier un échec et incrémenter failedCount si le solde est insuffisant', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        const failingTx = buildDebitTx();
        failingTx.wallet.updateMany.mockResolvedValue({ count: 0 });
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(failingTx));

        const result = await executeTontineCycle('g1');

        expect(result.failedCount).toBe(1);
        expect(result.debitedCount).toBe(0);
        expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ userId: 'u1', title: expect.stringContaining('Échec Cotisation') }),
        }));
    });

    it("ne devrait appliquer aucune pénalité de retard si le taux configuré est à 0 (défaut)", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        const failingTx = buildDebitTx();
        failingTx.wallet.updateMany.mockResolvedValue({ count: 0 });
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(failingTx));
        // getSystemSettings() renvoie {} par défaut dans ce describe (voir beforeEach) —
        // tontineLatePenaltyRate est donc undefined, pas 0 explicitement : le garde-fou doit
        // traiter les deux cas de façon identique (voir le commentaire sur `!(x > 0)`).

        const result = await executeTontineCycle('g1');

        expect(result.failedCount).toBe(1);
        // Un seul appel $transaction (le débit de cotisation, en échec) — aucune tentative de
        // pénalité ne doit avoir ouvert une seconde transaction.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("devrait prélever la pénalité de retard quand le taux est configuré et que le solde le permet", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ tontineLatePenaltyRate: 0.05 });
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        // Trois appels à prisma.tontineContribution.findUnique se succèdent ici : (1) la boucle
        // principale calcule `remaining` avant d'appeler collectParticipantContribution, (2) le
        // catch de collectParticipantContribution re-lit le total déjà versé après l'échec du
        // débit (voir tontineService.ts ~L161), et seulement (3) applyLatePenaltyIfDue lit la
        // ligne pour vérifier si une pénalité a déjà été appliquée. Oublier l'appel (2) décale
        // silencieusement la queue de mocks et fait fuiter une valeur non consommée vers les
        // tests suivants (déjà vécu une fois avec ce fichier).
        (prisma.tontineContribution.findUnique as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'contrib_1', penaltyAppliedAt: null, penaltyAmount: 0 });

        const failingContributionTx = buildDebitTx();
        failingContributionTx.wallet.updateMany.mockResolvedValue({ count: 0 }); // Solde insuffisant pour la cotisation pleine.
        const penaltyTx = {
            wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
            transaction: { create: jest.fn().mockResolvedValue({}) },
            tontineContribution: { update: jest.fn().mockResolvedValue({}) },
            notification: { create: jest.fn().mockResolvedValue({}) },
        };
        (prisma.$transaction as jest.Mock)
            .mockImplementationOnce((cb: any) => cb(failingContributionTx))
            .mockImplementationOnce((cb: any) => cb(penaltyTx));

        const result = await executeTontineCycle('g1');

        expect(result.failedCount).toBe(1);
        // 5000 * 5% = 250 FCFA de pénalité.
        expect(penaltyTx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wallet_u1', balance: { gte: 250 } },
        }));
        expect(penaltyTx.transaction.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ amount: 250, reference: 'FEE-TLP-contrib_1', senderWalletId: 'wallet_u1' }),
        }));
        expect(penaltyTx.tontineContribution.update).toHaveBeenCalledWith({
            where: { id: 'contrib_1' },
            data: { penaltyAmount: 250, penaltyAppliedAt: expect.any(Date) },
        });
        expect(penaltyTx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ userId: 'u1', title: expect.stringContaining('Pénalité de retard') }),
        }));
    });

    it("ne devrait pas re-facturer une pénalité déjà appliquée pour ce cycle (relance)", async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ tontineLatePenaltyRate: 0.05 });
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        // Même séquence à trois appels que le test précédent (boucle principale, catch de
        // collectParticipantContribution, puis applyLatePenaltyIfDue) — voir le commentaire
        // détaillé plus haut. Le 3e appel renvoie ici une pénalité déjà appliquée.
        (prisma.tontineContribution.findUnique as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'contrib_1', penaltyAppliedAt: new Date('2026-08-01'), penaltyAmount: 250 });

        const failingContributionTx = buildDebitTx();
        failingContributionTx.wallet.updateMany.mockResolvedValue({ count: 0 });
        (prisma.$transaction as jest.Mock).mockImplementationOnce((cb: any) => cb(failingContributionTx));

        const result = await executeTontineCycle('g1');

        expect(result.failedCount).toBe(1);
        // Une seule transaction ouverte (le débit de cotisation) — la pénalité déjà appliquée
        // n'a pas rouvert de seconde transaction pour re-débiter.
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('devrait verser la cagnotte au bénéficiaire du cycle courant', async () => {
        // Le bénéficiaire du cycle cotise aussi comme tout autre participant ACTIF :
        // la cagnotte versée est la somme des cotisations de TOUS les participants actifs,
        // bénéficiaire inclus (voir la boucle unique sans exclusion dans tontineService.ts).
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [
                { userId: 'u1', status: 'ACTIVE', payoutOrder: 2 },
                { userId: 'u2', status: 'ACTIVE', payoutOrder: 1 },
            ],
        });
        // Idempotence du versement (payoutBeneficiaryIfDue) : aucun versement existant.
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockImplementation(({ where }: any) =>
            Promise.resolve(where.userId === 'u1' ? { id: 'wallet_u1' } : { id: 'wallet_u2' })
        );

        const payoutTx = { wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) }, transaction: { create: jest.fn().mockResolvedValue({}) }, tontineParticipant: { update: jest.fn().mockResolvedValue({}) }, notification: { create: jest.fn().mockResolvedValue({}) } };
        const debitTxU1 = buildDebitTx();
        const debitTxU2 = buildDebitTx();
        (prisma.$transaction as jest.Mock)
            .mockImplementationOnce((cb: any) => cb(debitTxU1))
            .mockImplementationOnce((cb: any) => cb(debitTxU2))
            .mockImplementationOnce((cb: any) => cb(payoutTx));

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(2);
        expect(result.totalPot).toBe(10000);
        expect(payoutTx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wallet_u2' },
            data: { balance: { increment: 10000 } },
        }));
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { currentCycle: 2 } });
    });

    it('ne devrait pas reverser si le versement a déjà été effectué (idempotence payout), et ne pas re-débiter un participant déjà complet', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ id: 'p2', userId: 'u2', status: 'ACTIVE', payoutOrder: 1 }],
        });
        // Cotisation déjà complète (dépôt libre) : on ne re-débite pas, voir test précédent.
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 5000, status: 'PAID' });
        // Versement déjà effectué (idempotence payout, inchangée — toujours par référence
        // Transaction exacte, contrairement à la collecte).
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({ status: 'COMPLETED', amount: 5000, id: 'existing_payout_tx' });

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(1);
        expect(result.totalPot).toBe(5000);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('ne devrait plus rejeter mais marquer le cycle PAYOUT_FAILED si le coffre est insuffisant pour le versement', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u2', status: 'ACTIVE', payoutOrder: 1 }],
        });
        (prisma.transaction.findFirst as jest.Mock)
            .mockResolvedValueOnce(null) // debit idempotency
            .mockResolvedValueOnce(null); // payout idempotency
        (prisma.wallet.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'wallet_u2' }) // debit lookup
            .mockResolvedValueOnce({ id: 'wallet_u2' }); // beneficiary lookup

        const debitTx = buildDebitTx();
        const payoutTx = { wallet: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn() }, transaction: { create: jest.fn() }, notification: { create: jest.fn() } };
        (prisma.$transaction as jest.Mock)
            .mockImplementationOnce((cb: any) => cb(debitTx))
            .mockImplementationOnce((cb: any) => cb(payoutTx));
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        const result = await executeTontineCycle('g1');

        expect(result.success).toBe(true);
        expect(result.payoutFailed).toBe(true);
        expect(prisma.tontineCycle.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PAYOUT_FAILED', payoutTransactionId: null }),
        }));
        // Le bénéficiaire visé doit rester le même tant que le versement n'a pas réellement
        // abouti — currentCycle ne doit donc pas avancer.
        expect(prisma.tontineGroup.update).not.toHaveBeenCalled();

        (console.error as jest.Mock).mockRestore();
    });
});

describe('contributeNow', () => {
    // collectParticipantContribution lit désormais amount/status directement sur le retour
    // de l'upsert (incrément atomique côté base — voir tontineService.ts, pour éviter une
    // perte de mise à jour si deux dépôts du même participant s'exécutent en parallèle) : le
    // mock doit donc renvoyer le total CUMULÉ attendu après ce dépôt précis, pas juste 5000
    // par défaut comme pour un prélèvement plein et unique.
    const buildDebitTx = (returnedAmount = 5000, status = 'PAID', priorAmount: number | null = null) => ({
        wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        tontineContribution: {
            // Relecture fraîche à l'intérieur de la transaction (voir tontineService.ts,
            // le plafonnement anti-sur-collecte en cas de dépôt concurrent) — reflète ce qui
            // a déjà été versé AVANT ce dépôt précis, pas après.
            findUnique: jest.fn().mockResolvedValue(priorAmount !== null ? { amount: priorAmount } : null),
            upsert: jest.fn().mockResolvedValue({ id: 'contrib_1', amount: returnedAmount, status }),
            update: jest.fn().mockResolvedValue({}),
        },
        notification: { create: jest.fn().mockResolvedValue({}) },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'sa_vault', kind: 'TONTINE_VAULT', wallet: VAULT_WALLET });
        (getSystemSettings as jest.Mock).mockResolvedValue({});
        (LimitEngine.verifyAndIncrementConsumption as jest.Mock).mockResolvedValue(undefined);
        (prisma.tontineCycle.upsert as jest.Mock).mockResolvedValue({ id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 1 });
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(buildDebitTx()));
    });

    const GROUP = {
        id: 'g1', name: 'Groupe A', status: 'ACTIVE', isPaused: false, currentCycle: 1, contribution: 5000, lastPayoutDate: null,
        participants: [
            { id: 'p1', userId: 'u1', status: 'ACTIVE' },
            { id: 'p2', userId: 'u2', status: 'ACTIVE' },
        ],
    };

    it('devrait rejeter un montant invalide', async () => {
        await expect(contributeNow('g1', 'u1', 0)).rejects.toThrow('montant valide');
        await expect(contributeNow('g1', 'u1', -100)).rejects.toThrow('montant valide');
        await expect(contributeNow('g1', 'u1', NaN)).rejects.toThrow('montant valide');
    });

    it("devrait rejeter si le club n'est pas actif", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ ...GROUP, status: 'PENDING_RENEWAL' });
        await expect(contributeNow('g1', 'u1', 2000)).rejects.toThrow("n'accepte pas de cotisation");
    });

    it('devrait rejeter si le club est en pause administrative', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ ...GROUP, isPaused: true });
        await expect(contributeNow('g1', 'u1', 2000)).rejects.toThrow('pause administrative');
    });

    it("devrait rejeter si l'appelant n'est pas membre actif du club", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        await expect(contributeNow('g1', 'u_inconnu', 2000)).rejects.toThrow("pas membre actif");
    });

    it('devrait rejeter si la personne a déjà entièrement cotisé pour ce tour', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 5000, status: 'PAID' });

        await expect(contributeNow('g1', 'u1', 1000)).rejects.toThrow('déjà entièrement cotisé');
    });

    it('devrait rejeter un dépôt supérieur au solde restant dû', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 3000, status: 'PARTIAL' });

        // toLocaleString('fr-FR') insère une espace fine insécable (pas une espace normale)
        // entre les milliers — on n'assert donc pas sur le nombre formaté, seulement le texte.
        await expect(contributeNow('g1', 'u1', 3000)).rejects.toThrow('Il ne vous reste que');
    });

    it('devrait accepter un dépôt partiel (montant libre, inférieur à la part) sans déclencher le versement', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(0); // personne n'a encore fini
        const tx = buildDebitTx(2000, 'PARTIAL');
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        const result = await contributeNow('g1', 'u1', 2000);

        expect(result).toEqual({ success: true, payoutTriggered: false, amountPaid: 2000, totalPaid: 2000, remaining: 3000 });
        expect(prisma.tontineGroup.updateMany).not.toHaveBeenCalled();
        // Régression : le cumul doit être un incrément ATOMIQUE côté base (amount: {increment}),
        // jamais une valeur absolue recalculée à partir d'une lecture antérieure au $transaction
        // — sinon deux dépôts du même participant exécutés en parallèle (double-tap, retry
        // réseau, deux appareils) peuvent s'écraser l'un l'autre (perte de mise à jour).
        expect(tx.tontineContribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ amount: { increment: 2000 } }),
        }));
    });

    it('devrait cumuler un second dépôt par-dessus le premier pour le même tour', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 2000, status: 'PARTIAL' });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(1);
        // L'incrément atomique (2000 déjà versés + 3000 ce dépôt) donne 5000 — simulé ici
        // directement sur le retour de l'upsert, comme le ferait la vraie base de données.
        const tx = buildDebitTx(5000, 'PAID', 2000);
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        const result = await contributeNow('g1', 'u1', 3000);

        expect(result).toEqual({ success: true, payoutTriggered: false, amountPaid: 3000, totalPaid: 5000, remaining: 0 });
        // Pas de plafonnement ici : 2000 déjà versés + 3000 demandés = 5000 pile, le montant
        // demandé passe intact (voir le test suivant pour le cas où il faut plafonner).
        expect(tx.tontineContribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ amount: { increment: 3000 } }),
        }));
    });

    it("devrait plafonner un dépôt concurrent qui dépasserait la part si quelqu'un d'autre (CRON ou une autre requête) a déjà complété entre-temps", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u1' });
        // Au moment où contributeNow décide (lecture hors transaction), il restait 3000 FCFA.
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 2000, status: 'PARTIAL' });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(1);
        // Mais entre cette décision et l'ouverture de la transaction, un dépôt concurrent
        // (CRON automatique par exemple) a déjà porté le total à 4000 — il ne reste donc
        // réellement que 1000 FCFA, pas les 3000 initialement demandés.
        const tx = buildDebitTx(5000, 'PAID', 4000);
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        await contributeNow('g1', 'u1', 3000);

        expect(tx.tontineContribution.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ amount: { increment: 1000 } }),
        }));
    });

    it('devrait déclencher le versement immédiatement dès que tous les participants actifs ont fini de cotiser', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u2' });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(2); // les 2 actifs ont fini
        (prisma.tontineGroup.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const result = await contributeNow('g1', 'u2', 5000);

        expect(result.payoutTriggered).toBe(true);
        expect(prisma.tontineGroup.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'g1', lastPayoutDate: null },
        }));
        // executeTontineCycle recharge le groupe lui-même : un second findUnique a bien eu lieu.
        expect((prisma.tontineGroup.findUnique as jest.Mock).mock.calls.length).toBeGreaterThan(1);
    });

    it("ne devrait pas re-déclencher le versement si le CRON l'a déjà réclamé au même instant", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(GROUP);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_u2' });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(2);
        (prisma.tontineGroup.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

        const result = await contributeNow('g1', 'u2', 5000);

        expect(result.payoutTriggered).toBe(false);
    });
});

describe('retryFailedContributions', () => {
    const buildPayoutTx = () => ({
        wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
        transaction: { create: jest.fn().mockResolvedValue({ id: 'tx_payout' }) },
        tontineParticipant: { update: jest.fn().mockResolvedValue({}) },
        notification: { create: jest.fn().mockResolvedValue({}) },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'sa_vault', kind: 'TONTINE_VAULT', wallet: VAULT_WALLET });
        (getSystemSettings as jest.Mock).mockResolvedValue({});
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(0);
        (prisma.tontineCycle.update as jest.Mock).mockResolvedValue({});
        (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({});
    });

    it('devrait relancer le versement d\'un cycle PAYOUT_FAILED (collecte réussie, aucune cotisation à rattraper) et avancer currentCycle', async () => {
        (prisma.tontineCycle.findUnique as jest.Mock).mockResolvedValue({
            id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 3, totalCollected: 10000,
            payoutTransactionId: null, beneficiaryParticipantId: 'p_ben', contributions: [],
        });
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Groupe A', contribution: 5000, currentCycle: 3 });
        (prisma.tontineParticipant.findUnique as jest.Mock).mockResolvedValue({ id: 'p_ben', userId: 'u_ben' });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_ben' });
        const payoutTx = buildPayoutTx();
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(payoutTx));

        const result = await retryFailedContributions('g1', 'cycle_1');

        expect(result.retriedCount).toBe(0);
        expect(result.payoutResolved).toBe(true);
        expect(payoutTx.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'wallet_ben' }, data: { balance: { increment: 10000 } },
        }));
        expect(prisma.tontineCycle.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ payoutTransactionId: 'tx_payout', status: 'COMPLETED' }),
        }));
        // Le groupe était toujours sur ce cycle (3) : la résolution du versement bloqué
        // rattrape l'avancement qui n'avait pas eu lieu lors de l'exécution d'origine.
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { currentCycle: 4 } });
    });

    it('ne devrait pas toucher currentCycle si le groupe a déjà avancé au-delà de ce cycle', async () => {
        (prisma.tontineCycle.findUnique as jest.Mock).mockResolvedValue({
            id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 3, totalCollected: 10000,
            payoutTransactionId: null, beneficiaryParticipantId: 'p_ben', contributions: [],
        });
        // Le groupe est déjà au cycle 5 : ce retry concerne un vieux cycle depuis rattrapé
        // autrement (ou dont l'avancement a déjà eu lieu) — ne pas le faire régresser/sauter.
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Groupe A', contribution: 5000, currentCycle: 5 });
        (prisma.tontineParticipant.findUnique as jest.Mock).mockResolvedValue({ id: 'p_ben', userId: 'u_ben' });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_ben' });
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(buildPayoutTx()));

        await retryFailedContributions('g1', 'cycle_1');

        expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
    });

    it('ne devrait pas retenter le versement si le cycle a déjà un payoutTransactionId', async () => {
        (prisma.tontineCycle.findUnique as jest.Mock).mockResolvedValue({
            id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 3, totalCollected: 10000,
            payoutTransactionId: 'already_paid', beneficiaryParticipantId: 'p_ben', contributions: [],
        });
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Groupe A', contribution: 5000, currentCycle: 4 });

        const result = await retryFailedContributions('g1', 'cycle_1');

        expect(prisma.tontineParticipant.findUnique).not.toHaveBeenCalled();
        expect(prisma.tontineCycle.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ payoutTransactionId: 'already_paid' }),
        }));
        expect(result.retriedCount).toBe(0);
        expect(result.payoutResolved).toBe(false);
    });

    it('devrait ne prélever que le solde restant dû pour une cotisation PARTIAL (dépôt libre incomplet)', async () => {
        (prisma.tontineCycle.findUnique as jest.Mock).mockResolvedValue({
            id: 'cycle_1', tontineGroupId: 'g1', cycleNumber: 3, totalCollected: 2000, payoutTransactionId: null, beneficiaryParticipantId: 'p_ben',
            contributions: [
                { participantId: 'p_late', amount: 2000, status: 'PARTIAL', participant: { userId: 'u_late', status: 'ACTIVE' } },
            ],
        });
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Groupe A', contribution: 5000, currentCycle: 3 });
        (prisma.tontineParticipant.findUnique as jest.Mock).mockResolvedValue({ id: 'p_ben', userId: 'u_ben' });
        (prisma.tontineContribution.findUnique as jest.Mock).mockResolvedValue({ amount: 2000, status: 'PARTIAL' });
        (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'wallet_late' });
        // taxP2P explicite (0) : le bloc englobant mock getSystemSettings à `{}`, où
        // `settings.taxP2P` vaut undefined — `amount * undefined` produirait NaN et fausserait
        // l'assertion exacte sur le montant décrémenté ci-dessous.
        (getSystemSettings as jest.Mock).mockResolvedValue({ taxP2P: 0 });
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(0);
        // 2 000 déjà versés + 3 000 relancés ici = 5 000, la part complète — simulé
        // directement sur le retour de l'upsert, comme le ferait l'incrément atomique réel.
        const debitTx = {
            wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
            transaction: { create: jest.fn().mockResolvedValue({ id: 'tx_debit' }) },
            tontineContribution: {
                // Relecture fraîche dans la transaction (plafonnement anti-sur-collecte) :
                // les 2000 déjà versés, cohérent avec le mock hors-transaction ci-dessus.
                findUnique: jest.fn().mockResolvedValue({ amount: 2000, status: 'PARTIAL' }),
                upsert: jest.fn().mockResolvedValue({ id: 'contrib_late', amount: 5000, status: 'PAID' }),
                update: jest.fn().mockResolvedValue({}),
            },
            notification: { create: jest.fn().mockResolvedValue({}) },
        };
        const payoutTx = buildPayoutTx();
        (prisma.$transaction as jest.Mock)
            .mockImplementationOnce((cb: any) => cb(debitTx))
            .mockImplementationOnce((cb: any) => cb(payoutTx));
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

        const result = await retryFailedContributions('g1', 'cycle_1');

        // Il ne restait que 3 000 FCFA à cotiser (5 000 - 2 000 déjà versés) — pas les 5 000
        // FCFA complets, qui auraient re-débité ce qui avait déjà été payé.
        expect(debitTx.wallet.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { balance: { decrement: 3000 } },
        }));
        expect(result.retriedCount).toBe(1);
        expect(result.recovered).toBe(3000);
    });
});

describe('resolveRenewalPoll', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.tontineParticipant.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
        (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({});
        (prisma.notification.createMany as jest.Mock).mockResolvedValue({});
    });

    it("ne devrait rien faire si le groupe n'est pas en sondage de relance", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', status: 'ACTIVE' });

        const result = await resolveRenewalPoll('g1');

        expect(result).toEqual({ resolved: false });
        expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
    });

    it('devrait redémarrer une nouvelle boucle si au moins 2 participants ont voté YES, SANS remettre currentCycle à 1 (collision sinon avec la boucle précédente)', async () => {
        const tx = { tontineParticipant: { update: jest.fn().mockResolvedValue({}) } };
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', status: 'PENDING_RENEWAL', currentCycle: 6,
            participants: [
                { id: 'p1', userId: 'u1', renewalVote: 'YES', user: { pushToken: 'tok1' } },
                { id: 'p2', userId: 'u2', renewalVote: 'YES', user: { pushToken: 'tok2' } },
                { id: 'p3', userId: 'u3', renewalVote: 'NO', user: { pushToken: 'tok3' } },
            ],
        });
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        const result = await resolveRenewalPoll('g1');

        expect(result).toEqual({ resolved: true, restarted: true, stayers: 2, leavers: 1 });
        expect(prisma.tontineParticipant.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['p3'] } },
            data: { status: 'LEFT' },
        });
        // currentCycle (6) n'est PAS réinitialisé à 1 : ce numéro a déjà servi lors de la
        // boucle précédente (même TontineGroup.id) — le réutiliser recréerait exactement la
        // même référence d'idempotence TONT_DBT_G{id}_C1_U{userId} qu'alors pour tout
        // participant qui continue, le faisant traiter comme "déjà payé" sans débit réel.
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
            where: { id: 'g1' },
            data: { status: 'ACTIVE', lastPayoutDate: null, renewalDeadline: null },
        });
        expect((prisma.tontineGroup.update as jest.Mock).mock.calls[0][0].data).not.toHaveProperty('currentCycle');
        // Le payoutOrder de la nouvelle boucle continue à partir de currentCycle (6, 7) plutôt
        // que de repartir à 1 — sinon plus personne ne matcherait jamais
        // `payoutOrder === group.currentCycle` puisque currentCycle ne redescend jamais.
        expect(tx.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { payoutOrder: 6, hasReceivedPayout: false, renewalVote: null } });
        expect(tx.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { payoutOrder: 7, hasReceivedPayout: false, renewalVote: null } });
        expect(sendPush).toHaveBeenCalledTimes(3); // 1 retiré + 2 relancés
    });

    it("ne devrait pas relancer et terminer définitivement le groupe si moins de 2 ont voté YES (silence = refus)", async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', status: 'PENDING_RENEWAL',
            participants: [
                { id: 'p1', userId: 'u1', renewalVote: 'YES', user: { pushToken: 'tok1' } },
                { id: 'p2', userId: 'u2', renewalVote: null, user: { pushToken: 'tok2' } }, // n'a jamais répondu
            ],
        });

        const result = await resolveRenewalPoll('g1');

        expect(result).toEqual({ resolved: true, restarted: false, stayers: 1, leavers: 1 });
        expect(prisma.tontineParticipant.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['p2'] } },
            data: { status: 'LEFT' },
        });
        expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
            where: { id: 'g1' },
            data: { status: 'COMPLETED', renewalDeadline: null },
        });
    });
});

describe('notifyUpcomingCycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('ne devrait rien notifier si le groupe n\'a aucun participant actif', async () => {
        (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([]);

        await notifyUpcomingCycle({ id: 'g1', name: 'Groupe A', contribution: 5000 });

        expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('devrait notifier chaque participant actif avec le montant et le nom du groupe', async () => {
        (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([
            { userId: 'u1', user: { pushToken: 'token-1' } },
            { userId: 'u2', user: { pushToken: null } },
        ]);

        await notifyUpcomingCycle({ id: 'g1', name: 'Groupe A', contribution: 5000 });

        expect(prisma.tontineParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { tontineGroupId: 'g1', status: 'ACTIVE' },
        }));
        expect(prisma.notification.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ userId: 'u1', title: expect.stringContaining('demain'), body: expect.stringContaining('5000') }),
                expect.objectContaining({ userId: 'u2', title: expect.stringContaining('demain'), body: expect.stringContaining('Groupe A') }),
            ],
        });
    });

    // Régression : ce rappel n'était auparavant qu'un Notification en base, jamais vu avant
    // le prélèvement du lendemain par qui n'ouvre pas l'app entre-temps — voir cron.ts.
    it('devrait aussi envoyer un push à chaque participant actif', async () => {
        (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([
            { userId: 'u1', user: { pushToken: 'token-1' } },
            { userId: 'u2', user: { pushToken: null } },
        ]);

        await notifyUpcomingCycle({ id: 'g1', name: 'Groupe A', contribution: 5000 });

        expect(sendPush).toHaveBeenCalledTimes(2);
        expect(sendPush).toHaveBeenCalledWith('token-1', expect.stringContaining('demain'), expect.stringContaining('Groupe A'));
        expect(sendPush).toHaveBeenCalledWith(null, expect.any(String), expect.any(String));
    });
});
