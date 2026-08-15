import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

export const JWT_SECRET = process.env.JWT_SECRET || 'mongain_secret_dev_key';

export interface AuthRequest extends Request {
    userId?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant ou invalide.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, jwtVersion?: number, isCorp?: boolean };

        if (decoded.isCorp) {
            // Enterprise Account Routing (Bypass Consumer checks)
            const staffCheck = await prisma.staff.findUnique({ where: { id: decoded.userId } });
            if (!staffCheck || !staffCheck.isActive) throw new Error('Staff account invalid');
            req.userId = decoded.userId;
            return next();
        }

        const userCheck = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!userCheck) throw new Error('User not found');
        if (userCheck.isActive === false) return res.status(403).json({ error: 'Votre compte a été suspendu.' });

        if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== userCheck.jwtVersion) {
            return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté sur un autre appareil.' });
        }

        req.userId = decoded.userId;
        next();
    } catch {
        return res.status(401).json({ error: 'Token expiré ou invalide.' });
    }
};

export const authCorp = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant.' });
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, isCorp?: boolean };
        if (!decoded.isCorp) return res.status(403).json({ error: 'B2C token rejected on Corporate Gateway' });

        const staff = await prisma.staff.findUnique({ where: { id: decoded.userId } });
        if (!staff || !staff.isActive) return res.status(403).json({ error: 'Staff access denied' });

        req.userId = decoded.userId;
        next();
    } catch {
        return res.status(401).json({ error: 'Token expiré.' });
    }
};
