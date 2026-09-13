import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../prisma';
import { authMerchantPortal, authMiddleware, AuthRequest, requirePortalAdmin } from '../auth';

// Mocking dependencies
jest.mock('jsonwebtoken');
jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findUnique: jest.fn() },
        merchantPortalMember: { findUnique: jest.fn() },
    },
}));

describe('authMiddleware', () => {
    let req: Partial<AuthRequest>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = {
            headers: {}
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    it('devrait retourner 401 si aucun header Authorization n’est présent', async () => {
        await authMiddleware(req as AuthRequest, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant ou invalide.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait retourner 401 si le token ne commence pas par Bearer', async () => {
        req.headers!.authorization = 'Basic token';
        await authMiddleware(req as AuthRequest, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant ou invalide.' });
    });

    it('devrait authentifier un staff corp avec succès', async () => {
        req.headers!.authorization = 'Bearer test_token';
        const decoded = { userId: 'staff_1', isCorp: true, jwtVersion: 1 };
        (jwt.verify as jest.Mock).mockReturnValue(decoded);
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', isActive: true, jwtVersion: 1 });

        await authMiddleware(req as AuthRequest, res as Response, next);

        expect(req.userId).toBe('staff_1');
        expect(next).toHaveBeenCalled();
    });

    it('devrait rejeter un utilisateur Inactif', async () => {
        req.headers!.authorization = 'Bearer test_token';
        const decoded = { userId: 'user_1' };
        (jwt.verify as jest.Mock).mockReturnValue(decoded);
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user_1', isActive: false });

        await authMiddleware(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Votre compte a été suspendu.' });
        expect(next).not.toHaveBeenCalled();
    });
});

// Portail web des marchands géants — chaîne d'authentification séparée de authMiddleware
// ci-dessus (voir commentaire dans middleware/auth.ts) : vérifie un claim `portal: true`
// dédié et compare portalTokenVersion (jamais jwtVersion) à celui stocké sur le User.
describe('authMerchantPortal', () => {
    let req: Partial<AuthRequest>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = { headers: { authorization: 'Bearer portal_token' } };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    it('devrait retourner 401 si aucun header Authorization n’est présent', async () => {
        req.headers = {};
        await authMerchantPortal(req as AuthRequest, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait authentifier un token portail valide pour un marchand géant actif', async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'giant_1', portal: true, portalTokenVersion: 1 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 1
        });

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(req.userId).toBe('giant_1');
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('devrait rejeter un token mobile (sans claim portal) avec 403', async () => {
        // Un token émis par /api/auth/login (jwtVersion, pas de `portal`) ne doit jamais
        // ouvrir le portail géant, même s'il est par ailleurs valide et signé.
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user_1', jwtVersion: 0 });

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Jeton mobile refusé sur le portail marchand.' });
        expect(next).not.toHaveBeenCalled();
        // Ne doit même pas taper la base : le rejet est décidé sur le seul contenu du token.
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('devrait rejeter un marchand normal (merchantTier non-GIANT) avec 403', async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'merchant_1', portal: true, portalTokenVersion: 0 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'merchant_1', merchantTier: null, accountStatus: 'ACTIVE', portalTokenVersion: 0
        });

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Accès réservé aux marchands géants.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait rejeter un compte géant suspendu avec 403', async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'giant_1', portal: true, portalTokenVersion: 0 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'SUSPENDED', portalTokenVersion: 0
        });

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Votre compte a été suspendu.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait rejeter un portalTokenVersion périmé (session invalidée ailleurs) avec 401', async () => {
        // Le token porte encore l'ancienne version (1) alors qu'une reconnexion portail plus
        // récente (ou une suspension admin) a déjà fait avancer portalTokenVersion à 2.
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'giant_1', portal: true, portalTokenVersion: 1 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 2
        });

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Votre session a expiré car vous vous êtes connecté ailleurs.' });
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait rejeter si le User référencé par le token est introuvable', async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'ghost', portal: true, portalTokenVersion: 0 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

        await authMerchantPortal(req as AuthRequest, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Accès réservé aux marchands géants.' });
        expect(next).not.toHaveBeenCalled();
    });

    // Connexion d'un MEMBRE D'ÉQUIPE (voir routes/merchant-portal.ts /auth/verify-otp et
    // schema.prisma MerchantPortalMember) — `userId` du JWT porte l'id du GÉANT (jamais celui
    // du membre), `memberId`/`memberTokenVersion` identifient la session du membre.
    describe('connexion via un membre d\'équipe (decoded.memberId)', () => {
        it('devrait authentifier un membre ADMIN actif : req.userId = géant, req.portalRole = ADMIN', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_1', memberTokenVersion: 2,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 0,
            });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({
                id: 'member_1', giantId: 'giant_1', role: 'ADMIN', isActive: true, tokenVersion: 2,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(req.userId).toBe('giant_1');
            expect(req.portalRole).toBe('ADMIN');
            expect(req.portalMemberId).toBe('member_1');
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('devrait authentifier un membre VIEWER actif avec req.portalRole = VIEWER', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_2', memberTokenVersion: 0,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 0,
            });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({
                id: 'member_2', giantId: 'giant_1', role: 'VIEWER', isActive: true, tokenVersion: 0,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(req.userId).toBe('giant_1');
            expect(req.portalRole).toBe('VIEWER');
            expect(next).toHaveBeenCalled();
        });

        it('devrait rejeter un membre désactivé (isActive: false) avec 401', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_1', memberTokenVersion: 2,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 0,
            });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({
                id: 'member_1', giantId: 'giant_1', role: 'ADMIN', isActive: false, tokenVersion: 2,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it('devrait rejeter un memberTokenVersion périmé (session révoquée) avec 401', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_1', memberTokenVersion: 1,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'ACTIVE', portalTokenVersion: 0,
            });
            (prisma.merchantPortalMember.findUnique as jest.Mock).mockResolvedValue({
                id: 'member_1', giantId: 'giant_1', role: 'ADMIN', isActive: true, tokenVersion: 2,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });

        it('devrait rejeter un membre si le géant propriétaire est suspendu', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_1', memberTokenVersion: 0,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: 'GIANT', accountStatus: 'SUSPENDED', portalTokenVersion: 0,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Votre compte a été suspendu.' });
            expect(next).not.toHaveBeenCalled();
            // Rejeté sur le seul statut du géant, avant même de recharger le membre.
            expect(prisma.merchantPortalMember.findUnique).not.toHaveBeenCalled();
        });

        it('devrait rejeter un membre si le géant propriétaire n\'est plus GIANT (rétrogradé)', async () => {
            (jwt.verify as jest.Mock).mockReturnValue({
                userId: 'giant_1', portal: true, memberId: 'member_1', memberTokenVersion: 0,
            });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'giant_1', merchantTier: null, accountStatus: 'ACTIVE', portalTokenVersion: 0,
            });

            await authMerchantPortal(req as AuthRequest, res as Response, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Accès réservé aux marchands géants.' });
            expect(next).not.toHaveBeenCalled();
        });
    });
});

// requirePortalAdmin — garde de rôle appliquée sur toutes les routes de mutation du portail
// (voir routes/merchant-portal.ts) : un membre VIEWER ne doit jamais pouvoir créer/modifier/
// supprimer quoi que ce soit, seulement consulter.
describe('requirePortalAdmin', () => {
    let req: Partial<AuthRequest>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        req = {};
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    it('devrait laisser passer un portalRole ADMIN (géant ou membre ADMIN)', () => {
        req.portalRole = 'ADMIN';
        requirePortalAdmin(req as AuthRequest, res as Response, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('devrait bloquer un portalRole VIEWER avec 403', () => {
        req.portalRole = 'VIEWER';
        requirePortalAdmin(req as AuthRequest, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait bloquer un portalRole absent avec 403', () => {
        requirePortalAdmin(req as AuthRequest, res as Response, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });
});
