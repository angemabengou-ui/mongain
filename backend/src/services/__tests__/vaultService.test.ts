import { executeVaultWithdraw } from '../vaultService';

const mockGetOrCreateCorporateWallet = jest.fn();
const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../../routes/wallet', () => ({
    getOrCreateCorporateWallet: (...args: any[]) => mockGetOrCreateCorporateWallet(...args),
    sendPush: (...args: any[]) => mockSendPush(...args),
}));

function makeTx(overrides: Partial<Record<string, any>> = {}) {
    return {
        vault: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        wallet: { findUnique: jest.fn(), update: jest.fn() },
        notification: { create: jest.fn() },
        transaction: { create: jest.fn() },
        // pushToUser() lit le pushToken du destinataire pour l'alerte Expo — undefined par
        // défaut ici (le guard `if (!user?.pushToken) return` rend l'appel sûr sans mock dédié).
        user: { findUnique: jest.fn().mockResolvedValue({ pushToken: undefined }) },
        ...overrides,
    } as any;
}

const VAULT_TX = {
    id: 'vtx_1',
    vaultId: 'vault_1',
    amount: 10000,
    destinationType: 'TRANSFER',
    destinationId: 'user_1',
    requestedById: 'user_2',
    vault: { name: 'Caisse Famille' },
};

describe('executeVaultWithdraw', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetOrCreateCorporateWallet.mockResolvedValue({ wallet: { id: 'w_corporate' } });
    });

    it("crée une transaction fantôme FEE-VO- pour le frais, en plus de la transaction principale VAULT_OUT_", async () => {
        const tx = makeTx();
        (tx.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_dest' });
        tx.systemSettings = { findFirst: jest.fn().mockResolvedValue({ taxP2P: 0.01 }) };

        await executeVaultWithdraw(tx, VAULT_TX as any);

        expect(tx.transaction.create).toHaveBeenCalledTimes(2);
        expect(tx.transaction.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
            data: expect.objectContaining({ reference: 'VAULT_OUT_vtx_1', fee: 100, amount: 10000 }),
        }));
        expect(tx.transaction.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
            data: expect.objectContaining({ reference: 'FEE-VO-vtx_1', amount: 100, receiverWalletId: 'w_corporate' }),
        }));
    });

    it("ne crée aucune transaction fantôme quand le frais configuré est nul", async () => {
        const tx = makeTx();
        (tx.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_dest' });
        tx.systemSettings = { findFirst: jest.fn().mockResolvedValue({ taxP2P: 0 }) };

        await executeVaultWithdraw(tx, VAULT_TX as any);

        expect(tx.transaction.create).toHaveBeenCalledTimes(1);
        expect(mockGetOrCreateCorporateWallet).not.toHaveBeenCalled();
    });
});
