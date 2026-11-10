import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminGiantsRoutes from '../admin.giants';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.userId = 'staff_1';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findMany: jest.fn() },
        transaction: { groupBy: jest.fn(), findMany: jest.fn() },
    },
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({ timezone: 'Africa/Libreville' }),
}));

const app = express();
app.use(express.json());
app.use('/giants', adminGiantsRoutes);

const PRESIDENT = { id: 'staff_1', role: 'PRESIDENT' };
const RISK = { id: 'staff_1', role: 'RISK' };

// Géant g1 (wallet wg1) avec deux affiliés ACCEPTED, tous deux attendus MENSUELLEMENT :
// m1 a payé ce mois-ci, m2 non (=> LATE).
const GIANT = {
    id: 'g1', name: 'Mairie', phone: '+24177000001',
    wallet: { id: 'wg1' },
    giantAffiliations: [
        { id: 'a1', expectedFrequency: 'MONTHLY', expectedAmount: 5000,
            merchant: { id: 'm1', name: 'Boutique A', phone: '+24177000002', wallet: { id: 'wm1' } } },
        { id: 'a2', expectedFrequency: 'MONTHLY', expectedAmount: 3000,
            merchant: { id: 'm2', name: 'Boutique B', phone: '+24177000003', wallet: { id: 'wm2' } } },
    ],
};

function mockRevenue() {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([GIANT]);
    (prisma.transaction.groupBy as jest.Mock).mockImplementation(({ by }: { by: string[] }) => {
        if (by.length === 2) {
            return Promise.resolve([{ senderWalletId: 'wm1', receiverWalletId: 'wg1', _sum: { amount: 5000 }, _count: { _all: 1 } }]);
        }
        return Promise.resolve([{ receiverWalletId: 'wg1', _sum: { amount: 105000 }, _count: { _all: 3 } }]);
    });
    // Paiements de la fenêtre de conformité en cours (mois/semaine).
    (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { senderWalletId: 'wm1', receiverWalletId: 'wg1', createdAt: new Date() },
    ]);
}

describe('Admin Giants Routes (Dashboard Président)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /giants/overview', () => {
        it('devrait retourner 403 sans perm_president_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).get('/giants/overview');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour une date invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(PRESIDENT);
            const res = await request(app).get('/giants/overview?from=01/02/2026');
            expect(res.status).toBe(400);
        });

        it('devrait totaliser les recettes, la part taxes et les affiliés en retard', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(PRESIDENT);
            mockRevenue();

            const res = await request(app).get('/giants/overview?from=2026-01-01&to=2026-12-31');

            expect(res.status).toBe(200);
            expect(res.body.totals).toEqual({
                giantCount: 1,
                affiliateCount: 2,
                lateCount: 1,
                totalIn: 105000,
                inCount: 3,
                taxIn: 5000,
                taxCount: 1,
                otherIn: 100000,
            });
            // Aucune donnée de sortie ni technique ne doit sortir de cette route.
            expect(Object.keys(res.body.giants[0]).sort()).toEqual(
                ['affiliateCount', 'id', 'inCount', 'lateCount', 'name', 'otherIn', 'phone', 'taxCount', 'taxIn', 'totalIn']);
        });
    });

    describe('GET /giants/:id', () => {
        it('devrait retourner 404 si le grand commerçant est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(PRESIDENT);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/giants/unknown');
            expect(res.status).toBe(404);
        });

        it('devrait lister uniquement les encaissements, en distinguant les taxes des affiliés', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(PRESIDENT);
            mockRevenue();
            (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
                { id: 't1', amount: 5000, createdAt: new Date(), senderWallet: { user: { id: 'm1', name: 'Boutique A', phone: '+24177000002' } } },
                { id: 't2', amount: 100000, createdAt: new Date(), senderWallet: { user: { id: 'x', name: 'Client', phone: '+24177000009' } } },
            ]);

            const res = await request(app).get('/giants/g1?from=2026-01-01');

            expect(res.status).toBe(200);
            expect(prisma.transaction.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
                where: expect.objectContaining({ receiverWalletId: 'wg1' }),
            }));
            expect(res.body.payments.map((p: any) => p.isTax)).toEqual([true, false]);
            expect(Object.keys(res.body.payments[0]).sort()).toEqual(['amount', 'date', 'id', 'isTax', 'payer']);
            expect(res.body.giant.affiliates.map((a: any) => a.compliance)).toEqual(['OK', 'LATE']);
            expect(res.body.truncated).toBe(false);
        });
    });
});
