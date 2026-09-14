import { prisma } from '../../prisma';
import { checkOverdueLoans, hasDefaultedCreditDebt } from '../creditRisk';

// Même convention que CashOperationService.test.ts : '../../routes/wallet' mocké dans son
// ensemble pour isoler ce test de l'implémentation réelle d'Expo — seul le FAIT d'appeler
// sendPush(), avec les bons arguments, nous intéresse ici.
const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../../routes/wallet', () => ({
    sendPush: (...args: any[]) => mockSendPush(...args),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        loan: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        bnplContract: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        notification: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

describe('creditRisk.checkOverdueLoans', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('bascule en DEFAULTED un prêt ACTIVE dont la dueDate est dépassée, et notifie le client (Notification + push)', async () => {
        const overdueLoan = {
            id: 'loan_1',
            userId: 'user_1',
            amount: 10000,
            totalOwed: 10500,
            status: 'ACTIVE',
            dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // hier
            user: { pushToken: 'ExponentPushToken[user1]' },
        };
        (prisma.loan.findMany as jest.Mock).mockResolvedValue([overdueLoan]);

        const tx = {
            loan: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            bnplContract: { updateMany: jest.fn() },
            notification: { create: jest.fn().mockResolvedValue({}) },
        };
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        await checkOverdueLoans();

        // Régression centrale de l'audit : Loan.status supportait DEFAULTED mais rien ne le
        // posait jamais faute d'échéance stockée — ce job doit réellement transitionner le
        // prêt, avec la garde de statut atomique (updateMany where status: 'ACTIVE').
        expect(tx.loan.updateMany).toHaveBeenCalledWith({
            where: { id: 'loan_1', status: 'ACTIVE' },
            data: { status: 'DEFAULTED' },
        });
        expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ userId: 'user_1', type: 'TRANSACTION' }),
        }));
        expect(mockSendPush).toHaveBeenCalledTimes(1);
        expect(mockSendPush).toHaveBeenCalledWith('ExponentPushToken[user1]', expect.any(String), expect.any(String));
    });

    it("ne notifie pas si la transition a déjà été traitée par un appel concurrent (garde updateMany count=0)", async () => {
        const overdueLoan = {
            id: 'loan_1', userId: 'user_1', amount: 10000, totalOwed: 10500, status: 'ACTIVE',
            dueDate: new Date(Date.now() - 1000), user: { pushToken: null },
        };
        (prisma.loan.findMany as jest.Mock).mockResolvedValue([overdueLoan]);
        const tx = {
            loan: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
            notification: { create: jest.fn() },
        };
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

        await checkOverdueLoans();

        expect(tx.notification.create).not.toHaveBeenCalled();
        expect(mockSendPush).not.toHaveBeenCalled();
    });

    it("n'interroge que les prêts ACTIVE dont dueDate est dépassée (le filtre exclut nativement dueDate=null)", async () => {
        (prisma.loan.findMany as jest.Mock).mockResolvedValue([]);

        await checkOverdueLoans();

        expect(prisma.loan.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'ACTIVE', dueDate: expect.objectContaining({ lt: expect.any(Date) }) }),
        }));
    });
});

describe('creditRisk.hasDefaultedCreditDebt', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('retourne true si un prêt DEFAULTED existe pour cet utilisateur (bloque aussi un nouveau BNPL, pas seulement un nouveau prêt)', async () => {
        (prisma.loan.findFirst as jest.Mock).mockResolvedValue({ id: 'loan_defaulted' });
        (prisma.bnplContract.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(hasDefaultedCreditDebt('user_1')).resolves.toBe(true);
    });

    it('retourne true si un contrat BNPL DEFAULTED existe pour cet utilisateur (bloque aussi un nouveau prêt)', async () => {
        (prisma.loan.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.bnplContract.findFirst as jest.Mock).mockResolvedValue({ id: 'bnpl_defaulted' });

        await expect(hasDefaultedCreditDebt('user_1')).resolves.toBe(true);
    });

    it('retourne false sans dette DEFAULTED sur aucun des deux produits', async () => {
        (prisma.loan.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.bnplContract.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(hasDefaultedCreditDebt('user_1')).resolves.toBe(false);
    });
});
