import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { executeTontineCycle, retryFailedContributions } from '../../services/tontineService';
import { sendPush } from '../wallet';
import adminRoutes from '../admin.tontines';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

// Import dynamique (await import('./wallet')) déclenché dès qu'il y a au moins un
// participant actif à notifier lors d'une pause/reprise de groupe.
jest.mock('../wallet', () => ({
    sendPush: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        tontineGroup: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        tontineParticipant: { findFirst: jest.fn(), update: jest.fn() },
        transaction: { findMany: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg)),
    },
}));

jest.mock('../../services/tontineService', () => ({
    executeTontineCycle: jest.fn(),
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

        it('devrait mettre en pause, notifier les participants actifs et tracer un AuditLog', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Amis', isPaused: true,
                participants: [{ userId: 'u1', user: { pushToken: 'tok1' } }, { userId: 'u2', user: { pushToken: null } }],
            });

            const res = await request(app).post('/admin/tontines/g1/pause').send({ reason: 'Cagnotte contestée' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'g1' },
                data: { isPaused: true, pausedReason: 'Cagnotte contestée' },
            }));
            expect(prisma.notification.createMany).toHaveBeenCalledWith({
                data: [
                    expect.objectContaining({ userId: 'u1', title: 'Tontine en pause' }),
                    expect.objectContaining({ userId: 'u2', title: 'Tontine en pause' }),
                ],
            });
            expect(sendPush).toHaveBeenCalledWith('tok1', 'Tontine en pause', expect.any(String));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'PAUSE_TONTINE' }),
            }));
        });

        it('devrait reprendre le groupe et notifier les participants actifs (base + push)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Amis', isPaused: false, participants: [{ userId: 'u1', user: { pushToken: 'tok1' } }] });

            const res = await request(app).post('/admin/tontines/g1/resume');

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith(expect.objectContaining({
                data: { isPaused: false, pausedReason: null },
            }));
            expect(sendPush).toHaveBeenCalledWith('tok1', 'Tontine reprise', expect.any(String));
            expect(prisma.notification.createMany).toHaveBeenCalledWith({
                data: [expect.objectContaining({ userId: 'u1', title: 'Tontine reprise' })],
            });
        });
    });

    describe('POST /admin/tontines/:id/participants/:userId/pause et /resume', () => {
        it("devrait retourner 404 si la personne n'est pas participante", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/tontines/g1/participants/u9/pause');

            expect(res.status).toBe(404);
        });

        it('devrait mettre en pause un participant et le notifier', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', tontineGroupId: 'g1', userId: 'u1', status: 'ACTIVE', group: { name: 'Amis' } });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({ id: 'p1', status: 'PAUSED' });

            const res = await request(app).post('/admin/tontines/g1/participants/u1/pause');

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'PAUSED' } });
            expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'u1', title: 'Vous avez été mis en pause' }),
            }));
        });

        it('devrait reprendre un participant et le notifier', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', tontineGroupId: 'g1', userId: 'u1', status: 'PAUSED', group: { name: 'Amis' } });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({ id: 'p1', status: 'ACTIVE' });

            const res = await request(app).post('/admin/tontines/g1/participants/u1/resume');

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ACTIVE' } });
            expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'u1', title: 'Vous avez été repris' }),
            }));
        });
    });

    describe('POST /admin/tontines/:id/postpone', () => {
        it('devrait exiger un nombre de jours positif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/tontines/g1/postpone').send({ days: 0, reason: 'Motif valide' });
            expect(res.status).toBe(400);
        });

        it('devrait exiger un motif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/tontines/g1/postpone').send({ days: 3 });
            expect(res.status).toBe(400);
        });

        it("devrait retourner 400 si le club n'est pas actif", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', status: 'COMPLETED', participants: [] });

            const res = await request(app).post('/admin/tontines/g1/postpone').send({ days: 3, reason: 'Certains membres ont besoin de plus de temps' });

            expect(res.status).toBe(400);
        });

        it('devrait décaler lastPayoutDate de N jours à partir de la date de référence, et notifier les membres actifs', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const lastPayoutDate = new Date('2026-01-01T00:00:00.000Z');
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Groupe A', status: 'ACTIVE', lastPayoutDate,
                participants: [{ userId: 'u1', user: { pushToken: 'tok1' } }],
            });
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', lastPayoutDate: new Date('2026-01-04T00:00:00.000Z') });

            const res = await request(app).post('/admin/tontines/g1/postpone').send({ days: 3, reason: 'Certains membres ont besoin de plus de temps' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
                where: { id: 'g1' },
                data: { lastPayoutDate: new Date('2026-01-04T00:00:00.000Z') },
            });
            expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.arrayContaining([expect.objectContaining({ userId: 'u1', title: 'Prélèvement reporté' })]),
            }));
            expect(sendPush).toHaveBeenCalled();
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'POSTPONE_TONTINE_CYCLE' }),
            }));
        });

        it("devrait utiliser startDate comme référence si aucun cycle n'a encore eu lieu (lastPayoutDate null)", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const startDate = new Date('2026-02-01T00:00:00.000Z');
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Groupe A', status: 'ACTIVE', lastPayoutDate: null, startDate,
                participants: [],
            });
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/admin/tontines/g1/postpone').send({ days: 5, reason: 'Motif valide' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
                where: { id: 'g1' },
                data: { lastPayoutDate: new Date('2026-02-06T00:00:00.000Z') },
            });
        });
    });

    describe('POST /admin/tontines/:id/participants/:userId/emergency-payout', () => {
        it('devrait exiger un motif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/tontines/g1/participants/u2/emergency-payout').send({});
            expect(res.status).toBe(400);
        });

        it("devrait retourner 400 si le club n'est pas actif", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', status: 'PENDING_RENEWAL', isPaused: false, participants: [] });

            const res = await request(app).post('/admin/tontines/g1/participants/u2/emergency-payout').send({ reason: 'Urgence médicale' });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si la personne a déjà reçu sa cagnotte pour cette boucle', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Groupe A', status: 'ACTIVE', isPaused: false, currentCycle: 2,
                participants: [{ id: 'p2', userId: 'u2', status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: true }],
            });

            const res = await request(app).post('/admin/tontines/g1/participants/u2/emergency-payout').send({ reason: 'Urgence médicale' });

            expect(res.status).toBe(400);
        });

        it('devrait échanger le tour avec le bénéficiaire courant, notifier ce dernier et déclencher le cycle', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Groupe A', status: 'ACTIVE', isPaused: false, currentCycle: 2, lastPayoutDate: null,
                participants: [
                    { id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 2, hasReceivedPayout: false, user: { pushToken: 'tok1' } },
                    { id: 'p2', userId: 'u2', status: 'ACTIVE', payoutOrder: 4, hasReceivedPayout: false, user: { pushToken: 'tok2' } },
                ],
            });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.tontineGroup.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (executeTontineCycle as jest.Mock).mockResolvedValue({ success: true, debitedCount: 2, totalPot: 10000 });

            const res = await request(app).post('/admin/tontines/g1/participants/u2/emergency-payout').send({ reason: 'Urgence médicale' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p2' }, data: { payoutOrder: 2 } });
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { payoutOrder: 4 } });
            expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'u1', title: 'Votre tour a été décalé' }),
            }));
            expect(sendPush).toHaveBeenCalled();
            expect(executeTontineCycle).toHaveBeenCalledWith('g1');
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'TONTINE_EMERGENCY_PAYOUT' }),
            }));
        });

        it("devrait retourner 409 si le CRON réclame le cycle au même instant", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'g1', name: 'Groupe A', status: 'ACTIVE', isPaused: false, currentCycle: 1, lastPayoutDate: null,
                participants: [{ id: 'p1', userId: 'u1', status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: false, user: { pushToken: 'tok1' } }],
            });
            (prisma.tontineGroup.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app).post('/admin/tontines/g1/participants/u1/emergency-payout').send({ reason: 'Urgence médicale' });

            expect(res.status).toBe(409);
            expect(executeTontineCycle).not.toHaveBeenCalled();
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
