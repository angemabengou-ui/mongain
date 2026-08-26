import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import merchantRoutes from '../merchant';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'merchant_1';
        next();
    },
}));

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        transaction: { aggregate: jest.fn(), findMany: jest.fn() },
        merchantPayoutRequest: { create: jest.fn(), findMany: jest.fn() },
    },
}));

// merchant.ts calcule désormais la frontière "aujourd'hui" dans le fuseau configuré
// (utils/timezone.ts) plutôt qu'en heure serveur — nécessite getSystemSettings().
jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({ timezone: 'Africa/Libreville' }),
}));

const app = express();
app.use(express.json());
app.use('/merchant', merchantRoutes);

describe('Merchant Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /merchant/stats', () => {
        it('devrait retourner 403 si l\'utilisateur n\'existe pas', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Accès refusé.');
        });

        it('devrait retourner 403 si l\'utilisateur n\'est pas un MERCHANT', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'USER', wallet: { id: 'w1' } });

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Accès refusé.');
        });

        it('devrait retourner les statistiques du marchand avec le solde commission séparé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1', balance: 100000 },
                commissionWallet: { id: 'wc1', balance: 4500 },
            });
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 5000 }, _count: { id: 2 } }) // todaySales
                .mockResolvedValueOnce({ _sum: { amount: 20000 } }) // allTimeSales
                .mockResolvedValueOnce({ _sum: { amount: 0 } }) // todayLegacyRewards
                .mockResolvedValueOnce({ _sum: { amount: 0 } }) // allTimeLegacyRewards
                .mockResolvedValueOnce({ _sum: { amount: 150 } }) // todayCommission (commissionWallet)
                .mockResolvedValueOnce({ _sum: { amount: 600 } }); // allTimeCommission (commissionWallet)

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                balance: 100000,
                commissionBalance: 4500,
                todaySalesAmount: 5000,
                todaySalesCount: 2,
                allTimeSalesAmount: 20000,
                todayCommission: 150,
                allTimeCommission: 600,
            });
        });

        it('devrait additionner les commissions historiques (wallet principal) et les nouvelles (commissionWallet)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1', balance: 100000 },
                commissionWallet: { id: 'wc1', balance: 200 },
            });
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
                .mockResolvedValueOnce({ _sum: { amount: 0 } })
                .mockResolvedValueOnce({ _sum: { amount: 30 } }) // todayLegacyRewards
                .mockResolvedValueOnce({ _sum: { amount: 300 } }) // allTimeLegacyRewards
                .mockResolvedValueOnce({ _sum: { amount: 50 } }) // todayCommission
                .mockResolvedValueOnce({ _sum: { amount: 200 } }); // allTimeCommission

            const res = await request(app).get('/merchant/stats');

            expect(res.body.todayCommission).toBe(80);
            expect(res.body.allTimeCommission).toBe(500);
        });

        it('devrait retourner commissionBalance=0 et ignorer les agrégats commissionWallet si aucun n\'existe encore', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1', balance: 0 },
                commissionWallet: null,
            });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null }, _count: { id: null } });

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(200);
            expect(res.body.commissionBalance).toBe(0);
            expect(res.body.todayCommission).toBe(0);
            expect(res.body.allTimeCommission).toBe(0);
            // Pas d'agrégat inutile sur un commissionWallet inexistant.
            expect(prisma.transaction.aggregate).toHaveBeenCalledTimes(4);
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(500);
        });
    });

    describe('GET /merchant/transactions', () => {
        it('devrait retourner 403 si l\'utilisateur n\'est pas un MERCHANT', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'USER', wallet: { id: 'w1' } });

            const res = await request(app).get('/merchant/transactions');

            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste des transactions du marchand (ventes + commission)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1' },
                commissionWallet: { id: 'wc1' },
            });
            const mockTxs = [{ id: 'tx1' }, { id: 'tx2' }];
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue(mockTxs);

            const res = await request(app).get('/merchant/transactions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockTxs);
            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { OR: [{ receiverWalletId: 'w1' }, { senderWalletId: 'w1' }, { receiverWalletId: 'wc1' }, { senderWalletId: 'wc1' }] },
                take: 50,
            }));
        });

        it('devrait filtrer sur le seul commissionWallet avec ?category=COMMISSION', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1' },
                commissionWallet: { id: 'wc1' },
            });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

            await request(app).get('/merchant/transactions?category=COMMISSION');

            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { OR: [{ receiverWalletId: 'wc1' }, { senderWalletId: 'wc1' }] },
            }));
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/merchant/transactions');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /merchant/payouts', () => {
        it('devrait rejeter un sourceAccount invalide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1', balance: 10000 }, commissionWallet: null });

            const res = await request(app).post('/merchant/payouts').send({ sourceAccount: 'BOGUS', amount: 1000 });

            expect(res.status).toBe(400);
        });

        it('devrait rejeter un montant supérieur au solde disponible', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1', balance: 1000 }, commissionWallet: null });

            const res = await request(app).post('/merchant/payouts').send({ sourceAccount: 'SALES', amount: 5000 });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Solde insuffisant');
        });

        it('devrait créer la demande de retrait', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1', balance: 10000 }, commissionWallet: { id: 'wc1', balance: 500 } });
            (prisma.merchantPayoutRequest.create as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PENDING' });

            const res = await request(app).post('/merchant/payouts').send({ sourceAccount: 'COMMISSION', amount: 500, note: 'Test' });

            expect(res.status).toBe(200);
            expect(prisma.merchantPayoutRequest.create).toHaveBeenCalledWith({
                data: { merchantId: 'merchant_1', sourceAccount: 'COMMISSION', amount: 500, note: 'Test' },
            });
        });
    });

    describe('GET /merchant/payouts', () => {
        it("devrait retourner l'historique des demandes du marchand", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1' }, commissionWallet: null });
            const mockPayouts = [{ id: 'p1', status: 'PENDING' }];
            (prisma.merchantPayoutRequest.findMany as jest.Mock).mockResolvedValue(mockPayouts);

            const res = await request(app).get('/merchant/payouts');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockPayouts);
            expect(prisma.merchantPayoutRequest.findMany).toHaveBeenCalledWith({
                where: { merchantId: 'merchant_1' },
                orderBy: { createdAt: 'desc' },
            });
        });
    });
});
