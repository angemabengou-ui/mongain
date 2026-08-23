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

        it('devrait retourner les statistiques du marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1', balance: 100000 },
            });
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 5000 }, _count: { id: 2 } }) // todaySales
                .mockResolvedValueOnce({ _sum: { amount: 20000 } }) // allTimeSales
                .mockResolvedValueOnce({ _sum: { amount: 150 } }) // todayRewards
                .mockResolvedValueOnce({ _sum: { amount: 600 } }); // allTimeRewards

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                balance: 100000,
                todaySalesAmount: 5000,
                todaySalesCount: 2,
                allTimeSalesAmount: 20000,
                todayCommission: 150,
                allTimeCommission: 600,
            });
        });

        it('devrait retourner des valeurs par défaut à 0 si les agrégats sont vides', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1', balance: 0 },
            });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null }, _count: { id: null } });

            const res = await request(app).get('/merchant/stats');

            expect(res.status).toBe(200);
            expect(res.body.todaySalesAmount).toBe(0);
            expect(res.body.todaySalesCount).toBe(0);
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

        it('devrait retourner la liste des transactions du marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'merchant_1',
                role: 'MERCHANT',
                wallet: { id: 'w1' },
            });
            const mockTxs = [{ id: 'tx1' }, { id: 'tx2' }];
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue(mockTxs);

            const res = await request(app).get('/merchant/transactions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockTxs);
            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { OR: [{ receiverWalletId: 'w1' }, { senderWalletId: 'w1' }] },
                take: 50,
            }));
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/merchant/transactions');

            expect(res.status).toBe(500);
        });
    });
});
