import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET manquant : cette variable d\'environnement est obligatoire en production.');
}

// En dehors de la production, un secret aléatoire est généré à chaque démarrage
// si aucun n'est fourni — évite un secret prévisible codé en dur, au prix d'une
// invalidation des sessions existantes à chaque redémarrage du serveur en dev.
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET non défini — un secret aléatoire a été généré pour cette session (développement uniquement).');
}

export const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

export interface AuthRequest extends Request {
    userId?: string;
}

// ─── Session longue durée (access token court + refresh token) ────────────
// L'access token JWT est volontairement court (contrairement à l'ancien réglage à 7
// jours, qui déconnectait complètement le client après ce délai puisqu'aucun
// mécanisme de renouvellement n'existait). Le refresh token, lui, est un secret
// opaque à haute entropie (pas un JWT) : le client le renvoie à /auth/refresh pour
// obtenir un nouvel access token, avec rotation à chaque appel (fenêtre glissante —
// tant que le client revient au moins une fois tous les REFRESH_TOKEN_TTL_MS, la
// session ne meurt jamais).
export const ACCESS_TOKEN_TTL = '30m';
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours

export function generateRefreshToken(): string {
    return crypto.randomBytes(40).toString('hex');
}

// SHA-256 (pas bcrypt) : le refresh token est déjà un secret aléatoire à haute
// entropie, pas un mot de passe/PIN à faible entropie — un hash rapide et
// déterministe suffit pour le stocker sans le garder en clair, et permet une
// recherche directe par égalité de hash (contrairement à bcrypt, qui est salé et ne
// permettrait pas de retrouver la ligne correspondante sans stocker le token en clair).
export function hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant ou invalide.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string, jwtVersion?: number, isCorp?: boolean };

        if (decoded.isCorp) {
            // Enterprise Account Routing (Bypass Consumer checks)
            const staffCheck = await prisma.staff.findUnique({
                where: { id: decoded.userId },
                select: { id: true, isActive: true, jwtVersion: true }
            });
            if (!staffCheck || !staffCheck.isActive) throw new Error('Staff account invalid');
            // Révocation de session : un changement de mot de passe ou une suspension incrémente
            // jwtVersion, ce qui invalide immédiatement tout token déjà émis (comportement déjà
            // en place côté User/mobile, absent côté Staff jusqu'ici).
            if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== staffCheck.jwtVersion) {
                return res.status(401).json({ error: 'Votre session a expiré. Veuillez vous reconnecter.' });
            }
            req.userId = decoded.userId;
            return next();
        }

        // `select` explicite : sans lui, cette requête — exécutée sur CHAQUE appel API
        // authentifié de toute l'app, y compris un simple rafraîchissement de solde —
        // rapatriait la ligne User complète depuis Postgres, y compris idCardFront/Back
        // et selfie (les 3 photos KYC stockées en base64 directement sur ce modèle,
        // potentiellement plusieurs centaines de Ko chacune) pour ne finalement utiliser
        // que isActive et jwtVersion. Sur une base distante (Neon), chaque aller-retour
        // de ce volume s'ajoute au temps de chargement perçu de l'app entière.
        const userCheck = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, isActive: true, jwtVersion: true }
        });
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
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string, isCorp?: boolean, jwtVersion?: number };
        if (!decoded.isCorp) return res.status(403).json({ error: 'B2C token rejected on Corporate Gateway' });

        const staff = await prisma.staff.findUnique({
            where: { id: decoded.userId },
            select: { id: true, isActive: true, jwtVersion: true }
        });
        if (!staff || !staff.isActive) return res.status(403).json({ error: 'Staff access denied' });
        if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== staff.jwtVersion) {
            return res.status(401).json({ error: 'Votre session a expiré. Veuillez vous reconnecter.' });
        }

        req.userId = decoded.userId;
        next();
    } catch {
        return res.status(401).json({ error: 'Token expiré.' });
    }
};
