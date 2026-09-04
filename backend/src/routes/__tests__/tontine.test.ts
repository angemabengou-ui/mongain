import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { contributeNow, executeTontineCycle, resolveRenewalPoll } from '../../services/tontineService';
import { sendPush } from '../wallet';
import tontineRoutes from '../tontine';

// Mock du middleware pour simuler un userId injecté
jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_user_id';
        next();
    }
}));

// Import dynamique (await import('./wallet')) déclenché par POST /cancel dès qu'il y a au
// moins un autre participant actif à notifier de la dissolution.
jest.mock('../wallet', () => ({
    sendPush: jest.fn(),
}));

jest.mock('../../services/tontineService', () => ({
    executeTontineCycle: jest.fn(),
    getTontineVaultWallet: jest.fn(),
    resolveRenewalPoll: jest.fn(),
    contributeNow: jest.fn()
}));

jest.mock('../../prisma', () => ({
    prisma: {
        tontineGroup: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        tontineCycle: { count: jest.fn(), findFirst: jest.fn() },
        tontineParticipant: {
            create: jest.fn(),
            findMany: jest.fn(),
            findFirst: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        user: { findUnique: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        transaction: { create: jest.fn() },
        staff: { findUnique: jest.fn() },
        $executeRaw: jest.fn(),
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
    // PUT /tontine/settings
    // ==========================================
    describe('PUT /tontine/settings', () => {
        it('devrait retourner 404 si le club est introuvable', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/tontine/settings').send({ groupId: 'ghost', name: 'X' });

            expect(res.status).toBe(404);
        });

        it("devrait retourner 403 si l'appelant n'est pas le créateur", async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'other_user' });

            const res = await request(app).put('/tontine/settings').send({ groupId: 'g1', name: 'X' });

            expect(res.status).toBe(403);
        });

        it('devrait autoriser à tout moment le renommage et le changement de visibilité', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id' });
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', name: 'Nouveau nom', isPublic: true });

            const res = await request(app).put('/tontine/settings').send({ groupId: 'g1', name: 'Nouveau nom', isPublic: true });

            expect(res.status).toBe(200);
            expect(prisma.tontineCycle.count).not.toHaveBeenCalled();
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
                where: { id: 'g1' },
                data: { name: 'Nouveau nom', isPublic: true },
            });
        });

        it('devrait rejeter un changement de cotisation ou de fréquence si le premier cycle a déjà tourné', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id' });
            (prisma.tontineCycle.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).put('/tontine/settings').send({ groupId: 'g1', contribution: 10000 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà été exécuté');
            expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
        });

        it('devrait autoriser le changement de cotisation et de fréquence avant le premier cycle', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id' });
            (prisma.tontineCycle.count as jest.Mock).mockResolvedValue(0);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', contribution: 10000, frequency: 'WEEKLY' });

            const res = await request(app).put('/tontine/settings').send({ groupId: 'g1', contribution: 10000, frequency: 'WEEKLY' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith({
                where: { id: 'g1' },
                data: { contribution: 10000, frequency: 'WEEKLY' },
            });
        });

        it('devrait retourner 400 si aucune modification n\'est fournie', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id' });

            const res = await request(app).put('/tontine/settings').send({ groupId: 'g1' });

            expect(res.status).toBe(400);
            expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
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
                where: expect.objectContaining({ isPublic: true, status: 'ACTIVE', isPaused: false, id: { notIn: ['already_in'] } }),
            }));
        });

        it('devrait exclure la recherche d\'appartenance uniquement les LEFT (un LEFT peut redécouvrir le club)', async () => {
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue([]);

            await request(app).get('/tontine/discover');

            expect(prisma.tontineParticipant.findMany).toHaveBeenCalledWith({
                where: { userId: 'test_user_id', status: { not: 'LEFT' } },
                select: { tontineGroupId: true }
            });
        });

        it('ne doit jamais utiliser `include` (fuiterait des champs admin comme pausedReason)', async () => {
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue([]);

            await request(app).get('/tontine/discover');

            const call = (prisma.tontineGroup.findMany as jest.Mock).mock.calls[0][0];
            expect(call.include).toBeUndefined();
            expect(call.select).toEqual(expect.objectContaining({ id: true, name: true, contribution: true, frequency: true }));
            expect(call.select.pausedReason).toBeUndefined();
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
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si le club est dissous', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'CANCELLED' });

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('dissous');
        });

        it('devrait retourner 400 si le membre est déjà dans le club', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'invitee1' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p_existing' });

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà');
        });

        it('devrait ajouter le membre avec succès et le notifier', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', name: 'Club A', status: 'ACTIVE', currentCycle: 1 });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'invitee1' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ payoutOrder: 1 }, { payoutOrder: 2 }]);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 3 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'invitee1', tontineGroupId: 'group1', payoutOrder: 3 }
            });
            expect(prisma.notification.create).toHaveBeenCalled();
        });

        // Régression : après une relance de boucle, les membres restants sont renumérotés à
        // partir de currentCycle (resolveRenewalPoll) — un simple count() de toutes les lignes
        // historiques (y compris les LEFT d'avant la relance) retombait sur un payoutOrder déjà
        // pris par un membre actif. Ici, 4 lignes existent historiquement mais seuls 2 membres
        // actifs subsistent, renumérotés 5 et 6 : le nouvel invité doit recevoir 7, pas 5.
        it('devrait placer le nouveau membre après le dernier tour ACTIF, pas après le nombre total de lignes historiques', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', name: 'Club A', status: 'ACTIVE', currentCycle: 5 });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'invitee1' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ payoutOrder: 5 }, { payoutOrder: 6 }]);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 7 });

            const res = await request(app).post('/tontine/invite').send({ groupId: 'group1', phone: '+241000000' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'invitee1', tontineGroupId: 'group1', payoutOrder: 7 }
            });
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
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', currentCycle: 1, contribution: 1000, status: 'ACTIVE' });
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(2);

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('autres membres');
        });

        it('devrait refuser si une dette existe et que le solde est insuffisant', async () => {
            // payoutOrder(1) < currentCycle(3) => déjà payé => dette due
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 3, contribution: 1000, name: 'Club A', status: 'ACTIVE' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ userId: 'b1' }, { userId: 'b2' }]); // remainingBeneficiaries
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
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 2, contribution: 1000, name: 'Club A', status: 'ACTIVE' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ userId: 'beneficiary1' }]); // remainingBeneficiaries => debt = 1000
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 2000 });
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
            // Bug réel corrigé : la dette doit être reversée DIRECTEMENT au bénéficiaire
            // restant (group.contribution chacun), pas au coffre TONTINE_VAULT partagé par
            // toutes les tontines de la plateforme, qui ne la redistribuait jamais.
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w1' },
                data: { balance: { increment: 1000 } }
            });
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ amount: 1000, receiverWalletId: 'w1' })
            });
            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ userId: 'beneficiary1', title: 'Compensation reçue' })
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineParticipant.findFirst as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(500);
        });

        it('ne devrait réclamer aucune dette sur un club dissous, même déjà payé', async () => {
            // payoutOrder(1) < currentCycle(3) => aurait normalement une dette sur un club actif
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1', payoutOrder: 1 });
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'someone_else', currentCycle: 3, contribution: 1000, name: 'Club A', status: 'CANCELLED' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 0 });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/leave').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(prisma.wallet.updateMany).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // POST /tontine/contribute
    // ==========================================
    describe('POST /tontine/contribute', () => {
        it('devrait transmettre le montant libre saisi et confirmer un dépôt partiel sans versement', async () => {
            (contributeNow as jest.Mock).mockResolvedValue({ success: true, payoutTriggered: false, amountPaid: 2000, totalPaid: 2000, remaining: 3000 });

            const res = await request(app).post('/tontine/contribute').send({ groupId: 'group1', amount: 2000 });

            expect(res.status).toBe(200);
            expect(contributeNow).toHaveBeenCalledWith('group1', 'test_user_id', 2000);
            expect(res.body.payoutTriggered).toBe(false);
            expect(res.body.remaining).toBe(3000);
        });

        it('devrait confirmer le versement immédiat quand tout le monde a fini de cotiser', async () => {
            (contributeNow as jest.Mock).mockResolvedValue({ success: true, payoutTriggered: true, amountPaid: 3000, totalPaid: 5000, remaining: 0 });

            const res = await request(app).post('/tontine/contribute').send({ groupId: 'group1', amount: 3000 });

            expect(res.status).toBe(200);
            expect(res.body.payoutTriggered).toBe(true);
            expect(res.body.message).toContain('versée');
        });

        it('devrait retourner 400 avec le message métier si contributeNow rejette', async () => {
            (contributeNow as jest.Mock).mockRejectedValue(new Error('Vous avez déjà cotisé pour ce tour.'));

            const res = await request(app).post('/tontine/contribute').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Vous avez déjà cotisé pour ce tour.');
        });
    });

    // ==========================================
    // POST /tontine/renewal-vote
    // ==========================================
    describe('POST /tontine/renewal-vote', () => {
        it("devrait retourner 400 si vote n'est ni YES ni NO", async () => {
            const res = await request(app).post('/tontine/renewal-vote').send({ groupId: 'group1', vote: 'MAYBE' });
            expect(res.status).toBe(400);
        });

        it("devrait retourner 400 si le club n'a pas de sondage en cours", async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE' });

            const res = await request(app).post('/tontine/renewal-vote').send({ groupId: 'group1', vote: 'YES' });

            expect(res.status).toBe(400);
        });

        it("devrait retourner 404 si l'appelant ne fait pas partie du club", async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'PENDING_RENEWAL' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/renewal-vote').send({ groupId: 'group1', vote: 'YES' });

            expect(res.status).toBe(404);
        });

        it('devrait enregistrer le vote sans trancher le sondage si des membres actifs n\'ont pas encore voté', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'PENDING_RENEWAL' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1' });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(1); // encore 1 en attente

            const res = await request(app).post('/tontine/renewal-vote').send({ groupId: 'group1', vote: 'YES' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { renewalVote: 'YES' } });
            expect(resolveRenewalPoll).not.toHaveBeenCalled();
        });

        it('devrait trancher le sondage immédiatement dès que tout le monde a voté', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'PENDING_RENEWAL' });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue({ id: 'p1' });
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});
            (prisma.tontineParticipant.count as jest.Mock).mockResolvedValue(0); // plus personne en attente

            const res = await request(app).post('/tontine/renewal-vote').send({ groupId: 'group1', vote: 'NO' });

            expect(res.status).toBe(200);
            expect(resolveRenewalPoll).toHaveBeenCalledWith('group1');
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

        it('devrait retourner 400 si le club est dissous', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'CANCELLED' });

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 2 }] });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('dissous');
        });

        it('devrait retourner 400 si orderMap est invalide', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [] });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 403 si un participant n\'appartient pas au groupe (IDOR)', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ id: 'p1' }]); // only one of two found

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 1 }, { participantId: 'p2_foreign', newOrder: 2 }] });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain("n'appartiennent pas");
        });

        it('devrait réordonner les participants avec succès', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });
            (prisma.tontineParticipant.findMany as jest.Mock)
                .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]) // IDOR guard : participants ciblés valides
                .mockResolvedValueOnce([]); // aucun autre membre du groupe (donc aucun tour déjà pris)
            (prisma.tontineParticipant.update as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p1', newOrder: 2 }, { participantId: 'p2', newOrder: 1 }] });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.update).toHaveBeenCalledTimes(2);
        });

        it('devrait retourner 400 si le nouveau tour est déjà détenu par un membre du groupe absent de la requête', async () => {
            // Bug réel corrigé : sans ce contrôle, réordonner UNIQUEMENT le participant C vers
            // le tour 2 pouvait entrer en collision avec le tour du participant B (non inclus
            // dans cette requête) — executeTontineCycle n'a aucun tri et ne peut alors payer
            // que l'un des deux, l'autre restant exclu de tout paiement pour toujours.
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', creatorId: 'test_user_id', status: 'ACTIVE' });
            (prisma.tontineParticipant.findMany as jest.Mock)
                .mockResolvedValueOnce([{ id: 'p3' }]) // IDOR guard : p3 appartient bien au groupe
                .mockResolvedValueOnce([{ payoutOrder: 2 }]); // participant B (absent de la requête) détient déjà le tour 2

            const res = await request(app)
                .post('/tontine/reorder')
                .send({ groupId: 'group1', orderMap: [{ participantId: 'p3', newOrder: 2 }] });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà occupé');
            expect(prisma.tontineParticipant.update).not.toHaveBeenCalled();
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

        it('devrait retourner 400 si le club est suspendu par l\'administration (isPaused)', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: true, isPaused: true });

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(400);
        });

        it('devrait rejoindre le club avec succès', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: true, name: 'Club A', contribution: 1000, currentCycle: 1 });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ payoutOrder: 1 }, { payoutOrder: 2 }, { payoutOrder: 3 }]);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 4 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'test_user_id', tontineGroupId: 'group1', payoutOrder: 4 }
            });
        });

        // Régression : voir le test équivalent sur POST /invite — un ex-membre LEFT ne doit
        // plus jamais bloquer l'ordre de passage des membres actuellement actifs.
        it('devrait placer le nouveau membre après le dernier tour ACTIF, pas après le nombre total de lignes historiques', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'group1', status: 'ACTIVE', isPublic: true, name: 'Club A', contribution: 1000, currentCycle: 5 });
            (prisma.tontineParticipant.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([{ payoutOrder: 5 }, { payoutOrder: 6 }]);
            (prisma.tontineParticipant.create as jest.Mock).mockResolvedValue({ id: 'p_new', payoutOrder: 7 });

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(200);
            expect(prisma.tontineParticipant.create).toHaveBeenCalledWith({
                data: { userId: 'test_user_id', tontineGroupId: 'group1', payoutOrder: 7 }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/join').send({ groupId: 'group1' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /tontine/cancel
    // ==========================================
    describe('POST /tontine/cancel', () => {
        it('devrait retourner 404 si le club est introuvable', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'ghost' });

            expect(res.status).toBe(404);
        });

        it("devrait retourner 403 si l'appelant n'est pas le créateur", async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'someone_else', status: 'ACTIVE' });

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'g1' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le club est déjà dissous', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id', status: 'CANCELLED' });

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'g1' });

            expect(res.status).toBe(400);
        });

        it('devrait refuser la dissolution si un versement est encore bloqué', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id', status: 'ACTIVE', name: 'Club A' });
            (prisma.tontineCycle.findFirst as jest.Mock).mockResolvedValue({ id: 'c1', cycleNumber: 4, status: 'PAYOUT_FAILED' });

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'g1' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('#4');
            expect(prisma.tontineGroup.update).not.toHaveBeenCalled();
        });

        it('devrait dissoudre le club et notifier les autres participants actifs (base + push)', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockResolvedValue({ id: 'g1', creatorId: 'test_user_id', status: 'ACTIVE', name: 'Club A' });
            (prisma.tontineCycle.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.tontineGroup.update as jest.Mock).mockResolvedValue({ id: 'g1', status: 'CANCELLED' });
            (prisma.tontineParticipant.findMany as jest.Mock).mockResolvedValue([
                { userId: 'u2', user: { pushToken: 'tok2' } },
                { userId: 'u3', user: { pushToken: null } },
            ]);

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'g1' });

            expect(res.status).toBe(200);
            expect(prisma.tontineGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { status: 'CANCELLED' } });
            expect(prisma.tontineParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { tontineGroupId: 'g1', status: 'ACTIVE', userId: { not: 'test_user_id' } },
            }));
            expect(prisma.notification.createMany).toHaveBeenCalledWith({
                data: [
                    expect.objectContaining({ userId: 'u2', title: 'Tontine dissoute' }),
                    expect.objectContaining({ userId: 'u3', title: 'Tontine dissoute' }),
                ],
            });
            expect(sendPush).toHaveBeenCalledWith('tok2', 'Tontine dissoute', expect.any(String));
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.tontineGroup.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/tontine/cancel').send({ groupId: 'g1' });

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
