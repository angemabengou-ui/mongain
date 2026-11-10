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

// 4 niveaux de permission du portail web marchand géant (voir MerchantPortalMember.role,
// schema.prisma) — ADMIN (tout, y compris gérer l'équipe), MANAGER (tout sauf gérer
// l'équipe), OPERATOR (peut exécuter paiements/retraits/employés/guichets mais pas gérer
// affiliations ni équipe), AUDITOR (lecture seule partout, ancien "VIEWER" — la migration
// renomme les lignes existantes, voir migration.sql).
export type PortalRole = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR';

export interface AuthRequest extends Request {
    userId?: string;

    // Portail web marchand géant uniquement (voir authMerchantPortal ci-dessous) — niveau de
    // permission de la session courante : 'ADMIN' pour le géant lui-même (implicite, voir
    // schema.prisma MerchantPortalMember) ou la valeur du rôle d'un membre d'équipe invité.
    // Absent en dehors du portail (authMiddleware/authCorp).
    portalRole?: PortalRole;
    // Id de la ligne MerchantPortalMember à l'origine de la session, uniquement quand un
    // membre d'équipe (pas le géant lui-même) est connecté — sert à router la déconnexion et
    // la rotation de refresh token sur les bons champs (voir routes/merchant-portal.ts
    // /auth/logout et /auth/refresh, qui manipulent tokenVersion/refreshTokenHash du MEMBRE
    // plutôt que ceux du géant dans ce cas), et à distinguer l'initiateur/l'approbateur d'un
    // paiement de masse soumis à double validation (voir POST /merchant-portal/payouts et
    // /payouts/:id/approve).
    portalMemberId?: string;

    // Guichet/caisse (voir authMerchantTill ci-dessous, schema.prisma MerchantTill) — id de la
    // ligne MerchantTill à l'origine de la session, uniquement présent sur ce canal. `userId`
    // ci-dessus porte alors l'id du marchand PROPRIÉTAIRE du guichet (pas un id de guichet),
    // pour que la logique d'encaissement existante crédite directement SON wallet.
    tillId?: string;
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

// Portail web des marchands géants (mairie, impôts...) — chaîne d'authentification
// COMPLÈTEMENT SÉPARÉE de authMiddleware ci-dessus, sur le même principe que authCorp :
// vérifie portalTokenVersion (jamais jwtVersion) contre un claim `portal: true` dédié. Une
// connexion sur ce portail n'invalide donc jamais la session mobile du même compte (et
// inversement), tout en restant single-session sur SON PROPRE canal (une 2e connexion web
// invalide la 1ère session web). Voir routes/merchant-portal.ts.
export const authMerchantPortal = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant ou invalide.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as {
            userId: string;
            portal?: boolean;
            portalTokenVersion?: number;
            // Présents uniquement quand un MEMBRE D'ÉQUIPE (pas le géant lui-même) s'est
            // connecté — voir routes/merchant-portal.ts /auth/verify-otp. `userId` reste alors
            // TOUJOURS l'id du géant (jamais celui du membre), pour que toute route existante
            // qui filtre déjà par req.userId/loadGiant continue de fonctionner sans
            // modification pour un membre connecté.
            memberId?: string;
            memberTokenVersion?: number;
        };
        if (!decoded.portal) return res.status(403).json({ error: 'Jeton mobile refusé sur le portail marchand.' });

