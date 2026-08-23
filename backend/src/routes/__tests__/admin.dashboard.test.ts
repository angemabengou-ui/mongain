import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminRoutes from '../admin';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { count: jest.fn(), findUnique: jest.fn() },
        wallet: { aggregate: jest.fn() },
        branch: { findFirst: jest.fn() },
        centralTreasury: { findFirst: jest.fn(), create: jest.fn() },
        transaction: { findMany: jest.fn(), aggregate: jest.fn() },
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

describe('Admin Dashboard Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/stats', () => {
        it('devrait retourner 403 si le staff n\'a pas un rôle autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'test_staff_id', role: 'TELLER' });

            const res = await request(app).get('/admin/stats');

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Accès refusé.');
        });

        it('devrait retourner 403 si le staff est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/stats');

            expect(res.status).toBe(403);
        });

        it('devrait retourner les statistiques du tableau de bord pour un SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'test_staff_id', role: 'SUPER_ADMIN' });
            (prisma.user.count as jest.Mock)
                .mockResolvedValueOnce(100) // totalUsers
                .mockResolvedValueOnce(10)  // agentsCount
                .mockResolvedValueOnce(5);  // merchantsCount
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ wallet: { balance: 777 } });
            (prisma.wallet.aggregate as jest.Mock).mockResolvedValue({ _sum: { balance: 500000 } });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({ id: 'ct_1', walletId: 'w_hq', wallet: { balance: 200000 } });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
                { amount: 1000, receiverWallet: { user: { role: 'AGENT' } } },
                { amount: 2000, receiverWallet: { user: { role: 'MERCHANT' } } },
                { amount: 3000, receiverWallet: { user: { role: 'USER' } } },
            ]);
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 50000 } }) // pureMintTxs
                .mockResolvedValueOnce({ _sum: { amount: 123456 } }); // pureVolume

            const res = await request(app).get('/admin/stats');

            expect(res.status).toBe(200);
            expect(res.body.totalUsers).toBe(100);
            expect(res.body.agentsCount).toBe(10);
            expect(res.body.merchantsCount).toBe(5);
            expect(res.body.revenue).toBe(777);
            expect(res.body.reserve).toBe(200000);
            expect(res.body.totalCirculating).toBe(500000);
            expect(res.body.totalMinted).toBe(50000);
            expect(res.body.mintedToAgents).toBe(1000);
            expect(res.body.mintedToMerchants).toBe(2000);
            expect(res.body.mintedToClients).toBe(3000);
            expect(res.body.totalVolume).toBe(123456);
        });

        it('devrait accepter les rôles RISK et COMPLIANCE_CHECKER', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'test_staff_id', role: 'RISK' });
            (prisma.user.count as jest.Mock).mockResolvedValue(0);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.wallet.aggregate as jest.Mock).mockResolvedValue({ _sum: { balance: null } });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({ id: 'ct_1', walletId: 'w_hq', wallet: { balance: 0 } });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: null } });

            const res = await request(app).get('/admin/stats');

            expect(res.status).toBe(200);
            expect(res.body.revenue).toBe(0);
            expect(res.body.reserve).toBe(0);
            expect(res.body.totalCirculating).toBe(0);
        });

        it('devrait retourner 500 en cas d\'erreur inattendue', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/admin/stats');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('DB down');
        });
    });
});
