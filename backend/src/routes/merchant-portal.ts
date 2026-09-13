import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import {
    ACCESS_TOKEN_TTL,
    AuthRequest,
    authMerchantPortal,
    generateRefreshToken,
    hashRefreshToken,
    JWT_SECRET,
    REFRESH_TOKEN_TTL_MS,
    requirePortalAdmin,
} from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { isSmsConfigured, sendSms } from '../services/sms';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';
import { startOfDayInTimezone, startOfMonthInTimezone, startOfWeekInTimezone } from '../utils/timezone';
import { createMerchantPayoutRequest, PayoutValidationError } from './merchant';
import { runMassPayout } from './b2b';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

// Portail web des marchands géants (mairie, impôts, grandes entreprises) — voir
// schema.prisma (User.merchantTier/portalTokenVersion/MerchantAffiliation) et
// middleware/auth.ts (authMerchantPortal). Session COMPLÈTEMENT séparée de la session
// mobile (jwtVersion/refreshTokenHash) : les champs manipulés ici sont exclusivement
// portalTokenVersion/portalRefreshTokenHash/portalRefreshTokenExpiresAt.
const router = Router();

const phoneNormalize = (val: string) => val.replace(/\s+/g, '').replace(/^\+2410/, '+241');

// Même config que smsLimiter/loginLimiter dans routes/auth.ts — dupliquée plutôt
// qu'importée : ce sont de simples instances express-rate-limit (pas de logique métier à
// partager), et ça évite de dépendre d'exports supplémentaires sur un fichier déjà
// couvert par ses propres tests.
const portalSmsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Trop de requêtes SMS pour cette adresse IP, veuillez réessayer après 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const portalLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Trop de tentatives de connexion depuis cette adresse. Réessayez dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ==========================================
// AUTHENTIFICATION (PHONE + OTP, PAS DE PIN)
// ==========================================

const portalLoginSchema = z.object({
    phone: z.string().regex(/^\+?[0-9\s]{8,15}$/, 'Numéro de téléphone invalide.').transform(phoneNormalize),
});

