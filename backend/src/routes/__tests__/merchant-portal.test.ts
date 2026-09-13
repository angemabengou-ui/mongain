import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { JWT_SECRET } from '../../middleware/auth';
import { prisma } from '../../prisma';
import merchantPortalRoutes from '../merchant-portal';

// authMerchantPortal lui-même est testé en isolation dans
// middleware/__tests__/auth.test.ts (accepte portal+GIANT, rejette mobile/tier
// normal/portalTokenVersion périmé). Ici, un simple pass-through avec un userId fixe — même
// convention que merchant.test.ts/b2b.test.ts pour authMiddleware — pour tester la logique
// PROPRE à merchant-portal.ts (routing, tier, affiliations, dashboard...) indépendamment de
// la vérification du token. Tout le reste du module (JWT_SECRET, ACCESS_TOKEN_TTL,
// generateRefreshToken, hashRefreshToken) reste réel : les routes /auth/login,
// /auth/verify-otp et /auth/refresh les utilisent directement, pas seulement via le
// middleware.
// authMerchantPortal réel testé en isolation dans middleware/__tests__/auth.test.ts (memberId,
// portalRole, requirePortalAdmin...) — ici, un pass-through paramétrable via
// __setMockPortalRole/__setMockPortalMemberId (réinitialisé à ADMIN/undefined dans le
// beforeEach global) pour vérifier que requirePortalAdmin est bien câblé sur les bonnes routes
// de merchant-portal.ts sans reproduire toute la logique du token dans ce fichier.
jest.mock('../../middleware/auth', () => {
    const actual = jest.requireActual('../../middleware/auth');
    let mockPortalRole: 'ADMIN' | 'VIEWER' = 'ADMIN';
    let mockPortalMemberId: string | undefined;
    return {
        ...actual,
        __setMockPortalRole: (role: 'ADMIN' | 'VIEWER') => { mockPortalRole = role; },
        __setMockPortalMemberId: (id: string | undefined) => { mockPortalMemberId = id; },
        authMerchantPortal: (req: any, _res: any, next: any) => {
            req.userId = 'giant_1';
            req.portalRole = mockPortalRole;
            req.portalMemberId = mockPortalMemberId;
            next();
        },
    };
});
const { __setMockPortalRole, __setMockPortalMemberId } = jest.requireMock('../../middleware/auth') as {
    __setMockPortalRole: (role: 'ADMIN' | 'VIEWER') => void;
    __setMockPortalMemberId: (id: string | undefined) => void;
};

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        verificationCode: { upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
        merchantAffiliation: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        merchantPortalMember: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        merchantEmployee: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        notification: { create: jest.fn() },
        transaction: { aggregate: jest.fn(), findFirst: jest.fn() },
        merchantPayoutRequest: { findMany: jest.fn() },
    },
}));

jest.mock('../../services/sms', () => ({
    sendSms: jest.fn(),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({ timezone: 'Africa/Libreville' }),
}));

const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../wallet', () => ({
    sendPush: (...args: any[]) => mockSendPush(...args),
}));

// runMassPayout/createMerchantPayoutRequest ont déjà leur propre couverture complète dans
// b2b.test.ts et merchant.test.ts — mockés ici pour vérifier uniquement que
// merchant-portal.ts les appelle correctement (bon utilisateur chargé, bonne garde 404),
// sans reproduire toute la logique métier de paiement.
const mockRunMassPayout = jest.fn((_user: any, _req: any, res: any) => res.status(202).json({ success: true, via: 'runMassPayout' }));
jest.mock('../b2b', () => ({
    runMassPayout: (...args: any[]) => (mockRunMassPayout as any)(...args),
}));

const mockCreateMerchantPayoutRequest = jest.fn();
jest.mock('../merchant', () => {
    // Déclarée À L'INTÉRIEUR de la factory (pas en variable externe) : jest.mock() est hoisté
    // par babel au-dessus de TOUT le reste du fichier, y compris une classe déclarée plus bas
    // (les déclarations `class` restent en zone morte temporelle) — une référence externe ici
    // provoquait un "Cannot access before initialization" à l'exécution, même en respectant la
    // convention de nommage `mock*` de jest (qui ne dispense que du contrôle statique de babel,
    // pas de l'ordre d'exécution réel).
    class MockPayoutValidationError extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    }
    return {
        createMerchantPayoutRequest: (...args: any[]) => (mockCreateMerchantPayoutRequest as any)(...args),
        PayoutValidationError: MockPayoutValidationError,
    };
});
// Récupéré depuis le module déjà mocké ci-dessus (plutôt qu'une variable externe) pour que le
// `new MockPayoutValidationError(...)` utilisé plus bas dans les tests soit la MÊME classe que
// celle réellement lancée par merchant-portal.ts via son import de '../merchant'.
const { PayoutValidationError: MockPayoutValidationError } = jest.requireMock('../merchant') as { PayoutValidationError: new (status: number, message: string) => Error & { status: number } };

const app = express();
app.use(express.json());
app.use('/merchant-portal', merchantPortalRoutes);

