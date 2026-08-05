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
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, jwtVersion?: number };
        const userCheck = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!userCheck) throw new Error('User not found');
        if (userCheck.isActive === false) {
            return res.status(403).json({ error: 'Votre compte a été suspendu.' });
        }

        // Single Device Session Restriction
        if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== userCheck.jwtVersion) {
            return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté sur un autre appareil.' });
        }

        req.userId = decoded.userId;
        next();
    } catch {
        return res.status(401).json({ error: 'Token expiré ou invalide.' });
    }
};
