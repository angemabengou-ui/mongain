import { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../prisma';
import { authMiddleware, AuthRequest } from '../auth';

// Mocking dependencies
jest.mock('jsonwebtoken');
jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findUnique: jest.fn() },
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