// POST /api/merchant-portal/auth/login
router.post('/auth/login', portalSmsLimiter, async (req, res) => {
    const parsed = portalLoginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { phone } = parsed.data;

    try {
        // Le géant lui-même (son propre User.phone) est cherché en premier ; à défaut, un
        // membre d'équipe ACTIF (voir schema.prisma MerchantPortalMember) peut se connecter
        // avec son propre numéro — même message générique dans les deux cas de
        // non-correspondance, comme avant, pour ne jamais laisser deviner l'existence/la
        // nature d'un compte.
        const giant = await prisma.user.findFirst({ where: { phone, merchantTier: 'GIANT' } });
        const member = giant ? null : await prisma.merchantPortalMember.findFirst({ where: { phone, isActive: true } });
        if (!giant && !member) {
            return res.status(404).json({ error: 'Compte introuvable ou non éligible au portail marchand.' });
        }

        // Mode Démo Automatique : même comportement que routes/auth.ts (jamais atteignable en
        // production tant que isSmsConfigured reflète une vraie configuration Twilio).
        const useDemoMode = !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Purpose dédié ('PORTAL_LOGIN', pas 'LOGIN') : isole ce code de celui que le même
        // numéro pourrait générer en parallèle via /api/auth/login (mobile) — les deux canaux
        // de connexion (mobile + portail) restent totalement indépendants, comme le sont déjà
        // leurs sessions respectives (jwtVersion vs portalTokenVersion). `phone` (déjà
        // normalisé par le schéma ci-dessus) sert de clé, qu'il s'agisse du numéro du géant ou
        // de celui d'un membre — les deux sont par construction identiques au numéro recherché.
        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone, purpose: 'PORTAL_LOGIN' } },
            update: { code, expiresAt },
            create: { phone, purpose: 'PORTAL_LOGIN', code, expiresAt },
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code portail 1234 généré pour ${phone}`);
        } else {
            await sendSms(phone, `[Mongain Portail] Votre code de connexion est : ${code}.`);
        }

        return res.json({ requireOtp: true, message: 'Un code de sécurité a été envoyé par SMS.' });
    } catch (e: any) {
        logger.error('Erreur /merchant-portal/auth/login:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const portalVerifyOtpSchema = z.object({
    phone: z.string().transform(phoneNormalize),
    otpCode: z.string().length(4, 'Le code de vérification doit comporter 4 chiffres.'),
});

// POST /api/merchant-portal/auth/verify-otp
router.post('/auth/verify-otp', portalLoginLimiter, async (req, res) => {
    const parsed = portalVerifyOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { phone, otpCode } = parsed.data;

    try {
        const giant = await prisma.user.findFirst({ where: { phone, merchantTier: 'GIANT' } });
        const member = giant ? null : await prisma.merchantPortalMember.findFirst({ where: { phone, isActive: true } });
        if (!giant && !member) return res.status(404).json({ error: 'Compte introuvable ou non éligible au portail marchand.' });

        // Le géant PROPRIÉTAIRE — déjà chargé si `giant` a matché directement, sinon rechargé
        // via member.giantId pour vérifier SON statut (un géant rétrogradé/suspendu ne doit
        // plus laisser ses membres se connecter, même avec un numéro de membre par ailleurs
        // toujours actif).
        const owner = giant || await prisma.user.findUnique({ where: { id: member!.giantId } });
        if (!owner || owner.merchantTier !== 'GIANT') {
            return res.status(404).json({ error: 'Compte introuvable ou non éligible au portail marchand.' });
        }
        if (owner.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Votre compte a été suspendu.' });
        }

        const otpRecord = await prisma.verificationCode.findUnique({
            where: { phone_purpose: { phone, purpose: 'PORTAL_LOGIN' } },
        });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code OTP expiré ou invalide.' });
        }

        await prisma.verificationCode.delete({ where: { phone_purpose: { phone, purpose: 'PORTAL_LOGIN' } } });

        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

        let token: string;
        if (member) {
            // Session de MEMBRE : rotation sur les champs tokenVersion/refreshTokenHash DU
            // MEMBRE, jamais ceux du géant (portalTokenVersion) — symétrique à la séparation
            // déjà en place entre jwtVersion (mobile) et portalTokenVersion (portail géant).
            // `userId` du JWT reste TOUJOURS l'id du géant : toute route existante qui filtre
            // par req.userId/loadGiant(req.userId) continue de fonctionner sans modification
            // pour un membre connecté (voir middleware/auth.ts authMerchantPortal).
            const updatedMember = await prisma.merchantPortalMember.update({
                where: { id: member.id },
                data: { tokenVersion: { increment: 1 }, refreshTokenHash, refreshTokenExpiresAt },
            });
            token = jwt.sign(
                { userId: owner.id, portal: true, memberId: member.id, memberTokenVersion: updatedMember.tokenVersion, role: member.role },
                JWT_SECRET,
                { expiresIn: ACCESS_TOKEN_TTL }
            );
        } else {
            // Single-session enforcement CÔTÉ PORTAIL uniquement (portalTokenVersion) —
            // n'affecte jamais jwtVersion/la session mobile de ce même compte (voir
            // commentaire en tête de fichier et middleware/auth.ts).
            const updatedUser = await prisma.user.update({
                where: { id: owner.id },
                data: {
                    portalTokenVersion: { increment: 1 },
                    portalRefreshTokenHash: refreshTokenHash,
                    portalRefreshTokenExpiresAt: refreshTokenExpiresAt,
                },
            });
            token = jwt.sign(
                { userId: owner.id, portal: true, portalTokenVersion: updatedUser.portalTokenVersion },
                JWT_SECRET,
                { expiresIn: ACCESS_TOKEN_TTL }
            );
        }

        return res.json({
            token,
            refreshToken,
            user: {
                id: owner.id,
                name: member ? member.name : owner.name,
                phone,
                merchantTier: owner.merchantTier,
                portalRole: member ? member.role : 'ADMIN',
            },
        });
    } catch (e: any) {
        logger.error('Erreur /merchant-portal/auth/verify-otp:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const portalRefreshSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token requis.'),
});

// POST /api/merchant-portal/auth/refresh — même rotation que POST /api/auth/refresh, sur les
// champs portal* plutôt que refreshTokenHash/refreshTokenExpiresAt.
router.post('/auth/refresh', async (req, res) => {
    const parsed = portalRefreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    try {
        const incomingHash = hashRefreshToken(parsed.data.refreshToken);
        // Cherché d'abord côté géant (portalRefreshTokenHash sur User), puis côté membre
        // d'équipe (refreshTokenHash sur MerchantPortalMember) — chaque canal a son propre
        // secret, un même hash ne peut matcher que l'un des deux.
        const giant = await prisma.user.findUnique({ where: { portalRefreshTokenHash: incomingHash } });
        const member = giant ? null : await prisma.merchantPortalMember.findUnique({ where: { refreshTokenHash: incomingHash } });

        if (member) {
            if (!member.isActive || !member.refreshTokenExpiresAt || member.refreshTokenExpiresAt < new Date()) {
                return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
            }
            const owner = await prisma.user.findUnique({ where: { id: member.giantId } });
            if (!owner || owner.merchantTier !== 'GIANT' || owner.accountStatus !== 'ACTIVE') {
                return res.status(403).json({ error: 'Votre compte a été suspendu.' });
            }

            const refreshToken = generateRefreshToken();
            const refreshTokenHash = hashRefreshToken(refreshToken);
            const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

            // Rotation sur les champs DU MEMBRE — jamais portalRefreshTokenHash/
            // portalTokenVersion du géant, qui ne bougent pas ici (voir /auth/verify-otp).
            const updatedMember = await prisma.merchantPortalMember.update({
                where: { id: member.id },
                data: { refreshTokenHash, refreshTokenExpiresAt },
            });

            const token = jwt.sign(
                { userId: owner.id, portal: true, memberId: member.id, memberTokenVersion: updatedMember.tokenVersion, role: updatedMember.role },
                JWT_SECRET,
                { expiresIn: ACCESS_TOKEN_TTL }
            );

            return res.json({ token, refreshToken });
        }

        if (!giant || !giant.portalRefreshTokenExpiresAt || giant.portalRefreshTokenExpiresAt < new Date()) {
            return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
        }
        if (giant.merchantTier !== 'GIANT' || giant.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Votre compte a été suspendu.' });
        }

        const refreshToken = generateRefreshToken();
        const portalRefreshTokenHash = hashRefreshToken(refreshToken);
        const portalRefreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

        await prisma.user.update({
            where: { id: giant.id },
            data: { portalRefreshTokenHash, portalRefreshTokenExpiresAt },
        });

        const token = jwt.sign(
            { userId: giant.id, portal: true, portalTokenVersion: giant.portalTokenVersion },
            JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_TTL }
        );

        return res.json({ token, refreshToken });
    } catch (e: any) {
        logger.error('Erreur /merchant-portal/auth/refresh:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/merchant-portal/auth/logout
router.post('/auth/logout', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        if (req.portalMemberId) {
            // Session de MEMBRE : ne touche jamais la session du géant (req.userId) ni celle
            // des autres membres — voir schema.prisma MerchantPortalMember.
            await prisma.merchantPortalMember.update({
                where: { id: req.portalMemberId },
                data: { refreshTokenHash: null, refreshTokenExpiresAt: null, tokenVersion: { increment: 1 } },
            });
        } else {
            await prisma.user.update({
                where: { id: req.userId },
                data: { portalRefreshTokenHash: null, portalRefreshTokenExpiresAt: null, portalTokenVersion: { increment: 1 } },
            });
        }
        return res.json({ message: 'Déconnecté.' });
    } catch (e: any) {
        logger.error('Erreur /merchant-portal/auth/logout:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// DASHBOARD & RAPPORTS
// ==========================================

async function loadGiant(userId: string | undefined) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true, commissionWallet: true } });
    if (!user || user.merchantTier !== 'GIANT') return null;
    return user;
}

// GET /api/merchant-portal/dashboard — même pattern que merchant.ts GET /stats (loadMerchant,
// startOfDayInTimezone/getSystemSettings), adapté à merchantTier==='GIANT' au lieu du seul
// role==='MERCHANT'.
router.get('/dashboard', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const user = await loadGiant(req.userId);
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        // Minuit/1er du mois dans le fuseau configuré — voir commentaire équivalent dans
        // merchant.ts GET /stats.
        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const today = startOfDayInTimezone(timezone);
        const monthStart = startOfMonthInTimezone(timezone);

        const salesFilter = { receiverWalletId: user.wallet.id, status: 'COMPLETED' };

        const [todaySales, monthSales] = await Promise.all([
            prisma.transaction.aggregate({ where: { ...salesFilter, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.transaction.aggregate({ where: { ...salesFilter, createdAt: { gte: monthStart } }, _sum: { amount: true }, _count: { id: true } }),
        ]);

        return res.json({
            balance: user.wallet.balance,
            todaySalesAmount: todaySales._sum.amount || 0,
            todaySalesCount: todaySales._count.id || 0,
            monthSalesAmount: monthSales._sum.amount || 0,
            monthSalesCount: monthSales._count.id || 0,
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/merchant-portal/reports?period=day|month — série temporelle simple des
// transactions entrantes du wallet du géant. Implémentée par boucle sur les N derniers
// jours/mois (agrégation par plage de dates, même esprit que LimitEngine.ts/merchant.ts)
// plutôt que par un groupBy Prisma, qui nécessiterait un date_trunc SQL brut pour grouper par
// jour/mois — plus simple à lire et à tester ici pour un nombre de buckets aussi réduit.
router.get('/reports', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const user = await loadGiant(req.userId);
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const period = req.query.period === 'month' ? 'month' : 'day';
        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const now = new Date();

        const bucketCount = period === 'month' ? 12 : 30;
        const series: { period: string; amount: number; count: number }[] = [];

        for (let i = bucketCount - 1; i >= 0; i--) {
            let bucketStart: Date;
            let bucketEnd: Date;
            let label: string;

            if (period === 'month') {
                const ref = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const nextRef = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
                bucketStart = startOfMonthInTimezone(timezone, ref);
                bucketEnd = startOfMonthInTimezone(timezone, nextRef);
                label = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
            } else {
                const ref = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                bucketStart = startOfDayInTimezone(timezone, ref);
                bucketEnd = new Date(bucketStart.getTime() + 24 * 60 * 60 * 1000);
                label = bucketStart.toISOString().substring(0, 10);
            }

            const agg = await prisma.transaction.aggregate({
                where: {
                    receiverWalletId: user.wallet.id,
                    status: 'COMPLETED',
                    createdAt: { gte: bucketStart, lt: bucketEnd },
                },
                _sum: { amount: true },
                _count: { id: true },
            });

            series.push({ period: label, amount: agg._sum.amount || 0, count: agg._count.id || 0 });
        }

        return res.json({ period, series });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// AFFILIATIONS (CÔTÉ GÉANT)
// ==========================================
// Consentement explicite requis côté marchand affilié — voir schema.prisma
// (MerchantAffiliation) et routes/merchant.ts (GET /affiliations, POST /:id/respond, mobile).

const EXPECTED_FREQUENCIES = ['MONTHLY', 'WEEKLY'] as const;

// Conformité automatique ("qui n'a pas honoré sa taxe") — factorée ici pour être appelée à la
// fois par GET /affiliations (liste, un calcul par ligne ACCEPTED) et GET
// /affiliations/:id/compliance (détail), qui font tous deux exactement le même calcul plutôt
// que de forcer le géant à interpréter lui-même l'historique brut des versements.
async function computeComplianceStatus(
    affiliation: { status: string; expectedFrequency: string | null },
    merchantWalletId: string | undefined,
    giantWalletId: string | undefined,
    timezone: string
): Promise<'OK' | 'LATE' | null> {
    if (affiliation.status !== 'ACCEPTED' || !affiliation.expectedFrequency || !merchantWalletId || !giantWalletId) {
        return null;
    }

    const windowStart = affiliation.expectedFrequency === 'WEEKLY'
        ? startOfWeekInTimezone(timezone)
        : startOfMonthInTimezone(timezone);

    const recentPayment = await prisma.transaction.findFirst({
        where: {
            senderWalletId: merchantWalletId,
            receiverWalletId: giantWalletId,
            status: 'COMPLETED',
            createdAt: { gte: windowStart },
        },
    });

    return recentPayment ? 'OK' : 'LATE';
}

// POST /api/merchant-portal/affiliations
router.post('/affiliations', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const { merchantPhone, expectedFrequency } = req.body;
        if (!merchantPhone || typeof merchantPhone !== 'string') {
            return res.status(400).json({ error: 'Numéro de téléphone du marchand requis.' });
        }
        // Optionnel : absent/null = aucune attente de fréquence (pas de calcul de conformité,
        // voir computeComplianceStatus ci-dessus).
        if (expectedFrequency !== undefined && expectedFrequency !== null && !EXPECTED_FREQUENCIES.includes(expectedFrequency)) {
            return res.status(400).json({ error: "expectedFrequency doit être 'MONTHLY', 'WEEKLY' ou absent." });
        }

        // Même normalisation que le login (phoneNormalize) : sans elle, un géant saisissant
        // le numéro avec des espaces ou sans le préfixe +241 ne trouvait jamais un marchand
        // pourtant bien enregistré, faute de correspondance exacte avec la valeur stockée.
        const merchant = await prisma.user.findUnique({ where: { phone: phoneNormalize(merchantPhone) } });
        // Un géant s'affilie un marchand normal, jamais un autre géant (role==='MERCHANT' mais
        // merchantTier==='GIANT' est refusé) ni un compte qui n'est pas marchand du tout.
        if (!merchant || merchant.role !== 'MERCHANT' || merchant.merchantTier === 'GIANT') {
            return res.status(404).json({ error: 'Marchand introuvable.' });
        }

        const existing = await prisma.merchantAffiliation.findUnique({
            where: { giantId_merchantId: { giantId: giant.id, merchantId: merchant.id } },
        });
        if (existing && (existing.status === 'PENDING' || existing.status === 'ACCEPTED')) {
            return res.status(409).json({ error: 'Une affiliation est déjà en cours ou active avec ce marchand.' });
        }

        // La contrainte @@unique([giantId, merchantId]) n'autorise qu'UNE seule ligne par
        // paire pour toujours — une ré-affiliation après un REJECTED/REVOKED remet donc cette
        // même ligne à PENDING plutôt que d'en créer une seconde (qui violerait la contrainte).
        // `expectedFrequency` reste `undefined` (donc ignoré par Prisma, colonne inchangée) si
        // l'appelant ne le fournit pas — une ré-affiliation ne doit pas silencieusement effacer
        // une fréquence attendue déjà configurée sur une ligne REJECTED/REVOKED précédente.
        const affiliation = existing
            ? await prisma.merchantAffiliation.update({
                where: { id: existing.id },
                data: { status: 'PENDING', respondedAt: null, revokedAt: null, expectedFrequency },
            })
            : await prisma.merchantAffiliation.create({
                data: { giantId: giant.id, merchantId: merchant.id, status: 'PENDING', expectedFrequency },
            });

        const title = "Demande d'affiliation";
        const body = `${giant.name} souhaite vous affilier pour suivre vos versements. Ouvrez l'app pour répondre.`;
        await prisma.notification.create({ data: { userId: merchant.id, title, body, type: 'INFO' } });
        if (merchant.pushToken) {
            await sendPush(merchant.pushToken, title, body);
        }

        return res.status(201).json({ success: true, affiliation });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/merchant-portal/affiliations — inclut désormais complianceStatus ('OK'/'LATE'/null,
// voir computeComplianceStatus ci-dessus) pour répondre directement à "qui n'a pas honoré sa
// taxe" sans que le géant doive interpréter lui-même l'historique brut des versements.
router.get('/affiliations', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const affiliations = await prisma.merchantAffiliation.findMany({
            where: { giantId: giant.id },
            orderBy: { createdAt: 'desc' },
            include: { merchant: { select: { name: true, phone: true, wallet: { select: { id: true } } } } },
        });

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';

        const withCompliance = await Promise.all(affiliations.map(async (affiliation: any) => ({
            ...affiliation,
            complianceStatus: await computeComplianceStatus(
                affiliation,
                affiliation.merchant?.wallet?.id,
                giant.wallet?.id,
                timezone
            ),
        })));

        return res.json({ success: true, affiliations: withCompliance });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/merchant-portal/affiliations/:id/compliance — historique des versements du
// marchand affilié vers le wallet du géant (dernier versement, total, nombre).
router.get('/affiliations/:id/compliance', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant || !giant.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const affiliation = await prisma.merchantAffiliation.findUnique({
            where: { id: req.params.id as string },
            include: { merchant: { include: { wallet: true } } },
        });
        // 404 (pas 403) que la ligne n'existe pas, appartienne à un autre géant, ou ne soit pas
        // encore ACCEPTED : ne distingue jamais ces cas pour ne rien laisser deviner sur une
        // affiliation qui n'est pas la sienne.
        if (!affiliation || affiliation.giantId !== giant.id || affiliation.status !== 'ACCEPTED') {
            return res.status(404).json({ error: 'Affiliation introuvable.' });
        }
        if (!affiliation.merchant.wallet) {
            return res.status(404).json({ error: 'Portefeuille du marchand introuvable.' });
        }

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';

        const [agg, lastTx, complianceStatus] = await Promise.all([
            prisma.transaction.aggregate({
                where: { senderWalletId: affiliation.merchant.wallet.id, receiverWalletId: giant.wallet.id, status: 'COMPLETED' },
                _sum: { amount: true },
                _count: { id: true },
            }),
            prisma.transaction.findFirst({
                where: { senderWalletId: affiliation.merchant.wallet.id, receiverWalletId: giant.wallet.id, status: 'COMPLETED' },
                orderBy: { createdAt: 'desc' },
            }),
            computeComplianceStatus(affiliation, affiliation.merchant.wallet.id, giant.wallet.id, timezone),
        ]);

        return res.json({
            success: true,
            merchant: { name: affiliation.merchant.name, phone: affiliation.merchant.phone },
            totalAmount: agg._sum.amount || 0,
            totalCount: agg._count.id || 0,
            lastPayment: lastTx ? { amount: lastTx.amount, date: lastTx.createdAt } : null,
            complianceStatus,
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PATCH /api/merchant-portal/affiliations/:id/expected-frequency — ajuste après coup la
// fréquence de versement attendue d'une affiliation déjà ACCEPTED (voir POST /affiliations
// ci-dessus pour la fixer dès la création/ré-affiliation).
router.patch('/affiliations/:id/expected-frequency', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const { expectedFrequency } = req.body;
        if (expectedFrequency !== null && !EXPECTED_FREQUENCIES.includes(expectedFrequency)) {
            return res.status(400).json({ error: "expectedFrequency doit être 'MONTHLY', 'WEEKLY' ou null." });
        }

        const affiliation = await prisma.merchantAffiliation.findUnique({ where: { id: req.params.id as string } });
        // Même principe que /compliance : 404 générique, ne distingue jamais "n'existe pas" de
        // "appartient à un autre géant" ou "pas encore ACCEPTED".
        if (!affiliation || affiliation.giantId !== giant.id || affiliation.status !== 'ACCEPTED') {
            return res.status(404).json({ error: 'Affiliation introuvable.' });
        }

        const updated = await prisma.merchantAffiliation.update({
            where: { id: affiliation.id },
            data: { expectedFrequency },
        });

        return res.json({ success: true, affiliation: updated });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// DELETE /api/merchant-portal/affiliations/:id
router.delete('/affiliations/:id', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const affiliation = await prisma.merchantAffiliation.findUnique({
            where: { id: req.params.id as string },
            include: { merchant: { select: { id: true, pushToken: true } } },
        });
        if (!affiliation || affiliation.giantId !== giant.id) {
            return res.status(404).json({ error: 'Affiliation introuvable.' });
        }

        const updated = await prisma.merchantAffiliation.update({
            where: { id: affiliation.id },
            data: { status: 'REVOKED', revokedAt: new Date() },
        });

        const title = 'Affiliation révoquée';
        const body = `${giant.name} a mis fin à votre affiliation.`;
        await prisma.notification.create({ data: { userId: affiliation.merchant.id, title, body, type: 'INFO' } });
        if (affiliation.merchant.pushToken) {
            await sendPush(affiliation.merchant.pushToken, title, body);
        }

        return res.json({ success: true, affiliation: updated });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// MOUVEMENTS D'ARGENT (SEULE VOIE POUR UN GÉANT)
// ==========================================
// circuitBreakerMiddleware appliqué route par route (pas au mount dans index.ts) : le
// login/dashboard/rapports/affiliations doivent rester utilisables même en verrouillage
// d'urgence (même principe que /api/auth, jamais gaté), seules ces deux routes déplacent
// réellement de l'argent ou engagent un paiement de masse.

// POST /api/merchant-portal/payouts — paiement de masse aux employés. Réutilise TELLE QUELLE
// la logique métier de b2b.ts (runMassPayout), déjà factorée hors de sa route mobile pour
// cette raison précise : voir le commentaire de choix de conception dans b2b.ts.
router.post('/payouts', authMerchantPortal, requirePortalAdmin, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.merchantTier !== 'GIANT') return res.status(404).json({ error: 'Compte introuvable.' });

        return runMassPayout(user, req, res);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/merchant-portal/withdraw-to-agency — retrait vers agence. Aucune route
// équivalente exacte n'existe dans wallet.ts pour un marchand normal ; le mécanisme le plus
// proche déjà en place est MerchantPayoutRequest (merchant.ts POST /payouts) : une demande
// (pas un débit immédiat) exécutée manuellement par le staff via admin.merchants.ts, qui ne
// discrimine déjà pas par merchantTier. Réutilisé tel quel plutôt que d'écrire une nouvelle
// logique de débit.
router.post('/withdraw-to-agency', authMerchantPortal, requirePortalAdmin, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const payout = await createMerchantPayoutRequest(giant, req.body);
        return res.status(201).json({ success: true, data: payout });
    } catch (e: any) {
        if (e instanceof PayoutValidationError) {
            return res.status(e.status).json({ error: e.message });
        }
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/merchant-portal/withdraw-to-agency — historique des demandes (même modèle que
// merchant.ts GET /payouts).
router.get('/withdraw-to-agency', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const payouts = await prisma.merchantPayoutRequest.findMany({
            where: { merchantId: giant.id },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ success: true, data: payouts });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// ÉQUIPE DU PORTAIL (NIVEAUX DE PERMISSION)
// ==========================================
// Le géant lui-même (son propre User.phone/PIN mobile) reste toujours ADMIN implicite et n'a
// pas de ligne dans MerchantPortalMember — ces routes gèrent uniquement les membres INVITÉS.
// Lecture ouverte à VIEWER comme ADMIN, écriture réservée à requirePortalAdmin (voir
// middleware/auth.ts) : un géant qui invite un comptable en lecture seule ou un directeur qui
// peut payer n'a ainsi plus besoin de partager un seul et même identifiant.

// GET /api/merchant-portal/team
router.get('/team', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const members = await prisma.merchantPortalMember.findMany({
            where: { giantId: giant.id },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ success: true, members });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/merchant-portal/team
router.post('/team', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const { name, phone, role } = req.body;
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nom requis.' });
        }
        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ error: 'Numéro de téléphone requis.' });
        }
        if (role !== 'ADMIN' && role !== 'VIEWER') {
            return res.status(400).json({ error: "role doit être 'ADMIN' ou 'VIEWER'." });
        }

        const normalizedPhone = phoneNormalize(phone);

        // Un membre d'équipe n'a pas de compte Mongain séparé — s'il correspond déjà à un
        // User (client, marchand...) ou à un autre membre (contrainte @@unique sur
        // MerchantPortalMember.phone), refuse plutôt que de créer un accès portail en doublon
        // sur ce numéro.
        const [existingUser, existingMember] = await Promise.all([
            prisma.user.findUnique({ where: { phone: normalizedPhone } }),
            prisma.merchantPortalMember.findUnique({ where: { phone: normalizedPhone } }),
        ]);
        if (existingUser || existingMember) {
            return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
        }

        const member = await prisma.merchantPortalMember.create({
            data: { giantId: giant.id, name: name.trim(), phone: normalizedPhone, role },
        });

        return res.status(201).json({ success: true, member });
    } catch (e: any) {
        if (e.code === 'P2002') return res.status(409).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PATCH /api/merchant-portal/team/:id
router.patch('/team/:id', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const member = await prisma.merchantPortalMember.findUnique({ where: { id: req.params.id as string } });
        if (!member || member.giantId !== giant.id) {
            return res.status(404).json({ error: 'Membre introuvable.' });
        }

        const { role, isActive } = req.body;
        if (role !== undefined && role !== 'ADMIN' && role !== 'VIEWER') {
            return res.status(400).json({ error: "role doit être 'ADMIN' ou 'VIEWER'." });
        }
        if (isActive !== undefined && typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive doit être un booléen.' });
        }

        const data: { role?: string; isActive?: boolean; tokenVersion?: { increment: number } } = {};
        if (role !== undefined) data.role = role;
        if (isActive !== undefined) {
            data.isActive = isActive;
            // Coupe immédiatement la session en cours du membre désactivé — même principe que
            // portalTokenVersion côté géant (voir admin.ts /users/:id/merchant-tier et
            // /users/:id/revoke-sessions).
            if (!isActive) data.tokenVersion = { increment: 1 };
        }
        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Aucune modification fournie.' });
        }

        const updated = await prisma.merchantPortalMember.update({ where: { id: member.id }, data });
        return res.json({ success: true, member: updated });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// DELETE /api/merchant-portal/team/:id — suppression réelle (pas de simple désactivation) :
// MerchantPortalMember n'est référencé par aucune autre table (voir schema.prisma), rien à
// préserver en historique en gardant une ligne inactive.
router.delete('/team/:id', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const member = await prisma.merchantPortalMember.findUnique({ where: { id: req.params.id as string } });
        if (!member || member.giantId !== giant.id) {
            return res.status(404).json({ error: 'Membre introuvable.' });
        }

        await prisma.merchantPortalMember.delete({ where: { id: member.id } });

        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// RÉPERTOIRE D'EMPLOYÉS (CÔTÉ GÉANT)
// ==========================================
// Même modèle que routes/b2b.ts côté marchand normal (schema.prisma MerchantEmployee) — évite
// de retaper toute la liste à chaque paie groupée (POST /payouts ci-dessus). Lecture ouverte à
// VIEWER, écriture réservée à requirePortalAdmin.

// GET /api/merchant-portal/employees
router.get('/employees', authMerchantPortal, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const employees = await prisma.merchantEmployee.findMany({
            where: { merchantId: giant.id, isActive: true },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ success: true, employees });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/merchant-portal/employees
router.post('/employees', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const { name, phone } = req.body;
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nom requis.' });
        }
        if (!phone || typeof phone !== 'string') {
            return res.status(400).json({ error: 'Numéro de téléphone requis.' });
        }

        const employee = await prisma.merchantEmployee.create({
            data: { merchantId: giant.id, name: name.trim(), phone: phoneNormalize(phone) },
        });

        return res.status(201).json({ success: true, employee });
    } catch (e: any) {
        // @@unique([merchantId, phone]) — cet employé existe déjà pour ce marchand.
        if (e.code === 'P2002') return res.status(409).json({ error: 'Cet employé existe déjà.' });
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// DELETE /api/merchant-portal/employees/:id — désactivation (pas de suppression) : garde
// l'historique des paies groupées déjà effectuées vers cet employé.
router.delete('/employees/:id', authMerchantPortal, requirePortalAdmin, async (req: AuthRequest, res) => {
    try {
        const giant = await loadGiant(req.userId);
        if (!giant) return res.status(404).json({ error: 'Compte introuvable.' });

        const employee = await prisma.merchantEmployee.findUnique({ where: { id: req.params.id as string } });
        if (!employee || employee.merchantId !== giant.id) {
            return res.status(404).json({ error: 'Employé introuvable.' });
        }

        await prisma.merchantEmployee.update({ where: { id: employee.id }, data: { isActive: false } });

        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
