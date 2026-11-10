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

const SUPER_ADMIN = { id: 'staff_1', role: 'SUPER_ADMIN' };
const TELLER = { id: 'staff_1', role: 'TELLER' };

// Géant g1 (wallet wg1) avec deux affiliés ACCEPTED, tous deux attendus MENSUELLEMENT :
// m1 a payé ce mois-ci, m2 non (=> LATE).
const GIANT = {
    id: 'g1', name: 'Mairie', phone: '+24177000001', accountStatus: 'ACTIVE', createdAt: new Date('2026-01-01'),
    wallet: { id: 'wg1', balance: 900000 },
    giantAffiliations: [
        { id: 'a1', expectedFrequency: 'MONTHLY', expectedAmount: 5000, autoPayEnabled: true, createdAt: new Date('2026-01-01'),
            merchant: { id: 'm1', name: 'Boutique A', phone: '+24177000002', accountStatus: 'ACTIVE', wallet: { id: 'wm1' } } },
        { id: 'a2', expectedFrequency: 'MONTHLY', expectedAmount: 3000, autoPayEnabled: false, createdAt: new Date('2026-01-01'),
            merchant: { id: 'm2', name: 'Boutique B', phone: '+24177000003', accountStatus: 'ACTIVE', wallet: { id: 'wm2' } } },
    ],
};

function mockFlows() {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([GIANT]);
    (prisma.transaction.groupBy as jest.Mock).mockImplementation(({ by }: { by: string[] }) => {
        if (by.length === 2) {
            return Promise.resolve([{ senderWalletId: 'wm1', receiverWalletId: 'wg1', _sum: { amount: 5000 }, _count: { _all: 1 } }]);
        }
        if (by[0] === 'receiverWalletId') {
            return Promise.resolve([{ receiverWalletId: 'wg1', _sum: { amount: 105000 }, _count: { _all: 3 } }]);
        }
        return Promise.resolve([{ senderWalletId: 'wg1', _sum: { amount: 40000, fee: 400 }, _count: { _all: 2 } }]);
    });
    // Paiements de la fenêtre de conformité en cours (mois/semaine).
    (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
        { senderWalletId: 'wm1', receiverWalletId: 'wg1', createdAt: new Date() },
    ]);
}

describe('Admin Giants Routes (supervision Président)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /giants/overview', () => {
        it('devrait retourner 403 sans perm_analytics_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/giants/overview');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour une date invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).get('/giants/overview?from=01/02/2026');
            expect(res.status).toBe(400);
        });

        it('devrait séparer taxes / autres entrées / sorties et compter les affiliés en retard', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            mockFlows();

            const res = await request(app).get('/giants/overview?from=2026-01-01&to=2026-12-31');

            expect(res.status).toBe(200);
            expect(res.body.totals).toMatchObject({
                giantCount: 1,
                affiliateCount: 2,
                taxIn: 5000,
                otherIn: 100000,
                totalIn: 105000,
                totalOut: 40000,
                feesOut: 400,
                net: 65000,
                balance: 900000,
                lateCount: 1,
                complianceRate: 50,
            });
            expect(res.body.giants[0]).not.toHaveProperty('affiliates');
            expect(res.body.giants[0]).not.toHaveProperty('walletId');
        });
    });

    describe('GET /giants/:id', () => {
        it('devrait retourner 404 si le grand commerçant est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/giants/unknown');
            expect(res.status).toBe(404);
        });

        it('devrait classer chaque mouvement en TAX / IN / OUT', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            mockFlows();
            (prisma.transaction.findMany as jest.Mock).mockResolvedValueOnce([
                { id: 't1', amount: 5000, fee: 0, type: 'TRANSFER', reference: 'AUTOPAY-1', createdAt: new Date(),
                    senderWalletId: 'wm1', receiverWalletId: 'wg1',
                    senderWallet: { user: { id: 'm1', name: 'Boutique A', phone: '+24177000002' } }, receiverWallet: { user: { id: 'g1', name: 'Mairie', phone: '' } } },
                { id: 't2', amount: 100000, fee: 0, type: 'TRANSFER', reference: 'R2', createdAt: new Date(),
                    senderWalletId: 'wx', receiverWalletId: 'wg1',
                    senderWallet: { user: { id: 'x', name: 'Client', phone: '+24177000009' } }, receiverWallet: { user: { id: 'g1', name: 'Mairie', phone: '' } } },
                { id: 't3', amount: 40000, fee: 400, type: 'TRANSFER', reference: 'R3', createdAt: new Date(),
                    senderWalletId: 'wg1', receiverWalletId: 'we',
                    senderWallet: { user: { id: 'g1', name: 'Mairie', phone: '' } }, receiverWallet: { user: { id: 'e', name: 'Employé', phone: '+24177000010' } } },
            ]);

            const res = await request(app).get('/giants/g1?from=2026-01-01');

            expect(res.status).toBe(200);
            expect(res.body.movements.map((m: any) => m.category)).toEqual(['TAX', 'IN', 'OUT']);
            expect(res.body.movements[2].counterparty).toEqual({ name: 'Employé', phone: '+24177000010' });
            expect(res.body.giant.affiliates.map((a: any) => a.compliance)).toEqual(['OK', 'LATE']);
            expect(res.body.truncated).toBe(false);
        });
    });
});