        // Le géant PROPRIÉTAIRE est toujours revérifié, que ce soit lui qui se connecte
        // directement ou l'un de ses membres d'équipe — un géant rétrogradé/suspendu coupe
        // ainsi immédiatement l'accès de tous ses membres, pas seulement le sien.
        const giant = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, merchantTier: true, accountStatus: true, portalTokenVersion: true }
        });
        if (!giant || giant.merchantTier !== 'GIANT') return res.status(403).json({ error: 'Accès réservé aux marchands géants.' });
        if (giant.accountStatus !== 'ACTIVE') return res.status(403).json({ error: 'Votre compte a été suspendu.' });

        if (decoded.memberId) {
            const member = await prisma.merchantPortalMember.findUnique({ where: { id: decoded.memberId } });
            // isActive/giantId vérifiés en plus de l'existence : un membre désactivé, ou dont
            // la ligne ne correspond (par construction impossible mais défensif) pas au géant
            // porté par le token, ne doit jamais passer.
            if (!member || !member.isActive || member.giantId !== giant.id) {
                return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté ailleurs.' });
            }
            if (decoded.memberTokenVersion !== undefined && decoded.memberTokenVersion !== member.tokenVersion) {
                return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté ailleurs.' });
            }

            // La valeur stockée sur MerchantPortalMember.role est déjà contrainte à l'une des 4
            // valeurs par les routes d'écriture (voir routes/merchant-portal.ts POST/PATCH
            // /team) — repli défensif sur 'AUDITOR' (le niveau le moins privilégié, lecture
            // seule) si une valeur inattendue devait malgré tout se retrouver en base.
            const validRoles: PortalRole[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'];
            req.userId = giant.id;
            req.portalRole = validRoles.includes(member.role as PortalRole) ? (member.role as PortalRole) : 'AUDITOR';
            req.portalMemberId = member.id;
            return next();
        }

        if (decoded.portalTokenVersion !== undefined && decoded.portalTokenVersion !== giant.portalTokenVersion) {
            return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté ailleurs.' });
        }

        req.userId = giant.id;
        req.portalRole = 'ADMIN'; // Le géant lui-même est toujours implicitement ADMIN.
        next();
    } catch {
        return res.status(401).json({ error: 'Token expiré ou invalide.' });
    }
};

// Garde de rôle portail PARAMÉTRABLE — remplace l'ancien requirePortalAdmin (tout ou rien) :
// chaque route de mutation de merchant-portal.ts précise désormais explicitement quels rôles
// elle autorise (ex: requirePortalRole('ADMIN', 'MANAGER')) plutôt qu'un unique niveau ADMIN.
// Les routes de simple lecture (dashboard, rapports, listes...) n'appliquent aucune garde de
// ce type et restent accessibles aux 4 rôles via authMerchantPortal seul. Toujours placée
// APRÈS authMerchantPortal dans la chaîne de middlewares (dépend de req.portalRole, qu'elle
// seule renseigne).
export const requirePortalRole = (...allowed: PortalRole[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.portalRole || !allowed.includes(req.portalRole)) {
        return res.status(403).json({ error: `Action réservée aux rôles suivants : ${allowed.join(', ')}.` });
    }
    next();
};

// Guichets/caisses (marchand géant ou normal avec plusieurs points d'encaissement physiques —
// voir schema.prisma MerchantTill) — chaîne d'authentification COMPLÈTEMENT SÉPARÉE des
// précédentes : un guichet n'a pas de compte Mongain (pas de User), seulement une ligne
// MerchantTill (téléphone + PIN propres). Le JWT porte {tillId, till: true, tillTokenVersion}
// (jamais userId/jwtVersion/portal) — `req.userId` est renseigné APRÈS coup avec l'id du
// marchand PROPRIÉTAIRE du guichet (till.merchantId), pas un id de guichet, pour que la
// logique d'encaissement existante (routes/pay.ts, réutilisée telle quelle par
// routes/till.ts POST /collect) crédite directement SON wallet sans aucune modification.
export const authMerchantTill = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token manquant ou invalide.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as {
            tillId?: string;
            till?: boolean;
            tillTokenVersion?: number;
        };
        if (!decoded.till || !decoded.tillId) {
            return res.status(403).json({ error: 'Jeton refusé sur le canal guichet.' });
        }

        const till = await prisma.merchantTill.findUnique({
            where: { id: decoded.tillId },
            include: { merchant: { select: { id: true, role: true, accountStatus: true } } },
        });
        if (!till || !till.isActive) {
            return res.status(401).json({ error: 'Votre session a expiré car ce guichet a été désactivé.' });
        }
        if (decoded.tillTokenVersion !== undefined && decoded.tillTokenVersion !== till.tokenVersion) {
            return res.status(401).json({ error: 'Votre session a expiré car vous vous êtes connecté ailleurs.' });
        }
        // Le marchand PROPRIÉTAIRE est revérifié à chaque appel — un marchand suspendu ou
        // rétrogradé coupe ainsi immédiatement l'accès de tous ses guichets, exactement comme
        // authMerchantPortal le fait déjà pour les membres d'équipe du portail web.
        if (!till.merchant || till.merchant.role !== 'MERCHANT' || till.merchant.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte marchand propriétaire suspendu ou introuvable.' });
        }

        req.tillId = till.id;
        req.userId = till.merchantId;
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
