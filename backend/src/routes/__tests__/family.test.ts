import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import familyRoutes from '../family';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'parent_1';
        next();
    },
}));

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        verificationCode: { count: jest.fn(), upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        auditLog: { create: jest.fn() },
        wallet: { findUnique: jest.fn() },
        transaction: { findMany: jest.fn() },
    },
}));

jest.mock('../../services/sms', () => ({
    isSmsConfigured: false,
    sendSms: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
    hash: jest.fn().mockResolvedValue('hashed-pin'),
    compare: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/family', familyRoutes);

const PARENT = { id: 'parent_1', role: 'USER', pin: 'hashed-parent-pin', failedPinAttempts: 0, lockedUntil: null };

describe('Family Routes (Comptes Enfant)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Contrôle de rôle appliqué à TOUTES les routes de ce fichier (router.use) : par
        // défaut l'appelant est un parent USER normal, sauf override explicite par test.
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(PARENT);
    });

    describe('Contrôle du rôle appelant', () => {
        it('devrait rejeter (403) tout appel si l\'appelant est lui-même un compte CHILD', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'parent_1', role: 'CHILD' });

            const res = await request(app).get('/family/children');

            expect(res.status).toBe(403);
        });
    });

    describe('POST /family/otp', () => {
        it('devrait rejeter un numéro invalide', async () => {
            const res = await request(app).post('/family/otp').send({ phone: '123' });
            expect(res.status).toBe(400);
        });

        it('devrait rejeter si le numéro est déjà inscrit', async () => {
            (prisma.verificationCode.count as jest.Mock).mockResolvedValue(0);
            // Le 2e appel à user.findUnique (après le contrôle de rôle) simule un numéro déjà pris.
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce(PARENT)
                .mockResolvedValueOnce({ id: 'someone_else' });

            const res = await request(app).post('/family/otp').send({ phone: '066123456' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('déjà inscrit');
        });

        it('devrait envoyer le code OTP sous le purpose CHILD_REGISTER', async () => {
            (prisma.verificationCode.count as jest.Mock).mockResolvedValue(0);
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce(PARENT)
                .mockResolvedValueOnce(null);

            const res = await request(app).post('/family/otp').send({ phone: '066123456' });

            expect(res.status).toBe(200);
            expect(prisma.verificationCode.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { phone_purpose: { phone: '066123456', purpose: 'CHILD_REGISTER' } },
            }));
        });
    });

    describe('POST /family/children', () => {
        const validBody = { name: 'Junior', phone: '066123456', pin: '1234', otpCode: '1234', gender: 'MALE' };

        it('devrait rejeter avec 400 si le code OTP est invalide ou expiré', async () => {
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/family/children').send(validBody);

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Code de vérification invalide ou expiré.');
        });

        it('devrait créer le compte enfant rattaché au parent, SANS renvoyer de token', async () => {
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue({ code: '1234', expiresAt: new Date(Date.now() + 60000) });
            (prisma.user.create as jest.Mock).mockResolvedValue({
                id: 'child_1', name: 'Junior', phone: '066123456', gender: 'MALE',
                wallet: { id: 'w_child', balance: 0, currency: 'FCFA' },
            });

            const res = await request(app).post('/family/children').send(validBody);

            expect(res.status).toBe(201);
            expect(res.body.token).toBeUndefined();
            expect(res.body.refreshToken).toBeUndefined();
            expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ role: 'CHILD', parentId: 'parent_1', gender: 'MALE' }),
            }));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ adminId: 'parent_1', action: 'CHILD_ACCOUNT_CREATED' }),
            }));
        });

        it('devrait retourner 400 si le numéro est pris entre l\'OTP et la soumission (P2002)', async () => {
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue({ code: '1234', expiresAt: new Date(Date.now() + 60000) });
            (prisma.user.create as jest.Mock).mockRejectedValue({ code: 'P2002' });

            const res = await request(app).post('/family/children').send(validBody);

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('déjà utilisé');
        });
    });

    describe('GET /family/children', () => {
        it('devrait ne lister que les enfants du parent appelant', async () => {
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'child_1', name: 'Junior' }]);

            const res = await request(app).get('/family/children');

            expect(res.status).toBe(200);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { parentId: 'parent_1', role: 'CHILD' },
            }));
        });
    });

    describe('GET /family/children/:id', () => {
        it('devrait retourner 404 si l\'enfant n\'appartient pas à l\'appelant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/family/children/child_999');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le détail si l\'enfant appartient bien à l\'appelant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1', name: 'Junior' });

            const res = await request(app).get('/family/children/child_1');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('child_1');
        });

        // IDOR (voir audit) : le filtre DOIT porter sur { id, parentId, role } ensemble, jamais
        // sur { id } seul — sans quoi n'importe quel USER authentifié pourrait consulter le
        // compte enfant d'un AUTRE parent en devinant/énumérant son id. `findFirst` étant mocké
        // ci-dessus indépendamment de son `where`, un test qui ne vérifie QUE le code retour ne
        // détecterait pas une régression qui retirerait `parentId: req.userId` de la requête.
        it('devrait filtrer la recherche par { id, parentId: appelant, role: CHILD } (pas id seul)', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1', name: 'Junior' });

            await request(app).get('/family/children/child_1');

            expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'child_1', parentId: 'parent_1', role: 'CHILD' },
            }));
        });
    });

    describe('PUT /family/children/:id/limit', () => {
        const bcrypt = require('bcryptjs');

        it('devrait rejeter si le PIN du parent est incorrect', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const res = await request(app).put('/family/children/child_1/limit').send({ period: 'DAILY', amount: 5000, pin: '0000' });

            expect(res.status).toBe(400);
            // verifyUserPin met bien à jour failedPinAttempts sur le PARENT (comportement
            // normal du verrouillage à 3 échecs), mais ne doit jamais atteindre la recherche ni
            // la mise à jour de l'enfant.
            expect(prisma.user.findFirst).not.toHaveBeenCalled();
            expect(prisma.user.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ childSpendLimitAmount: expect.anything() }) }));
        });

        it('devrait retourner 404 si l\'enfant n\'appartient pas à l\'appelant', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/family/children/child_999/limit').send({ period: 'DAILY', amount: 5000, pin: '1234' });

            expect(res.status).toBe(404);
        });

        // IDOR (voir audit) : même précaution que GET /family/children/:id ci-dessus — le PIN
        // vérifié est bien celui du PARENT (req.userId), mais ENCORE FAUT-IL que l'enfant
        // recherché soit filtré par CE parent, pas seulement par son id. Sans `parentId` dans
        // le where, un parent authentifié pourrait ajuster le plafond du compte enfant de
        // n'importe quel autre parent avec son PROPRE PIN.
        it('devrait filtrer l\'enfant par { id, parentId: appelant, role: CHILD } (pas id seul)', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1', parentId: 'parent_1', role: 'CHILD' });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'child_1', childSpendLimitAmount: 5000, childSpendLimitPeriod: 'DAILY' });

            await request(app).put('/family/children/child_1/limit').send({ period: 'DAILY', amount: 5000, pin: '1234' });

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                where: { id: 'child_1', parentId: 'parent_1', role: 'CHILD' },
            });
        });

        it('devrait plafonner le montant demandé au maximum réglementaire absolu', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1', parentId: 'parent_1', role: 'CHILD' });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'child_1', childSpendLimitAmount: 10000000, childSpendLimitPeriod: 'WEEKLY' });

            const res = await request(app).put('/family/children/child_1/limit').send({ period: 'WEEKLY', amount: 999999999, pin: '1234' });

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'child_1' },
                data: { childSpendLimitAmount: 10000000, childSpendLimitPeriod: 'WEEKLY' },
            });
        });

        it('devrait mettre à jour le plafond et journaliser l\'action', async () => {
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1', parentId: 'parent_1', role: 'CHILD' });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'child_1', childSpendLimitAmount: 5000, childSpendLimitPeriod: 'DAILY' });

            const res = await request(app).put('/family/children/child_1/limit').send({ period: 'DAILY', amount: 5000, pin: '1234' });

            expect(res.status).toBe(200);
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ adminId: 'parent_1', action: 'CHILD_LIMIT_UPDATED' }),
            }));
        });
    });

    // Aucun test n'existait jusqu'ici pour cette route (voir audit) — pourtant c'est LA route de
    // supervision parentale proprement dite (voir historique des transactions de l'enfant dans
    // family-detail.tsx, mobile), et elle a la même surface d'IDOR que les routes ci-dessus.
    describe('GET /family/children/:id/transactions', () => {
        it('devrait retourner 404 si l\'enfant n\'appartient pas à l\'appelant (IDOR)', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/family/children/child_999/transactions');

            expect(res.status).toBe(404);
            expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'child_999', parentId: 'parent_1', role: 'CHILD' },
            }));
            // Ne doit même pas atteindre la recherche du wallet/des transactions de l'enfant.
            expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
        });

        it('devrait retourner 404 si le portefeuille de l\'enfant est introuvable', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/family/children/child_1/transactions');

            expect(res.status).toBe(404);
        });

        it('devrait retourner l\'historique formaté (entrant/sortant) du portefeuille de l\'enfant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'child_1' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_child', currency: 'FCFA' });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([
                {
                    id: 'tx1', amount: 2000, status: 'COMPLETED', reference: 'TRF-1', createdAt: new Date(),
                    senderWalletId: 'w_parent', receiverWalletId: 'w_child',
                    senderWallet: { user: { phone: '+24177000001', name: 'Parent' } },
                    receiverWallet: { user: { phone: '+24177000000', name: 'Junior' } },
                },
            ]);

            const res = await request(app).get('/family/children/child_1/transactions');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([
                expect.objectContaining({ id: 'tx1', type: 'incoming', amount: 2000, counterpart: 'Parent' }),
            ]);
            // Scopé au wallet de CET enfant, jamais à tous les wallets du système.
            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { OR: [{ senderWalletId: 'w_child' }, { receiverWalletId: 'w_child' }] },
            }));
        });
    });
});
