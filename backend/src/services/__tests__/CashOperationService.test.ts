import { prisma } from '../../prisma';
import { CashOperationService } from '../CashOperationService';

// Même convention que vaultService.test.ts/tontineService.test.ts : '../../routes/wallet' est
// mocké dans son ensemble (getOrCreateCorporateWallet + sendPush) pour isoler CashOperationService
// de l'implémentation réelle d'Expo — seul le FAIT d'appeler sendPush(), avec les bons
// arguments, nous intéresse ici, jamais la livraison Expo elle-même.
const mockGetOrCreateCorporateWallet = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../../routes/wallet', () => ({
    getOrCreateCorporateWallet: (...args: any[]) => mockGetOrCreateCorporateWallet(...args),
    sendPush: (...args: any[]) => mockSendPush(...args),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        transaction: { findUnique: jest.fn() },
        cashSession: { findFirst: jest.fn(), update: jest.fn() },
        branch: { findUnique: jest.fn(), update: jest.fn() },
        user: { findUnique: jest.fn() },
        wallet: { update: jest.fn() },
        notification: { create: jest.fn() },
        $executeRaw: jest.fn(),
        $transaction: jest.fn(),
    },
}));

function buildDepositTx(overrides: Partial<Record<string, any>> = {}) {
    return {
        transaction: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'tx_1', type: 'CASH_IN', amount: 5000 }),
        },
        cashSession: {
            findFirst: jest.fn().mockResolvedValue({ id: 'sess_1', status: 'OPEN', tellerId: 'teller_1', branchId: 'branch_1' }),
            update: jest.fn().mockResolvedValue({}),
        },
        branch: {
            findUnique: jest.fn().mockResolvedValue({ id: 'branch_1', status: 'ACTIVE', wallet: { id: 'w_branch', balance: 100000 } }),
            update: jest.fn().mockResolvedValue({}),
        },
        user: {
            // pushToken truthy : c'est précisément le cas qui doit déclencher sendPush — un
            // client réel dont le téléphone a bien enregistré son token auprès du serveur.
            findUnique: jest.fn().mockResolvedValue({ id: 'client_1', accountStatus: 'ACTIVE', pushToken: 'ExponentPushToken[client]', wallet: { id: 'w_client', balance: 1000 } }),
        },
        wallet: { update: jest.fn().mockResolvedValue({}) },
        notification: { create: jest.fn().mockResolvedValue({}) },
        $executeRaw: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    } as any;
}

describe('CashOperationService.executeCashIn', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("pousse une notification Expo (sendPush) au client crédité, en plus de la ligne Notification en base", async () => {
        const tx = buildDepositTx();
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        await CashOperationService.executeCashIn({
            amount: 5000,
            clientPhone: '077000000',
            tellerId: 'teller_1',
            branchId: 'branch_1',
        });

        // Régression : un dépôt Cash-In en agence créditait bien le client et créait une
        // ligne Notification (tx.notification.create), mais n'appelait jamais sendPush —
        // contrairement à executeCashOut (le retrait). Le client ne recevait donc aucune
        // alerte sonore/vibrante sur son téléphone pour l'opération la plus évidente de
        // "je viens de recevoir de l'argent", seulement une notification muette dans l'onglet
        // Notifications découverte plus tard.
        expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ userId: 'client_1', title: 'Dépôt reçu' }),
        }));
        expect(mockSendPush).toHaveBeenCalledTimes(1);
        expect(mockSendPush).toHaveBeenCalledWith(
            'ExponentPushToken[client]',
            'Dépôt reçu',
            // toLocaleString('fr-FR') insère une espace insécable (pas ' ' ordinaire) entre les
            // milliers — reconstruit ici via le même appel plutôt que codé en dur, pour ne pas
            // dépendre du caractère exact utilisé par l'ICU de l'environnement de test.
            `Vous avez reçu un dépôt de ${(5000).toLocaleString('fr-FR')} FCFA en agence.`,
        );
    });

    it("ne renvoie aucune notification (push) pour un rejeu idempotent déjà traité", async () => {
        const tx = buildDepositTx();
        // Idempotence : la référence a déjà été traitée lors d'un tout premier passage —
        // ni le débit/crédit, ni la notification ne doivent se reproduire.
        tx.transaction.findUnique.mockResolvedValue({ id: 'tx_existing', type: 'CASH_IN', amount: 5000 });
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        const result = await CashOperationService.executeCashIn({
            amount: 5000,
            clientPhone: '077000000',
            tellerId: 'teller_1',
            branchId: 'branch_1',
            idempotencyKey: 'idem-key-1',
        });

        expect(result).toEqual({ id: 'tx_existing', type: 'CASH_IN', amount: 5000 });
        expect(tx.wallet.update).not.toHaveBeenCalled();
        expect(tx.notification.create).not.toHaveBeenCalled();
        expect(mockSendPush).not.toHaveBeenCalled();
    });
});
