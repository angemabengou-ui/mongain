import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { retryFailedContributions } from '../../services/tontineService';
import adminRoutes from '../admin.tontines';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        tontineGroup: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        tontineParticipant: { findFirst: jest.fn(), update: jest.fn() },
        transaction: { findMany: jest.fn() },
        auditLog: { create: jest.fn() },
    },
}));

jest.mock('../../services/tontineService', () => ({
    retryFailedContributions: jest.fn(),
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
        it('devrait retourner 403 pour un rôle non autorisé (ex: TELLER sans permissions)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'INVALID_ROLE' });

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
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'INVALID_ROLE' });

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

    describe('POST /admin/tontines/:id/pause et /resume', () => {
        it('devrait retourner 403 pour SUPPORT_MAKER (lecture seule, pas perm_tontine_manage)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/tontines/g1/pause').send({ reason: 'Litige signalé' });
            expect(res.status).toBe(403);
        });

        it('devrait exiger un motif pour la mise en pause', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/tontines/g1/pause').send({});
            expect(res.status).toBe(400);
        });

        it('devrait mettre en pause et tracer un AuditLog', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Amis', isPaused: true });

            const res = await request(app).post('/admin/tontines/g1/pause').send({ reason: 'Cagnotte contestée' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'g1' },
                data: { isPaused: true, pausedReason: 'Cagnotte contestée' },
            }));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'PAUSE_TONTINE' }),
            }));
        });

        it('devrait reprendre le groupe', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', isPaused: false });

            const res = await request(app).post('/admin/tontines/g1/resume');

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith(expect.objectContaining({
                data: { isPaused: false, pausedReason: null },
            }));
        });
    });

    describe('POST /admin/tontines/:id/participants/:userId/pause et /resume', () => {
        it("devrait retourner 404 si la personne n'est pas participante", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/tontines/g1/participants/u9/pause');

            expect(res.status).toBe(404);
        });

        it('devrait mettre en pause un participant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', tontineGroupId: 'g1', userId: 'u1', status: 'ACTIVE' });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PAUSED' });

            const res = await request(app).post('/admin/tontines/g1/participants/u1/pause');

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PAUSED' } });
        });

        it('devrait reprendre un participant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', tontineGroupId: 'g1', userId: 'u1', status: 'PAUSED' });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({ id: 'p1', status: 'ACTIVE' });

            const res = await request(app).post('/admin/tontines/g1/participants/u1/resume');

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ACTIVE' } });
        });
    });

    describe('POST /admin/tontines/:id/cycles/:cycleId/retry', () => {
        it('devrait retourner 403 pour un rôle sans perm_tontine_manage', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/tontines/g1/cycles/c1/retry');
            expect(res.status).toBe(403);
        });

        it('devrait relancer les cotisations en échec et tracer un AuditLog', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (retryFailedContributions as jest.Mock).mockResolvedValue({ retriedCount: 2, stillFailedCount: 1, recovered: 10000 });

            const res = await request(app).post('/admin/tontines/g1/cycles/c1/retry');

            expect(res.status).toBe(200);
            expect(retryFailedContributions).toHaveBeenCalledWith('g1', 'c1');
            expect(res.body).toEqual(expect.objectContaining({ retriedCount: 2, stillFailedCount: 1, recovered: 10000 }));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'RETRY_TONTINE_CYCLE' }),
            }));
        });

        it('devrait retourner 400 si le cycle est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (retryFailedContributions as jest.Mock).mockRejectedValue(new Error('Cycle introuvable.'));

            const res = await request(app).post('/admin/tontines/g1/cycles/ghost/retry');

            expect(res.status).toBe(400);
        });
    });
});
