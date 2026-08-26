import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { executeTontineCycle, getTontineVaultWallet } from '../../services/tontineService';
import tontineRoutes from '../tontine';

// Mock du middleware pour simuler un userId injecté
jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_user_id';
        next();
    }
}));

jest.mock('../../services/tontineService', () => ({
    executeTontineCycle: jest.fn(),
    getTontineVaultWallet: jest.fn()
}));

jest.mock('../../prisma', () => ({
    prisma: {
        tontineGroup: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
        tontineParticipant: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        user: { findUnique: jest.fn() },
        notification: { create: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        transaction: { create: jest.fn() },
        staff: { findUnique: jest.fn() },
        $transaction: jest.fn((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)))
    },
}));

const app = express();
app.use(express.json());
app.use('/tontine', tontineRoutes);

describe('Tontine Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ==========================================
    // POST /tontine/create
    // ==========================================
    describe('POST /tontine/create', () => {
        it('devrait retourner 400 si le nom ou la cotisation manque', async () => {
            const res = await request(app).post('/tontine/create').send({ name: 'Club A' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('requis');
        });

        it('devrait retourner 400 si le montant de cotisation est invalide', async () => {
            const res = await request(app).post('/tontine/create').send({ name: 'Club A', contribution: -50 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('invalide');
        });

        it('devrait créer un club de tontine et y ajouter le créateur', async () => {
            (prisma.tontineGroup.create as jest.Mock).mockResolvedValue({ id: 'group1', name: 'Club A', contribution: 5000 });
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });

            const res = await request(app).post('/tontine/create').send({ name: 'Club A', contribution: 5000 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'test_user_id', tontineGroupId: 'group1', payoutOrder: 1 }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.create as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/create').send({ name: 'Club A', contribution: 5000 });

            expect(res.status).toBe(500);
        });

        it('devrait passer isPublic à la création (false par défaut)', async () => {
            (prisma.tontineGroup.create as jest.Mock).mockResolvedValue({ id: 'group1', name: 'Club A', contribution: 5000 });
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });

            await request(app).post('/tontine/create').send({ name: 'Club A', contribution: 5000, isPublic: true });

            expect(prisma.tontineGroup.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ isPublic: true }),
            }));

            await request(app).post('/tontine/create').send({ name: 'Club B', contribution: 5000 });
            expect(prisma.tontineGroup.create).toHaveBeenLastCalledWith(expect.objectContaining({
                data: expect.objectContaining({ isPublic: false }),
            }));
        });
    });

    // ==========================================
    // GET /tontine/discover
    // ==========================================
    describe('GET /tontine/discover', () => {
        it('devrait exclure les tontines déjà rejointes et lister les publiques actives', async () => {
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ tontineGroupId: 'already_in' }]);
            const mockGroups = [{ id: 'g1', name: 'Club Public', isPublic: true, creator: { name: 'Alice' }, _count: { participants: 3 } }];
            (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue(mockGroups);

            const res = await request(app).get('/tontine/discover');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual(mockGroups);
            expect(prisma.tontineGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ isPublic: true, status: 'ACTIVE', id: { notIn: ['already_in'] } }),
            }));
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineParticipant.findMany as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/tontine/discover');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // GET /tontine/groups
    // ==========================================
    describe('GET /tontine/groups', () => {
        it('devrait retourner les participations de l\'utilisateur', async () => {
            const mockParticipations = [{ id: 'p1', group: { name: 'Club A' } }];
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue(mockParticipations);

            const res = await request(app).get('/tontine/groups');

            expect(res.status).toBe(200);
            expect(res.body.data.myParticipations).toEqual(mockParticipations);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineParticipant.findMany as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/tontine/groups');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // GET /tontine/details/:groupId
    // ==========================================
    describe('GET /tontine/details/:groupId', () => {
        it('devrait retourner 404 si le club est introuvable', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/tontine/details/group1');

            expect(res.status).toBe(404);
        });

        it('devrait retourner 403 si l\'utilisateur n\'est pas membre', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({
                id: 'group1', participants: [{ userId: 'someone_else' }]
            });

            const res = await request(app).get('/tontine/details/group1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner les détails du club pour un membre', async () => {
            const group = { id: 'group1', participants: [{ userId: 'test_user_id' }] };
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(group);

            const res = await request(app).get('/tontine/details/group1');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual(group);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/tontine/details/group1');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/invite
    // ==========================================
    describe('POST /tontine/invite', () => {
        it('devrait retourner 403 si l\'appelant n\'est pas le créateur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else' });

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le numéro invité est introuvable', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si le membre est déjà dans le club', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'invitee1' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p_existing' });

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà');
        });

        it('devrait ajouter le membre avec succès et le notifier', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', name: 'Club A' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'invitee1' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(2);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 3 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'invitee1', tontineGroupId: 'group1', payoutOrder: 3 }
            });
            expect(prisma.notification.create).toHaveBeenCalled();
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/leave
    // ==========================================
    describe('POST /tontine/leave', () => {
        it('devrait retourner 404 si l\'utilisateur ne fait pas partie du club', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 404 si le club est introuvable', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(404);
        });

        it('devrait refuser que le créateur quitte tant que d\'autres membres actifs existent', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', currentCycle: 1, contribution: 1000 });
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(2);

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('autres membres');
        });

        it('devrait refuser si une dette existe et que le solde est insuffisant', async () => {
            // payoutOrder(1) < currentCycle(3) => déjà payé => dette due
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 3, contribution: 1000, name: 'Club A' });
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(2); // remainingBeneficiaries
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 500 });

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('cotiser');
        });

        it('devrait permettre à un membre non-créateur de quitter sans dette', async () => {
            // payoutOrder(5) >= currentCycle(1) => pas encore payé, pas de dette
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 5 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 1, contribution: 1000, name: 'Club A' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 500 });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.tontineParticipant.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({
                where: { id: 'p1' },
                data: { status: 'LEFT' }
            });
            expect(prisma.tontineParticipant.updateMany).toHaveBeenCalledWith({
                where: { tontineGroupId: 'group1', status: 'ACTIVE', payoutOrder: { gt: 5 } },
                data: { payoutOrder: { decrement: 1 } }
            });
        });

        it('devrait régler la dette et quitter le club si le solde est suffisant', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 2, contribution: 1000, name: 'Club A' });
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(1); // remainingBeneficiaries => debt = 1000
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 2000 });
            (getTontineVaultWallet as jest.Mock).mockResolvedValue({ id: 'w_vault', balance: 0 });
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('réglée');
            expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
                where: { userId: 'test_user_id', balance: { gte: 1000 } },
                data: { balance: { decrement: 1000 } }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/reorder
    // ==========================================
    describe('POST /tontine/reorder', () => {
        it('devrait retourner 403 si l\'appelant n\'est pas le créateur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else' });

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 2 }] });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si orderMap est invalide', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id' });

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [] });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 403 si un participant n\'appartient pas au groupe (IDOR)', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ id: 'p1' }]); // only one of two found

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 1 }, { participantId: 'p2_foreign', newOrder: 2 }] });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain("n'appartiennent pas");
        });

        it('devrait réordonner les participants avec succès', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 2 }, { participantId: 'p2', newOrder: 1 }] });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledTimes(2);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 1 }] });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/join
    // ==========================================
    describe('POST /tontine/join', () => {
        it('devrait retourner 400 si groupId est manquant', async () => {
            const res = await request(app).post('/tontine/join').send({});

            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si le groupe est introuvable ou inactif', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'CLOSED' });

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 403 si la tontine est privée (isPublic=false)', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: false });

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si l\'utilisateur participe déjà', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: true });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p_existing' });

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
        });

        it('devrait rejoindre le club avec succès', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: true, name: 'Club A', contribution: 1000 });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(3);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 4 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'test_user_id', tontineGroupId: 'group1', payoutOrder: 4 }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/debit/:groupId
    // ==========================================
    describe('POST /tontine/debit/:groupId', () => {
        it('devrait retourner 403 si l\'appelant n\'est pas un staff habilité', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff1', isActive: true, role: 'BRANCH_MANAGER' });

            const res = await request(app).post('/tontine/debit/group1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 403 si le staff est inactif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff1', isActive: false, role: 'SUPER_ADMIN' });

            const res = await request(app).post('/tontine/debit/group1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le cycle échoue (groupe introuvable)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff1', isActive: true, role: 'SUPER_ADMIN' });
            (executeTontineCycle as jest.Mock).mockResolvedValue({ success: false });

            const res = await request(app).post('/tontine/debit/group1');

            expect(res.status).toBe(404);
        });

        it('devrait exécuter le cycle avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff1', isActive: true, role: 'SUPER_ADMIN' });
            (executeTontineCycle as jest.Mock).mockResolvedValue({
                success: true, currentCycle: 2, debitedCount: 4, failedCount: 1, totalPot: 4000
            });

            const res = await request(app).post('/tontine/debit/group1');

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('4000');
            expect(res.body.message).toContain('4 réussis');
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/debit/group1');

            expect(res.status).toBe(500);
        });
    });
});
