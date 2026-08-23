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
        tontineGroup: { findMany: jest.fn(), findUnique: jest.fn() },
        transaction: { findMany: jest.fn() },
    },
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const SUPPORT_MAKER = { id: 'test_staff_id', role: 'SUPPORT_MAKER' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin Tontines Routes (lecture seule)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/tontines', () => {
        it('devrait retourner 403 pour un rôle non autorisé (ex: TELLER)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);

            const res = await request(app).get('/admin/tontines');

            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste des groupes pour SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const groups = [{ id: 'g1', name: 'Amis', status: 'ACTIVE', creator: { name: 'Alice', phone: '077' }, _count: { participants: 3 } }];
            (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue(groups);

            const res = await request(app).get('/admin/tontines');

            expect(res.status).toBe(200);
            expect(res.body.groups).toEqual(groups);
        });

        it('devrait aussi être accessible à SUPPORT_MAKER (investigation litige)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/tontines');

            expect(res.status).toBe(200);
        });
    });

    describe('GET /admin/tontines/:id', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);

            const res = await request(app).get('/admin/tontines/g1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le groupe est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/tontines/ghost');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le groupe et ses mouvements filtrés par référence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const group = { id: 'g1', name: 'Amis', creator: { name: 'Alice', phone: '077' }, participants: [] };
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(group);
            const transactions = [{ id: 'tx1', reference: 'TONT_DBT_Gg1_C1_Uu1', amount: 5000 }];
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue(transactions);

            const res = await request(app).get('/admin/tontines/g1');

            expect(res.status).toBe(200);
            expect(res.body.group).toEqual(group);
            expect(res.body.transactions).toEqual(transactions);
            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { reference: { contains: '_Gg1_' } },
            }));
        });
    });
});
