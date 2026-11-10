import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { AuthRequest, authMerchantTill, JWT_SECRET } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import { executeQrCollection } from './pay';

// Guichets/caisses (voir schema.prisma MerchantTill, middleware/auth.ts authMerchantTill) —
// canal d'authentification à part entière : un guichet n'a pas de compte Mongain, seulement
// un téléphone + PIN propres à cette ligne. Ce fichier porte à la fois les deux routes du
// canal guichet lui-même (auth/login, collect) ET la logique métier de gestion des guichets
// PARTAGÉE avec routes/b2b.ts (marchand mobile normal ou géant) et routes/merchant-portal.ts
// (portail web du géant) — voir listMerchantTills/createMerchantTill/deactivateMerchantTill
// ci-dessous, importées telles quelles par les deux plutôt que dupliquées.

const router = Router();

// Durée volontairement plus longue qu'un access token mobile/portail (30 min, voir
// middleware/auth.ts ACCESS_TOKEN_TTL) : un guichet physique reste ouvert et connecté toute la
// durée d'un service (plusieurs heures), sans mécanisme de refresh token dédié pour ce canal
// (non demandé — authMerchantTill ne vérifie que {tillId, till, tillTokenVersion}, jamais de
// refresh token opaque comme les deux autres canaux).
const TILL_TOKEN_TTL = '12h';

// Même fenêtre que smsLimiter/loginLimiter ailleurs dans ce backend (routes/auth.ts,
// routes/merchant-portal.ts) — PAS de compteur d'échecs en base côté MerchantTill
// (contrairement à User.failedPinAttempts/lockedUntil, voir utils/pinAuth.ts) : un guichet est
// un terminal physique partagé par toute une équipe, verrouiller son PIN après 3 essais
// bloquerait toute une caisse sur une simple faute de frappe d'un seul employé. La défense
// contre le brute-force du PIN (4 à 6 chiffres) reste donc uniquement cette limite par IP.
const tillLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Trop de tentatives de connexion depuis cette adresse. Réessayez dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const normalizePhone = (phone: string) => phone.replace(/\s+/g, '');

// POST /api/till/auth/login {phone, pin} — pas d'OTP (contrairement à /api/auth/login et
// /api/merchant-portal/auth/login) : un guichet est déjà un secret partagé physiquement
// connu du personnel de caisse, un second facteur SMS n'ajouterait ici qu'une friction sans
// bénéfice de sécurité réel (le guichet n'a pas de numéro de téléphone mobile joignable).
router.post('/auth/login', tillLoginLimiter, async (req, res) => {
    try {
        const { phone, pin } = req.body;
        if (!phone || typeof phone !== 'string' || !pin || typeof pin !== 'string') {
            return res.status(400).json({ error: 'Numéro de téléphone et code PIN requis.' });
        }

        const till = await prisma.merchantTill.findUnique({
            where: { phone: normalizePhone(phone) },
            include: { merchant: { select: { id: true, role: true, accountStatus: true } } },
        });

        // Message générique (même principe que /api/auth/login et /api/merchant-portal/auth/
        // login) : ne jamais laisser deviner si ce numéro correspond à un guichet existant.
        if (!till || !till.isActive) {
            return res.status(401).json({ error: 'Numéro ou code PIN incorrect.' });
        }
        if (!till.merchant || till.merchant.role !== 'MERCHANT' || till.merchant.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte marchand propriétaire suspendu ou introuvable.' });
        }

        const pinMatch = await bcrypt.compare(pin, till.pin);
        if (!pinMatch) {
            return res.status(401).json({ error: 'Numéro ou code PIN incorrect.' });
        }

        const token = jwt.sign(
            { tillId: till.id, till: true, tillTokenVersion: till.tokenVersion },
            JWT_SECRET,
            { expiresIn: TILL_TOKEN_TTL }
        );

        return res.json({ token, till: { id: till.id, name: till.name } });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/till/collect — encaissement client. Réutilise TELLE QUELLE la logique de
// routes/pay.ts POST /qr-scan (voir executeQrCollection) : authMerchantTill a déjà mappé
// req.userId sur l'id du marchand PROPRIÉTAIRE de ce guichet, donc aucune adaptation n'est
// nécessaire — même plafonds KYC, mêmes frais, mêmes notifications que l'encaissement mobile.
router.post('/collect', authMerchantTill, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    return executeQrCollection(req.userId!, req, res);
});

// ==========================================
// Gestion des guichets — logique métier partagée
// ==========================================
// Exportées pour être montées à la fois par routes/b2b.ts (GET/POST/DELETE /api/b2b/tills,
// marchand mobile normal OU géant, authMiddleware) et routes/merchant-portal.ts (GET/POST/
// DELETE /api/merchant-portal/tills, portail web du géant, authMerchantPortal) — chacun ne
// fait que résoudre son propre `merchantId` (req.userId ou loadGiant(req.userId)) puis
// délègue entièrement la validation/l'écriture ici, pour ne jamais dupliquer cette logique.

export async function listMerchantTills(merchantId: string) {
    return prisma.merchantTill.findMany({
        where: { merchantId },
        select: { id: true, name: true, phone: true, isActive: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
}

export async function createMerchantTill(
    merchantId: string,
    input: { name?: unknown; phone?: unknown; pin?: unknown }
): Promise<{ status: number; body: any }> {
    const { name, phone, pin } = input;

    if (!name || typeof name !== 'string' || !name.trim()) {
        return { status: 400, body: { error: 'Nom du guichet requis.' } };
    }
    if (!phone || typeof phone !== 'string') {
        return { status: 400, body: { error: 'Numéro de téléphone requis.' } };
    }
    if (!pin || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
        return { status: 400, body: { error: 'Code PIN invalide (4 à 6 chiffres).' } };
    }

    const normalizedPhone = normalizePhone(phone);

    // Un guichet n'a pas de compte Mongain séparé — s'il correspond déjà à un User (client,
    // marchand...) ou à un autre guichet (contrainte @@unique sur MerchantTill.phone), refuse
    // plutôt que de créer un accès en doublon sur ce numéro (même principe que
    // routes/merchant-portal.ts POST /team pour MerchantPortalMember).
    const [existingUser, existingTill] = await Promise.all([
        prisma.user.findUnique({ where: { phone: normalizedPhone } }),
        prisma.merchantTill.findUnique({ where: { phone: normalizedPhone } }),
    ]);
    if (existingUser || existingTill) {
        return { status: 409, body: { error: 'Ce numéro de téléphone est déjà utilisé.' } };
    }

    const hashedPin = await bcrypt.hash(pin, 10);
    const till = await prisma.merchantTill.create({
        data: { merchantId, name: name.trim(), phone: normalizedPhone, pin: hashedPin },
    });

    const { pin: _redacted, ...safe } = till;
    return { status: 201, body: { success: true, till: safe } };
}

export async function deactivateMerchantTill(merchantId: string, tillId: string): Promise<{ status: number; body: any }> {
    const till = await prisma.merchantTill.findUnique({ where: { id: tillId } });
    if (!till || till.merchantId !== merchantId) {
        return { status: 404, body: { error: 'Guichet introuvable.' } };
    }

    // Désactivation (pas de suppression) + bump tokenVersion : coupe immédiatement toute
    // session déjà ouverte sur ce guichet, même principe que MerchantPortalMember.isActive et
    // routes/merchant-portal.ts PATCH /team/:id.
    await prisma.merchantTill.update({
        where: { id: till.id },
        data: { isActive: false, tokenVersion: { increment: 1 } },
    });

    return { status: 200, body: { success: true } };
}

export default router;