describe('Merchant Portal Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __setMockPortalRole('ADMIN');
        __setMockPortalMemberId(undefined);
    });

    // ==========================================
    // AUTH : LOGIN -> VERIFY-OTP -> REFRESH -> LOGOUT
    // ==========================================
    describe('POST /merchant-portal/auth/login', () => {
        it('devrait retourner 404 générique si le numéro n\'existe pas ou n\'est pas GIANT', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/merchant-portal/auth/login').send({ phone: '077000000' });

            expect(res.status).toBe(404);
            expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { phone: '077000000', merchantTier: 'GIANT' } });
        });

        it('devrait générer un OTP (purpose PORTAL_LOGIN, isolé du LOGIN mobile) pour un géant existant', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'giant_1', phone: '077000000', merchantTier: 'GIANT' });

            const res = await request(app).post('/merchant-portal/auth/login').send({ phone: '077000000' });

            expect(res.status).toBe(200);
            expect(res.body.requireOtp).toBe(true);
            expect(prisma.verificationCode.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { phone_purpose: { phone: '077000000', purpose: 'PORTAL_LOGIN' } },
            }));
        });
    });

    describe('POST /merchant-portal/auth/verify-otp', () => {
        it('devrait retourner 404 si le compte n\'est pas/plus GIANT', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077000000', otpCode: '1234' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 403 si le compte géant est suspendu', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'giant_1', phone: '077000000', merchantTier: 'GIANT', accountStatus: 'SUSPENDED' });

            const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077000000', otpCode: '1234' });

            expect(res.status).toBe(403);
        });

        it('devrait rejeter un code OTP invalide ou expiré', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'giant_1', phone: '077000000', merchantTier: 'GIANT', accountStatus: 'ACTIVE' });
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077000000', otpCode: '0000' });

            expect(res.status).toBe(400);
        });

        it('devrait émettre un token portail (portal:true) et ne JAMAIS toucher jwtVersion/refreshTokenHash (session mobile)', async () => {
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({
                id: 'giant_1', name: 'Mairie de Libreville', phone: '077000000', merchantTier: 'GIANT', accountStatus: 'ACTIVE',
            });
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue({ code: '1234', expiresAt: new Date(Date.now() + 60000) });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'giant_1', portalTokenVersion: 1 });

            const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077000000', otpCode: '1234' });

            expect(res.status).toBe(200);
            expect(res.body.token).toEqual(expect.any(String));
            expect(res.body.refreshToken).toEqual(expect.any(String));

            expect(prisma.verificationCode.delete).toHaveBeenCalledWith({ where: { phone_purpose: { phone: '077000000', purpose: 'PORTAL_LOGIN' } } });

            const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
            expect(updateCall.where).toEqual({ id: 'giant_1' });
            expect(updateCall.data).toEqual(expect.objectContaining({
                portalTokenVersion: { increment: 1 },
                portalRefreshTokenHash: expect.any(String),
                portalRefreshTokenExpiresAt: expect.any(Date),
            }));
            // Les deux jetons doivent coexister : cette route ne doit jamais écrire les champs
            // de la session mobile (jwtVersion/refreshTokenHash).
            expect(updateCall.data).not.toHaveProperty('jwtVersion');
            expect(updateCall.data).not.toHaveProperty('refreshTokenHash');

            const decoded = jwt.verify(res.body.token, JWT_SECRET) as { userId: string; portal: boolean; portalTokenVersion: number };
            expect(decoded.userId).toBe('giant_1');
            expect(decoded.portal).toBe(true);
            expect(decoded.portalTokenVersion).toBe(1);
        });
    });

    describe('POST /merchant-portal/auth/refresh', () => {
        it('devrait rejeter un refresh token inconnu', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/merchant-portal/auth/refresh').send({ refreshToken: 'bogus' });

            expect(res.status).toBe(401);
        });

        it('devrait rejeter un compte qui n\'est plus GIANT (tier retiré depuis)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: null, accountStatus: 'ACTIVE',
                portalRefreshTokenExpiresAt: new Date(Date.now() + 60000),
            });

            const res = await request(app).post('/merchant-portal/auth/refresh').send({ refreshToken: 'valid' });

            expect(res.status).toBe(403);
        });

        it('devrait renouveler la session (rotation) pour un refresh token portail valide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 3,
                portalRefreshTokenExpiresAt: new Date(Date.now() + 60000),
            });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/merchant-portal/auth/refresh').send({ refreshToken: 'valid' });

            expect(res.status).toBe(200);
            expect(res.body.refreshToken).not.toBe('valid');
            const decoded = jwt.verify(res.body.token, JWT_SECRET) as { portal: boolean; portalTokenVersion: number };
            expect(decoded.portal).toBe(true);
            expect(decoded.portalTokenVersion).toBe(3);
        });
    });

    describe('POST /merchant-portal/auth/logout', () => {
        it('devrait purger le refresh token portail et incrémenter portalTokenVersion', async () => {
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/merchant-portal/auth/logout').set('Authorization', 'Bearer whatever');

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'giant_1' },
                data: { portalRefreshTokenHash: null, portalRefreshTokenExpiresAt: null, portalTokenVersion: { increment: 1 } },
            });
        });
    });

    // ==========================================
    // DASHBOARD & RAPPORTS
    // ==========================================
    describe('GET /merchant-portal/dashboard', () => {
        it('devrait retourner 404 si le compte n\'est pas GIANT', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: null, wallet: { id: 'w1', balance: 0 } });

            const res = await request(app).get('/merchant-portal/dashboard');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le solde et les ventes du jour/du mois', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 500000 } });
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: { id: 2 } }) // today
                .mockResolvedValueOnce({ _sum: { amount: 300000 }, _count: { id: 40 } }); // month

            const res = await request(app).get('/merchant-portal/dashboard');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                balance: 500000,
                todaySalesAmount: 10000,
                todaySalesCount: 2,
                monthSalesAmount: 300000,
                monthSalesCount: 40,
            });
        });
    });

    describe('GET /merchant-portal/reports', () => {
        it('devrait retourner une série de 30 jours par défaut', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 0 } });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 1000 }, _count: { id: 1 } });

            const res = await request(app).get('/merchant-portal/reports');

            expect(res.status).toBe(200);
            expect(res.body.period).toBe('day');
            expect(res.body.series).toHaveLength(30);
        });

        it('devrait retourner une série de 12 mois avec ?period=month', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 0 } });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 1000 }, _count: { id: 1 } });

            const res = await request(app).get('/merchant-portal/reports?period=month');

            expect(res.status).toBe(200);
            expect(res.body.period).toBe('month');
            expect(res.body.series).toHaveLength(12);
        });
    });

    // ==========================================
    // AFFILIATIONS (côté géant)
    // ==========================================
    describe('POST /merchant-portal/affiliations', () => {
        it('devrait retourner 400 si merchantPhone est manquant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });

            const res = await request(app).post('/merchant-portal/affiliations').send({});

            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si la cible n\'est pas un marchand (role != MERCHANT)', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' }) // loadGiant
                .mockResolvedValueOnce({ id: 'client_1', role: 'USER' }); // cible

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077111111' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 404 si la cible est elle-même un marchand géant (un géant ne s\'affilie pas un autre géant)', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'giant_2', role: 'MERCHANT', merchantTier: 'GIANT' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077222222' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 409 si une affiliation PENDING ou ACCEPTED existe déjà pour cette paire', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'merchant_1', role: 'MERCHANT', merchantTier: null, name: 'Boutique X', pushToken: null });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', status: 'ACCEPTED' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333' });

            expect(res.status).toBe(409);
            expect(prisma.merchantAffiliation.create).not.toHaveBeenCalled();
        });

        it('devrait créer une affiliation PENDING et notifier le marchand affilié (pushToken renseigné)', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', name: 'Mairie de Libreville', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'merchant_1', role: 'MERCHANT', merchantTier: null, name: 'Boutique X', pushToken: 'ExponentPushToken[m1]' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantAffiliation.create as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'giant_1', merchantId: 'merchant_1', status: 'PENDING' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333' });

            expect(res.status).toBe(201);
            expect(prisma.merchantAffiliation.create).toHaveBeenCalledWith({
                data: { giantId: 'giant_1', merchantId: 'merchant_1', status: 'PENDING' },
            });
            expect(mockSendPush).toHaveBeenCalledWith('ExponentPushToken[m1]', expect.any(String), expect.any(String));
        });

        it('devrait remettre à PENDING une ligne REJECTED/REVOKED existante plutôt que d\'en créer une seconde (contrainte unique)', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', name: 'Mairie de Libreville', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'merchant_1', role: 'MERCHANT', merchantTier: null, name: 'Boutique X', pushToken: null });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff_old', status: 'REJECTED' });
            (prisma.merchantAffiliation.update as jest.Mock).mockResolvedValue({ id: 'aff_old', status: 'PENDING' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333' });

            expect(res.status).toBe(201);
            expect(prisma.merchantAffiliation.create).not.toHaveBeenCalled();
            expect(prisma.merchantAffiliation.update).toHaveBeenCalledWith({
                where: { id: 'aff_old' },
                data: { status: 'PENDING', respondedAt: null, revokedAt: null },
            });
        });

        it('devrait retourner 400 si expectedFrequency est fourni mais invalide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333', expectedFrequency: 'DAILY' });

            expect(res.status).toBe(400);
            expect(prisma.merchantAffiliation.create).not.toHaveBeenCalled();
        });

        it('devrait enregistrer expectedFrequency (MONTHLY/WEEKLY) sur la ligne créée', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', name: 'Mairie de Libreville', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'merchant_1', role: 'MERCHANT', merchantTier: null, name: 'Boutique X', pushToken: null });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantAffiliation.create as jest.Mock).mockResolvedValue({ id: 'aff1', status: 'PENDING', expectedFrequency: 'MONTHLY' });

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333', expectedFrequency: 'MONTHLY' });

            expect(res.status).toBe(201);
            expect(prisma.merchantAffiliation.create).toHaveBeenCalledWith({
                data: { giantId: 'giant_1', merchantId: 'merchant_1', status: 'PENDING', expectedFrequency: 'MONTHLY' },
            });
        });

        it('devrait retourner 403 pour un membre VIEWER (requirePortalAdmin)', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).post('/merchant-portal/affiliations').send({ merchantPhone: '077333333' });

            expect(res.status).toBe(403);
            expect(prisma.user.findUnique).not.toHaveBeenCalled();
        });
    });

    describe('GET /merchant-portal/affiliations', () => {
        it('devrait lister toutes les affiliations du géant avec complianceStatus null quand pas ACCEPTED/pas de fréquence attendue', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            const mockAffiliations = [
                { id: 'aff1', status: 'PENDING', expectedFrequency: null, merchant: { name: 'X', phone: '077', wallet: null } },
                { id: 'aff2', status: 'ACCEPTED', expectedFrequency: null, merchant: { name: 'Y', phone: '078', wallet: { id: 'w2' } } },
            ];
            (prisma.merchantAffiliation.findMany as jest.Mock).mockResolvedValue(mockAffiliations);

            const res = await request(app).get('/merchant-portal/affiliations');

            expect(res.status).toBe(200);
            expect(res.body.affiliations).toEqual(mockAffiliations.map(a => ({ ...a, complianceStatus: null })));
            expect(prisma.merchantAffiliation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { giantId: 'giant_1' } }));
            // Aucune fréquence attendue sur ces lignes -> aucune requête de conformité déclenchée.
            expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
        });

        it('devrait retourner complianceStatus LATE pour une affiliation ACCEPTED/MONTHLY sans versement COMPLETED ce mois-ci', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            const mockAffiliations = [
                { id: 'aff1', status: 'ACCEPTED', expectedFrequency: 'MONTHLY', merchant: { name: 'X', phone: '077', wallet: { id: 'w_merchant' } } },
            ];
            (prisma.merchantAffiliation.findMany as jest.Mock).mockResolvedValue(mockAffiliations);
            (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/merchant-portal/affiliations');

            expect(res.status).toBe(200);
            expect(res.body.affiliations[0].complianceStatus).toBe('LATE');
            expect(prisma.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    senderWalletId: 'w_merchant', receiverWalletId: 'w_giant', status: 'COMPLETED',
                    createdAt: expect.objectContaining({ gte: expect.any(Date) }),
                }),
            }));
        });

        it('devrait retourner complianceStatus OK pour une affiliation ACCEPTED/WEEKLY avec un versement COMPLETED cette semaine', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            const mockAffiliations = [
                { id: 'aff1', status: 'ACCEPTED', expectedFrequency: 'WEEKLY', merchant: { name: 'X', phone: '077', wallet: { id: 'w_merchant' } } },
            ];
            (prisma.merchantAffiliation.findMany as jest.Mock).mockResolvedValue(mockAffiliations);
            (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({ id: 'tx1', amount: 5000 });

            const res = await request(app).get('/merchant-portal/affiliations');

            expect(res.status).toBe(200);
            expect(res.body.affiliations[0].complianceStatus).toBe('OK');
        });
    });

    // Flux complet demandé : création PENDING (ci-dessus) -> ... -> ACCEPTED -> apparaît dans
    // compliance (la réponse elle-même, et son 403 pour le mauvais user, sont testés côté
    // marchand dans merchant.test.ts, POST /merchant/affiliations/:id/respond).
    describe('GET /merchant-portal/affiliations/:id/compliance', () => {
        it('devrait retourner 404 si l\'affiliation n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'un_autre_geant', status: 'ACCEPTED' });

            const res = await request(app).get('/merchant-portal/affiliations/aff1/compliance');

            expect(res.status).toBe(404);
        });

        it('devrait retourner 404 si l\'affiliation n\'est pas (encore) ACCEPTED', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'giant_1', status: 'PENDING' });

            const res = await request(app).get('/merchant-portal/affiliations/aff1/compliance');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le total/dernier versement pour une affiliation ACCEPTED appartenant à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({
                id: 'aff1', giantId: 'giant_1', status: 'ACCEPTED',
                merchant: { name: 'Boutique X', phone: '077333333', wallet: { id: 'w_merchant' } },
            });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 150000 }, _count: { id: 6 } });
            (prisma.transaction.findFirst as jest.Mock).mockResolvedValue({ amount: 25000, createdAt: new Date('2026-09-01') });

            const res = await request(app).get('/merchant-portal/affiliations/aff1/compliance');

            expect(res.status).toBe(200);
            expect(res.body.totalAmount).toBe(150000);
            expect(res.body.totalCount).toBe(6);
            expect(res.body.lastPayment).toEqual({ amount: 25000, date: '2026-09-01T00:00:00.000Z' });
            expect(prisma.transaction.aggregate).toHaveBeenCalledWith(expect.objectContaining({
                where: { senderWalletId: 'w_merchant', receiverWalletId: 'w_giant', status: 'COMPLETED' },
            }));
        });

        it('devrait inclure complianceStatus (LATE) calculé sur la même fenêtre que GET /affiliations', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w_giant' } });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({
                id: 'aff1', giantId: 'giant_1', status: 'ACCEPTED', expectedFrequency: 'MONTHLY',
                merchant: { name: 'Boutique X', phone: '077333333', wallet: { id: 'w_merchant' } },
            });
            (prisma.transaction.aggregate as jest.Mock).mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } });
            (prisma.transaction.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/merchant-portal/affiliations/aff1/compliance');

            expect(res.status).toBe(200);
            expect(res.body.complianceStatus).toBe('LATE');
        });
    });

    describe('PATCH /merchant-portal/affiliations/:id/expected-frequency', () => {
        it('devrait retourner 400 si expectedFrequency est invalide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });

            const res = await request(app).patch('/merchant-portal/affiliations/aff1/expected-frequency').send({ expectedFrequency: 'DAILY' });

            expect(res.status).toBe(400);
            expect(prisma.merchantAffiliation.update).not.toHaveBeenCalled();
        });

        it('devrait retourner 404 si l\'affiliation n\'est pas ACCEPTED ou n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'giant_1', status: 'PENDING' });

            const res = await request(app).patch('/merchant-portal/affiliations/aff1/expected-frequency').send({ expectedFrequency: 'MONTHLY' });

            expect(res.status).toBe(404);
        });

        it('devrait mettre à jour expectedFrequency sur une affiliation ACCEPTED', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'giant_1', status: 'ACCEPTED' });
            (prisma.merchantAffiliation.update as jest.Mock).mockResolvedValue({ id: 'aff1', expectedFrequency: 'WEEKLY' });

            const res = await request(app).patch('/merchant-portal/affiliations/aff1/expected-frequency').send({ expectedFrequency: 'WEEKLY' });

            expect(res.status).toBe(200);
            expect(prisma.merchantAffiliation.update).toHaveBeenCalledWith({
                where: { id: 'aff1' },
                data: { expectedFrequency: 'WEEKLY' },
            });
        });

        it('devrait accepter null pour effacer la fréquence attendue', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'giant_1', status: 'ACCEPTED' });
            (prisma.merchantAffiliation.update as jest.Mock).mockResolvedValue({ id: 'aff1', expectedFrequency: null });

            const res = await request(app).patch('/merchant-portal/affiliations/aff1/expected-frequency').send({ expectedFrequency: null });

            expect(res.status).toBe(200);
        });

        it('devrait retourner 403 pour un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).patch('/merchant-portal/affiliations/aff1/expected-frequency').send({ expectedFrequency: 'WEEKLY' });

            expect(res.status).toBe(403);
        });
    });

    describe('DELETE /merchant-portal/affiliations/:id', () => {
        it('devrait retourner 404 si l\'affiliation n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({ id: 'aff1', giantId: 'un_autre_geant' });

            const res = await request(app).delete('/merchant-portal/affiliations/aff1');

            expect(res.status).toBe(404);
            expect(prisma.merchantAffiliation.update).not.toHaveBeenCalled();
        });

        it('devrait révoquer l\'affiliation et notifier le marchand affilié', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', name: 'Mairie de Libreville', merchantTier: 'GIANT' });
            (prisma.merchantAffiliation.findUnique as jest.Mock).mockResolvedValue({
                id: 'aff1', giantId: 'giant_1', status: 'ACCEPTED', merchant: { id: 'merchant_1', pushToken: 'ExponentPushToken[m1]' },
            });
            (prisma.merchantAffiliation.update as jest.Mock).mockResolvedValue({ id: 'aff1', status: 'REVOKED' });

            const res = await request(app).delete('/merchant-portal/affiliations/aff1');

            expect(res.status).toBe(200);
            expect(prisma.merchantAffiliation.update).toHaveBeenCalledWith({
                where: { id: 'aff1' },
                data: { status: 'REVOKED', revokedAt: expect.any(Date) },
            });
            expect(mockSendPush).toHaveBeenCalledWith('ExponentPushToken[m1]', expect.any(String), expect.any(String));
        });

        it('devrait retourner 403 pour un membre VIEWER (requirePortalAdmin)', async () => {
            __setMockPortalRole('VIEWER');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });

            const res = await request(app).delete('/merchant-portal/affiliations/aff1');

            expect(res.status).toBe(403);
            expect(prisma.merchantAffiliation.update).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // MOUVEMENTS D'ARGENT (réutilisent b2b.ts/merchant.ts)
    // ==========================================
    describe('POST /merchant-portal/payouts', () => {
        it('devrait retourner 404 si le compte n\'est pas GIANT', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: null });

            const res = await request(app).post('/merchant-portal/payouts').send({ entries: [] });

            expect(res.status).toBe(404);
            expect(mockRunMassPayout).not.toHaveBeenCalled();
        });

        it('devrait déléguer à runMassPayout (b2b.ts) pour un géant valide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 1000000 } });

            const res = await request(app).post('/merchant-portal/payouts').send({ entries: [{ phone: '077000001', amount: 1000 }], pin: '1234' });

            expect(res.status).toBe(202);
            expect(mockRunMassPayout).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'giant_1' }),
                expect.anything(),
                expect.anything()
            );
        });

        it('devrait retourner 403 pour un membre VIEWER (requirePortalAdmin)', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).post('/merchant-portal/payouts').send({ entries: [{ phone: '077000001', amount: 1000 }], pin: '1234' });

            expect(res.status).toBe(403);
            expect(mockRunMassPayout).not.toHaveBeenCalled();
        });
    });

    describe('POST /merchant-portal/withdraw-to-agency', () => {
        it('devrait déléguer à createMerchantPayoutRequest (merchant.ts) et renvoyer 201', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 1000000 } });
            mockCreateMerchantPayoutRequest.mockResolvedValue({ id: 'payout1', status: 'PENDING' });

            const res = await request(app).post('/merchant-portal/withdraw-to-agency').send({ sourceAccount: 'SALES', amount: 5000 });

            expect(res.status).toBe(201);
            expect(res.body.data).toEqual({ id: 'payout1', status: 'PENDING' });
            expect(mockCreateMerchantPayoutRequest).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'giant_1' }),
                expect.objectContaining({ sourceAccount: 'SALES', amount: 5000 })
            );
        });

        it('devrait convertir une PayoutValidationError en la réponse HTTP correspondante', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', wallet: { id: 'w1', balance: 100 } });
            mockCreateMerchantPayoutRequest.mockRejectedValue(new MockPayoutValidationError(400, 'Solde insuffisant sur le compte sélectionné.'));

            const res = await request(app).post('/merchant-portal/withdraw-to-agency').send({ sourceAccount: 'SALES', amount: 999999 });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Solde insuffisant sur le compte sélectionné.');
        });
    });

    describe('GET /merchant-portal/withdraw-to-agency', () => {
        it("devrait retourner l'historique des demandes du géant", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            const mockPayouts = [{ id: 'p1', status: 'PENDING' }];
            (prisma.merchantPayoutRequest.findMany as jest.Mock).mockResolvedValue(mockPayouts);

            const res = await request(app).get('/merchant-portal/withdraw-to-agency');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual(mockPayouts);
            expect(prisma.merchantPayoutRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'giant_1' } }));
        });
    });

    // ==========================================
    // CONNEXION D'UN MEMBRE D'ÉQUIPE (AUTH)
    // ==========================================
    // authMerchantPortal réel (memberId, tokenVersion, portalRole...) est testé en isolation
    // dans middleware/__tests__/auth.test.ts — ici on vérifie que /auth/login et
    // /auth/verify-otp savent RECONNAÎTRE un numéro de membre et émettre le bon JWT
    // (userId = géant, memberId + role présents), pas le middleware lui-même.
    describe('Connexion via un membre d\'équipe', () => {
        describe('POST /merchant-portal/auth/login', () => {
            it('devrait chercher un membre actif si aucun géant ne correspond au numéro', async () => {
                (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
                (prisma.merchantPortalMember.findFirst as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'giant_1', phone: '077444444', isActive: true });

                const res = await request(app).post('/merchant-portal/auth/login').send({ phone: '077444444' });

                expect(res.status).toBe(200);
                expect(res.body.requireOtp).toBe(true);
                expect(prisma.merchantPortalMember.findFirst).toHaveBeenCalledWith({ where: { phone: '077444444', isActive: true } });
            });

            it('ne devrait PAS chercher de membre si un géant correspond déjà (court-circuit)', async () => {
                (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'giant_1', phone: '077000000', merchantTier: 'GIANT' });

                const res = await request(app).post('/merchant-portal/auth/login').send({ phone: '077000000' });

                expect(res.status).toBe(200);
                expect(prisma.merchantPortalMember.findFirst).not.toHaveBeenCalled();
            });
        });

        describe('POST /merchant-portal/auth/verify-otp', () => {
            it('devrait émettre un JWT avec userId = ID DU GÉANT (jamais celui du membre), memberId et role', async () => {
                (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
                (prisma.merchantPortalMember.findFirst as jest.Mock).mockResolvedValue({
                    id: 'member_1', giantId: 'giant_1', phone: '077444444', name: 'Comptable', role: 'VIEWER', isActive: true, tokenVersion: 0,
                });
                (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', name: 'Mairie de Libreville' });
                (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue({ code: '1234', expiresAt: new Date(Date.now() + 60000) });
                (prisma.merchantPortalMember.update as jest.Mock).mockResolvedValue({ id: 'member_1', tokenVersion: 1, role: 'VIEWER' });

                const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077444444', otpCode: '1234' });

                expect(res.status).toBe(200);
                expect(res.body.user.portalRole).toBe('VIEWER');
                expect(res.body.user.name).toBe('Comptable');

                // Rotation sur les champs DU MEMBRE, jamais portalTokenVersion/portalRefreshTokenHash du géant.
                expect(prisma.merchantPortalMember.update).toHaveBeenCalledWith({
                    where: { id: 'member_1' },
                    data: { tokenVersion: { increment: 1 }, refreshTokenHash: expect.any(String), refreshTokenExpiresAt: expect.any(Date) },
                });
                expect(prisma.user.update).not.toHaveBeenCalled();

                const decoded = jwt.verify(res.body.token, JWT_SECRET) as { userId: string; memberId: string; role: string; portal: boolean };
                expect(decoded.userId).toBe('giant_1'); // jamais 'member_1'
                expect(decoded.memberId).toBe('member_1');
                expect(decoded.role).toBe('VIEWER');
                expect(decoded.portal).toBe(true);
            });

            it('devrait rejeter la connexion d\'un membre si le géant propriétaire est suspendu', async () => {
                (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
                (prisma.merchantPortalMember.findFirst as jest.Mock).mockResolvedValue({
                    id: 'member_1', giantId: 'giant_1', phone: '077444444', isActive: true,
                });
                (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'SUSPENDED' });

                const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077444444', otpCode: '1234' });

                expect(res.status).toBe(403);
            });

            it('devrait retourner 404 si ni un géant ni un membre actif ne correspond au numéro', async () => {
                (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
                (prisma.merchantPortalMember.findFirst as jest.Mock).mockResolvedValue(null);

                const res = await request(app).post('/merchant-portal/auth/verify-otp').send({ phone: '077444444', otpCode: '1234' });

                expect(res.status).toBe(404);
            });
        });

        describe('POST /merchant-portal/auth/refresh', () => {
            it('devrait faire tourner le refresh token DU MEMBRE (pas celui du géant) quand le hash correspond à un membre', async () => {
                (prisma.user.findUnique as jest.Mock)
                    .mockResolvedValueOnce(null) // recherche géant par portalRefreshTokenHash : aucun match
                    .mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE' }); // owner du membre
                (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({
                    id: 'member_1', giantId: 'giant_1', role: 'ADMIN', isActive: true, tokenVersion: 4,
                    refreshTokenExpiresAt: new Date(Date.now() + 60000),
                });
                (prisma.merchantPortalMember.update as jest.Mock).mockResolvedValue({ id: 'member_1', tokenVersion: 4, role: 'ADMIN' });

                const res = await request(app).post('/merchant-portal/auth/refresh').send({ refreshToken: 'member_refresh_token' });

                expect(res.status).toBe(200);
                expect(prisma.user.update).not.toHaveBeenCalled();
                const decoded = jwt.verify(res.body.token, JWT_SECRET) as { userId: string; memberId: string };
                expect(decoded.userId).toBe('giant_1');
                expect(decoded.memberId).toBe('member_1');
            });
        });

        describe('POST /merchant-portal/auth/logout', () => {
            it('devrait couper la session DU MEMBRE (pas celle du géant) quand req.portalMemberId est renseigné', async () => {
                __setMockPortalMemberId('member_1');
                (prisma.merchantPortalMember.update as jest.Mock).mockResolvedValue({});

                const res = await request(app).post('/merchant-portal/auth/logout').set('Authorization', 'Bearer whatever');

                expect(res.status).toBe(200);
                expect(prisma.merchantPortalMember.update).toHaveBeenCalledWith({
                    where: { id: 'member_1' },
                    data: { refreshTokenHash: null, refreshTokenExpiresAt: null, tokenVersion: { increment: 1 } },
                });
                expect(prisma.user.update).not.toHaveBeenCalled();
            });
        });
    });

    // ==========================================
    // ÉQUIPE DU PORTAIL (NIVEAUX DE PERMISSION)
    // ==========================================
    describe('GET /merchant-portal/team', () => {
        it('devrait lister les membres du géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            const mockMembers = [{ id: 'member_1', name: 'Comptable', role: 'VIEWER' }];
            (prisma.merchantPortalMember.findMany as jest.Mock).mockResolvedValue(mockMembers);

            const res = await request(app).get('/merchant-portal/team');

            expect(res.status).toBe(200);
            expect(res.body.members).toEqual(mockMembers);
            expect(prisma.merchantPortalMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { giantId: 'giant_1' } }));
        });

        it('devrait rester accessible à un membre VIEWER (lecture)', async () => {
            __setMockPortalRole('VIEWER');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/merchant-portal/team');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /merchant-portal/team', () => {
        it('devrait retourner 403 pour un membre VIEWER (requirePortalAdmin)', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).post('/merchant-portal/team').send({ name: 'Comptable', phone: '077555555', role: 'VIEWER' });

            expect(res.status).toBe(403);
            expect(prisma.merchantPortalMember.create).not.toHaveBeenCalled();
        });

        it('devrait retourner 400 si role n\'est ni ADMIN ni VIEWER', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });

            const res = await request(app).post('/merchant-portal/team').send({ name: 'Comptable', phone: '077555555', role: 'SUPERADMIN' });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 409 si le téléphone correspond déjà à un User existant', async () => {
            // 1er appel consommé par loadGiant, le 2nd par la vérification "déjà un User" de
            // la route (les deux via prisma.user.findUnique).
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' })
                .mockResolvedValueOnce({ id: 'existing_user' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/merchant-portal/team').send({ name: 'Comptable', phone: '077555555', role: 'VIEWER' });

            expect(res.status).toBe(409);
            expect(prisma.merchantPortalMember.create).not.toHaveBeenCalled();
        });

        it('devrait retourner 409 si le téléphone correspond déjà à un membre existant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' }).mockResolvedValueOnce(null);
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_existing' });

            const res = await request(app).post('/merchant-portal/team').send({ name: 'Comptable', phone: '077555555', role: 'VIEWER' });

            expect(res.status).toBe(409);
        });

        it('devrait créer un membre ADMIN avec succès', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'giant_1', merchantTier: 'GIANT' }).mockResolvedValueOnce(null);
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantPortalMember.create as jest.Mock).mockResolvedValue({ id: 'member_new', name: 'Directeur', role: 'ADMIN' });

            const res = await request(app).post('/merchant-portal/team').send({ name: 'Directeur', phone: '077666666', role: 'ADMIN' });

            expect(res.status).toBe(201);
            expect(prisma.merchantPortalMember.create).toHaveBeenCalledWith({
                data: { giantId: 'giant_1', name: 'Directeur', phone: '077666666', role: 'ADMIN' },
            });
        });
    });

    describe('PATCH /merchant-portal/team/:id', () => {
        it('devrait retourner 403 pour un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).patch('/merchant-portal/team/member_1').send({ role: 'ADMIN' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le membre n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'un_autre_geant' });

            const res = await request(app).patch('/merchant-portal/team/member_1').send({ role: 'ADMIN' });

            expect(res.status).toBe(404);
        });

        it('devrait bump tokenVersion en plus de isActive quand isActive passe à false (coupe la session immédiatement)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'giant_1', isActive: true });
            (prisma.merchantPortalMember.update as jest.Mock).mockResolvedValue({ id: 'member_1', isActive: false });

            const res = await request(app).patch('/merchant-portal/team/member_1').send({ isActive: false });

            expect(res.status).toBe(200);
            expect(prisma.merchantPortalMember.update).toHaveBeenCalledWith({
                where: { id: 'member_1' },
                data: { isActive: false, tokenVersion: { increment: 1 } },
            });
        });

        it('ne devrait PAS bump tokenVersion quand isActive passe à true', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'giant_1', isActive: false });
            (prisma.merchantPortalMember.update as jest.Mock).mockResolvedValue({ id: 'member_1', isActive: true });

            const res = await request(app).patch('/merchant-portal/team/member_1').send({ isActive: true });

            expect(res.status).toBe(200);
            expect(prisma.merchantPortalMember.update).toHaveBeenCalledWith({
                where: { id: 'member_1' },
                data: { isActive: true },
            });
        });
    });

    describe('DELETE /merchant-portal/team/:id', () => {
        it('devrait retourner 403 pour un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).delete('/merchant-portal/team/member_1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le membre n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'un_autre_geant' });

            const res = await request(app).delete('/merchant-portal/team/member_1');

            expect(res.status).toBe(404);
        });

        it('devrait supprimer le membre', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({ id: 'member_1', giantId: 'giant_1' });
            (prisma.merchantPortalMember.delete as jest.Mock).mockResolvedValue({});

            const res = await request(app).delete('/merchant-portal/team/member_1');

            expect(res.status).toBe(200);
            expect(prisma.merchantPortalMember.delete).toHaveBeenCalledWith({ where: { id: 'member_1' } });
        });
    });

    // ==========================================
    // RÉPERTOIRE D'EMPLOYÉS (CÔTÉ GÉANT)
    // ==========================================
    describe('GET /merchant-portal/employees', () => {
        it('devrait lister les employés actifs du géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            const mockEmployees = [{ id: 'emp1', name: 'Jean', phone: '077000001' }];
            (prisma.merchantEmployee.findMany as jest.Mock).mockResolvedValue(mockEmployees);

            const res = await request(app).get('/merchant-portal/employees');

            expect(res.status).toBe(200);
            expect(res.body.employees).toEqual(mockEmployees);
            expect(prisma.merchantEmployee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'giant_1', isActive: true } }));
        });

        it('devrait rester accessible à un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantEmployee.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/merchant-portal/employees');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /merchant-portal/employees', () => {
        it('devrait retourner 403 pour un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).post('/merchant-portal/employees').send({ name: 'Jean', phone: '077000001' });

            expect(res.status).toBe(403);
        });

        it('devrait créer un employé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantEmployee.create as jest.Mock).mockResolvedValue({ id: 'emp1', name: 'Jean', phone: '077000001' });

            const res = await request(app).post('/merchant-portal/employees').send({ name: 'Jean', phone: '077000001' });

            expect(res.status).toBe(201);
            expect(prisma.merchantEmployee.create).toHaveBeenCalledWith({
                data: { merchantId: 'giant_1', name: 'Jean', phone: '077000001' },
            });
        });

        it('devrait retourner 409 en cas de doublon (P2002 sur @@unique([merchantId, phone]))', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantEmployee.create as jest.Mock).mockRejectedValue({ code: 'P2002' });

            const res = await request(app).post('/merchant-portal/employees').send({ name: 'Jean', phone: '077000001' });

            expect(res.status).toBe(409);
        });
    });

    describe('DELETE /merchant-portal/employees/:id', () => {
        it('devrait retourner 403 pour un membre VIEWER', async () => {
            __setMockPortalRole('VIEWER');

            const res = await request(app).delete('/merchant-portal/employees/emp1');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si l\'employé n\'appartient pas à ce géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantEmployee.findUnique as jest.Mock).mockResolvedValue({ id: 'emp1', merchantId: 'un_autre_geant' });

            const res = await request(app).delete('/merchant-portal/employees/emp1');

            expect(res.status).toBe(404);
        });

        it('devrait désactiver (pas supprimer) l\'employé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'giant_1', merchantTier: 'GIANT' });
            (prisma.merchantEmployee.findUnique as jest.Mock).mockResolvedValue({ id: 'emp1', merchantId: 'giant_1' });
            (prisma.merchantEmployee.update as jest.Mock).mockResolvedValue({ id: 'emp1', isActive: false });

            const res = await request(app).delete('/merchant-portal/employees/emp1');

            expect(res.status).toBe(200);
            expect(prisma.merchantEmployee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { isActive: false } });
        });
    });
});
