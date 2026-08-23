import { prisma } from '../../prisma';
import { getSystemSettings } from '../../routes/settings';
import { LimitEngine } from '../LimitEngine';
import { executeTontineCycle, getTontineVaultWallet } from '../tontineService';

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), create: jest.fn() },
        tontineGroup: { findUnique: jest.fn(), update: jest.fn() },
        transaction: { findFirst: jest.fn() },
        wallet: { findUnique: jest.fn() },
        notification: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

jest.mock('../../routes/settings', () => ({
    getSystemSettings: jest.fn(),
}));

jest.mock('../LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn() },
}));

const VAULT_WALLET = { id: 'vault_wallet_1', balance: 0 };

describe('getTontineVaultWallet', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait retourner le wallet du coffre tontine existant', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'vault_user', wallet: VAULT_WALLET });

        const wallet = await getTontineVaultWallet();

        expect(wallet).toBe(VAULT_WALLET);
        expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('devrait créer le compte coffre tontine s\'il n\'existe pas', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'vault_user_new', wallet: VAULT_WALLET });

        const wallet = await getTontineVaultWallet();

        expect(wallet).toBe(VAULT_WALLET);
        expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ phone: '+24155555555', role: 'ADMIN' }),
        }));
    });

    it('devrait lever une exception si le coffre créé n\'a pas de wallet associé', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'vault_user', wallet: null });
        (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'vault_user', wallet: null });

        await expect(getTontineVaultWallet()).rejects.toThrow('Coffre Tontine sans portefeuille associé.');
    });
});

describe('executeTontineCycle', () => {
    const buildDebitTx = () => ({
        wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
        transaction: { create: jest.fn().mockResolvedValue({}) },
        notification: { create: jest.fn().mockResolvedValue({}) },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'vault_user', wallet: VAULT_WALLET });
        (getSystemSettings as jest.Mock).mockResolvedValue({});
        (LimitEngine.verifyAndIncrementConsumption as jest.Mock).mockResolvedValue(undefined);
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(buildDebitTx()));
        (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({});
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

    it('devrait compter une cotisation déjà débitée (idempotence) sans re-débiter', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u1', status: 'ACTIVE', payoutOrder: 2 }],
        });
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValueOnce({ status: 'COMPLETED', amount: 5000 });

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
        // 3 appels : idempotence débit u1, idempotence débit u2, idempotence versement (u2)
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

    it('ne devrait pas reverser si le versement a déjà été effectué (idempotence payout)', async () => {
        (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
            id: 'g1', name: 'Groupe A', currentCycle: 1, contribution: 5000,
            participants: [{ userId: 'u2', status: 'ACTIVE', payoutOrder: 1 }],
        });
        // Débit déjà comptabilisé pour u2 (idempotence) ET versement déjà effectué (idempotence) :
        // les deux vérifications interrogent transaction.findFirst et doivent toutes deux
        // trouver une transaction COMPLETED existante.
        (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({ status: 'COMPLETED', amount: 5000 });

        const result = await executeTontineCycle('g1');

        expect(result.debitedCount).toBe(1);
        expect(result.totalPot).toBe(5000);
        expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('devrait rejeter (throw non catché) si le coffre est insuffisant pour le versement', async () => {
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

        await expect(executeTontineCycle('g1')).rejects.toThrow('Coffre Tontine insuffisant pour ce paiement.');
    });
});
