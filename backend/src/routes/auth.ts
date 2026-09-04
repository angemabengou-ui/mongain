import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ACCESS_TOKEN_TTL, AuthRequest, JWT_SECRET, REFRESH_TOKEN_TTL_MS, authMiddleware, generateRefreshToken, hashRefreshToken } from '../middleware/auth';
import { prisma } from '../prisma';
import { runKycVendorCheck } from '../services/kycVendorCheck';
import { isSmsConfigured, sendSms } from '../services/sms';
import { friendlyErrorMessage, isDbConnectivityError, withDbRetry } from '../utils/errors';
import logger from '../utils/logger';
import { verifyUserPin } from '../utils/pinAuth';

const router = Router();

const registerSchema = z.object({
    name: z.string().min(2, 'Le nom doit comporter au moins 2 caractères.'),
    username: z.string().min(3, 'Le pseudo doit comporter au moins 3 caractères.').transform(v => v.toLowerCase().replace(/\s/g, '')),
    phone: z.string().regex(/^\+?[0-9\s]{8,15}$/, 'Numéro de téléphone invalide.').transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
    pin: z.string().length(4, 'Le code PIN doit comporter 4 chiffres.').regex(/^\d+$/, 'Le PIN doit être numérique.'),
    otpCode: z.string().length(4, 'Le code de vérification doit comporter 4 chiffres.'),
});

const requestOtpSchema = z.object({
    phone: z.string().regex(/^\+?[0-9\s]{8,15}$/, 'Numéro de téléphone invalide.').transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
});

const loginSchema = z.object({
    phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
    pin: z.string(),
});

// Génère un nouveau refresh token + son hash à persister ; l'appelant l'inclut dans
// le `data` de son propre create/update (register, verify-login-otp, reset-pin) pour
// éviter un aller-retour DB supplémentaire.
function issueRefreshToken() {
    const refreshToken = generateRefreshToken();
    return {
        refreshToken,
        refreshTokenHash: hashRefreshToken(refreshToken),
        refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
}

const smsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 SMS requests per windowMs
    message: { error: 'Trop de requêtes SMS pour cette adresse IP, veuillez réessayer après 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Même principe que loginLimiter dans corp.ts (comptes Staff) : le verrouillage par
// compte ci-dessous (3 échecs → 15 min) ne protège qu'UN numéro à la fois — sans
// limite par IP, un attaquant peut tester des PIN sur de nombreux numéros différents
// depuis la même IP sans jamais déclencher aucun des deux verrous. Défense en
// profondeur, pas un remplacement du verrouillage par compte.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Trop de tentatives de connexion depuis cette adresse. Réessayez dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /api/auth/request-otp
router.post('/request-otp', smsLimiter, async (req, res) => {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { phone } = parsed.data;

    try {
        // VUL-02 : Rate limit supplémentaire PAR NUMERO DE TÉLÉPHONE (pas seulement par IP).
        // Empêche le SMS pumping fraud depuis des IPs multiples (TOR, proxies).
        const recentOtps = await prisma.verificationCode.count({
            where: { phone, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }
        });
        if (recentOtps >= 3) {
            return res.status(429).json({ error: 'Trop de demandes pour ce numéro. Veuillez réessayer dans 1 heure.' });
        }

        const existingUser = await prisma.user.findUnique({ where: { phone } });
        if (existingUser) return res.status(400).json({ error: 'Ce numéro est déjà inscrit.' });

        // Mode Démo Automatique : si Twilio n'est pas configuré, le code est toujours 1234
        // Mode démo jamais atteignable en production, même si isSmsConfigured est faux par
        // erreur de configuration : un code aléatoire non livrable est préférable à un code
        // universel « 1234 » valide pour tout le monde. isSmsConfigured (pas seulement
        // TWILIO_ACCOUNT_SID) : un SID posé dans l'environnement sans SMS_ENABLED=true ni
        // TWILIO_AUTH_TOKEN désactivait ce mode démo alors qu'aucun SMS n'était réellement
        // envoyé — le vrai code n'atterrissait alors que dans les logs serveur (voir
        // sms.ts), invisible pour qui teste depuis l'écran de connexion.
        const useDemoMode = process.env.NODE_ENV !== 'production' && !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone, purpose: 'REGISTER' } },
            update: { code, expiresAt },
            create: { phone, purpose: 'REGISTER', code, expiresAt }
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code 1234 auto-approuvé pour ${phone}`);
        } else {
            await sendSms(phone, `Votre code de vérification Mongain est : ${code}. Il expire dans 10 minutes.`);
        }

        return res.json({ message: 'Code envoyé avec succès.' });
    } catch (e: any) {
        logger.error('Erreur envoi OTP:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/auth/request-reset-otp
router.post('/request-reset-otp', smsLimiter, async (req, res) => {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone } = parsed.data;
    try {
        const existingUser = await prisma.user.findUnique({ where: { phone } });
        if (!existingUser) return res.status(400).json({ error: 'Ce numéro n\'est pas reconnu.' });

        // VUL-02 : Rate limit PAR NUMERO pour reset PIN aussi.
        const recentOtps = await prisma.verificationCode.count({
            where: { phone, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }
        });
        if (recentOtps >= 3) {
            return res.status(429).json({ error: 'Trop de demandes pour ce numéro. Réessayez dans 1 heure.' });
        }

        // Mode démo jamais atteignable en production, même si isSmsConfigured est faux par
        // erreur de configuration : un code aléatoire non livrable est préférable à un code
        // universel « 1234 » valide pour tout le monde. isSmsConfigured (pas seulement
        // TWILIO_ACCOUNT_SID) : un SID posé dans l'environnement sans SMS_ENABLED=true ni
        // TWILIO_AUTH_TOKEN désactivait ce mode démo alors qu'aucun SMS n'était réellement
        // envoyé — le vrai code n'atterrissait alors que dans les logs serveur (voir
        // sms.ts), invisible pour qui teste depuis l'écran de connexion.
        const useDemoMode = process.env.NODE_ENV !== 'production' && !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone, purpose: 'RESET_PIN' } },
            update: { code, expiresAt },
            create: { phone, purpose: 'RESET_PIN', code, expiresAt }
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code Reset 1234 auto-approuvé pour ${phone}`);
        } else {
            await sendSms(phone, `[Mongain] Réinitialisation demandée. Votre code de sécurité est : ${code}. Valable 10 min.`);
        }
        return res.json({ message: 'Code envoyé.' });
    } catch (e: any) {
        logger.error('Erreur envoi OTP:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const resetPinSchema = z.object({
    phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
    otpCode: z.string().length(4),
    newPin: z.string().length(4).regex(/^\d+$/),
});

// POST /api/auth/reset-pin
router.post('/reset-pin', async (req, res) => {
    const parsed = resetPinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone, otpCode, newPin } = parsed.data;

    try {
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone_purpose: { phone, purpose: 'RESET_PIN' } } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code expiré ou invalide.' });
        }

        const hashedPin = await bcrypt.hash(newPin, 10);
        await prisma.verificationCode.delete({ where: { phone_purpose: { phone, purpose: 'RESET_PIN' } } });

        const { refreshToken, refreshTokenHash, refreshTokenExpiresAt } = issueRefreshToken();
        const updatedUser = await prisma.user.update({
            where: { phone },
            data: { pin: hashedPin, failedPinAttempts: 0, lockedUntil: null, jwtVersion: { increment: 1 }, refreshTokenHash, refreshTokenExpiresAt },
            include: { wallet: true }
        });

        const token = jwt.sign({ userId: updatedUser.id, jwtVersion: updatedUser.jwtVersion }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

        return res.status(200).json({
            token,
            refreshToken,
            user: { id: updatedUser.id, name: updatedUser.name, phone: updatedUser.phone, role: updatedUser.role, wallet: updatedUser.wallet },
        });
    } catch {
        return res.status(500).json({ error: 'Erreur' });
    }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { name, username, phone, pin, otpCode } = parsed.data;

    try {
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone_purpose: { phone, purpose: 'REGISTER' } } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
        }

        const hashedPin = await bcrypt.hash(pin, 10);
        const accNum = '1000100001' + crypto.randomInt(10000000000, 100000000000).toString() + crypto.randomInt(10, 100).toString();

        // Vérifié AVANT de consommer l'OTP : sinon un pseudo déjà pris faisait échouer
        // l'inscription après suppression du code, forçant l'utilisateur à redemander tout
        // un SMS juste pour corriger son pseudo alors que son numéro venait d'être vérifié.
        const existingUsername = await prisma.user.findFirst({ where: { username } });
        if (existingUsername) {
            return res.status(400).json({ error: 'Ce pseudo est déjà utilisé par un autre compte.' });
        }

        // Delete successful OTP record
        await prisma.verificationCode.delete({ where: { phone_purpose: { phone, purpose: 'REGISTER' } } });

        const { refreshToken, refreshTokenHash, refreshTokenExpiresAt } = issueRefreshToken();
        const user = await prisma.user.create({
            data: {
                accountNumber: accNum,
                name,
                username,
                phone,
                pin: hashedPin,
                refreshTokenHash,
                refreshTokenExpiresAt,
                wallet: {
                    create: {
                        balance: 0,
                        currency: 'FCFA',
                    },
                },
            },
            include: { wallet: true },
        });

        const token = jwt.sign({ userId: user.id, jwtVersion: user.jwtVersion }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

        return res.status(201).json({
            token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                wallet: user.wallet,
            },
        });
    } catch (e: any) {
        // P2002 = violation de contrainte unique (téléphone déjà pris) — la seule cause
        // réaliste ici puisque request-otp a déjà vérifié la disponibilité. Toute autre
        // erreur (ex: base injoignable) mérite son vrai message, pas ce diagnostic erroné.
        if (e?.code === 'P2002') {
            return res.status(400).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
        }
        logger.error('Erreur /auth/register:', e);
        return res.status(isDbConnectivityError(e) ? 503 : 500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { phone, pin } = parsed.data;

    try {
        // Allow login by Phone, Username or Email
        const user = await withDbRetry(() => prisma.user.findFirst({
            where: {
                OR: [
                    { phone },
                    { username: phone.toLowerCase() }, // user typed their username in the "phone" field
                    { email: phone.toLowerCase() }     // user typed their email in the "phone" field
                ]
            },
            include: { wallet: true },
        }));

        if (!user) {
            // 400, pas 401 : ce endpoint n'est pas authentifié (aucun token envoyé), donc un
            // 401 ici serait à tort intercepté comme "session expirée" par le client mobile
            // (src/services/api.ts, request()), qui masque le vrai message et déclenche un
            // logout local — inoffensif ici mais trompeur, et incohérent avec /transfer et
            // /client-initiated-withdraw qui utilisent déjà 400 pour ce même type d'échec.
            return res.status(400).json({ error: 'Numéro ou code PIN incorrect.' });
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
            const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
            return res.status(403).json({ error: `Compte sécurisé. Veuillez réessayer dans ${minutesLeft} minute(s).` });
        }

        const pinMatch = await bcrypt.compare(pin, user.pin);
        if (!pinMatch) {
            const attemptsInfo = user.failedPinAttempts + 1;
            const updates: any = { failedPinAttempts: attemptsInfo };

            if (attemptsInfo >= 3) {
                updates.lockedUntil = new Date(Date.now() + 15 * 60000); // 15 minutes
            }

            await prisma.user.update({ where: { id: user.id }, data: updates });

            // 400, pas 401 — voir commentaire ci-dessus (même correctif que /transfer).
            return res.status(400).json({
                error: attemptsInfo >= 3
                    ? 'Compte bloqué suite à trop de tentatives.'
                    : `Code PIN incorrect. Tentatives restantes : ${3 - attemptsInfo}`
            });
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { failedPinAttempts: 0, lockedUntil: null },
        });

        // Mode démo jamais atteignable en production, même si isSmsConfigured est faux par
        // erreur de configuration : un code aléatoire non livrable est préférable à un code
        // universel « 1234 » valide pour tout le monde. isSmsConfigured (pas seulement
        // TWILIO_ACCOUNT_SID) : un SID posé dans l'environnement sans SMS_ENABLED=true ni
        // TWILIO_AUTH_TOKEN désactivait ce mode démo alors qu'aucun SMS n'était réellement
        // envoyé — le vrai code n'atterrissait alors que dans les logs serveur (voir
        // sms.ts), invisible pour qui teste depuis l'écran de connexion.
        const useDemoMode = process.env.NODE_ENV !== 'production' && !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

        // Use the actual user's phone for SMS routing, in case they logged in with their username!
        const targetPhone = user.phone;

        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone: targetPhone, purpose: 'LOGIN' } },
            update: { code, expiresAt },
            create: { phone: targetPhone, purpose: 'LOGIN', code, expiresAt }
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code d'accès 1234 généré pour le login de ${targetPhone} (Pseudo: ${user.username})`);
        } else {
            await sendSms(targetPhone, `[Mongain] Votre code de connexion est : ${code}.`);
        }

        return res.json({ requireOtp: true, message: 'Un code de sécurité a été envoyé par SMS.' });
    } catch (e: any) {
        logger.error('Erreur /auth/login:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const verifyLoginOtpSchema = z.object({
    phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
    otpCode: z.string().length(4),
});

// POST /api/auth/verify-login-otp
router.post('/verify-login-otp', async (req, res) => {
    const parsed = verifyLoginOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone, otpCode } = parsed.data;

    try {
        const otpRecord = await withDbRetry(() => prisma.verificationCode.findUnique({ where: { phone_purpose: { phone, purpose: 'LOGIN' } } }));
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code OTP expiré ou invalide.' });
        }

        await prisma.verificationCode.delete({ where: { phone_purpose: { phone, purpose: 'LOGIN' } } });

        const user = await prisma.user.findUnique({ where: { phone }, include: { wallet: true } });
        if (!user) return res.status(404).json({ error: 'Compte introuvable.' });

        // Single Device Enforcement: Increment the jwtVersion
        const { refreshToken, refreshTokenHash, refreshTokenExpiresAt } = issueRefreshToken();
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: { failedPinAttempts: 0, lockedUntil: null, jwtVersion: { increment: 1 }, refreshTokenHash, refreshTokenExpiresAt },
        });

        const token = jwt.sign({ userId: user.id, jwtVersion: updatedUser.jwtVersion }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

        return res.json({
            token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                role: user.role,
                wallet: user.wallet,
            },
        });
    } catch (e: any) {
        logger.error('Erreur /auth/verify-login-otp:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const refreshSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token requis.'),
});

// POST /api/auth/refresh — échange un refresh token valide contre un nouvel access
// token. Rotation à chaque appel (fenêtre glissante) : tant que le client revient
// avant l'expiration du refresh token, il n'est jamais déconnecté.
router.post('/refresh', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    try {
        const incomingHash = hashRefreshToken(parsed.data.refreshToken);
        const user = await prisma.user.findUnique({ where: { refreshTokenHash: incomingHash } });

        if (!user || !user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
            return res.status(401).json({ error: 'Session expirée. Veuillez vous reconnecter.' });
        }
        if (user.isActive === false || user.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Votre compte a été suspendu.' });
        }

        const { refreshToken, refreshTokenHash, refreshTokenExpiresAt } = issueRefreshToken();
        await prisma.user.update({
            where: { id: user.id },
            data: { refreshTokenHash, refreshTokenExpiresAt },
        });

        const token = jwt.sign({ userId: user.id, jwtVersion: user.jwtVersion }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });

        return res.json({ token, refreshToken });
    } catch (e: any) {
        logger.error('Erreur /auth/refresh:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/auth/logout — révoque le refresh token côté serveur (déconnexion
// explicite). Best-effort côté client : la session locale est de toute façon
// effacée même si cet appel échoue (hors ligne, etc).
router.post('/logout', authMiddleware, async (req: AuthRequest, res) => {
    try {
        // jwtVersion incrémenté en plus de la purge du refresh token : sans ça, l'access
        // token déjà émis (30 min) restait accepté par authMiddleware après une déconnexion
        // volontaire — un token déjà capturé survivait à la révocation côté serveur.
        await prisma.user.update({
            where: { id: req.userId },
            data: { refreshTokenHash: null, refreshTokenExpiresAt: null, jwtVersion: { increment: 1 } },
        });
        return res.json({ message: 'Déconnecté.' });
    } catch (e: any) {
        logger.error('Erreur /auth/logout:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await withDbRetry(() => prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true },
        }));

        if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        return res.json({
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            phone: user.phone,
            role: user.role,
            kycStatus: (user as any).kycStatus,
            kycLevel: (user as any).kycLevel,
            kycRejectReason: (user as any).kycRejectReason,
            wallet: user.wallet,
        });
    } catch (e: any) {
        console.error('Erreur /auth/me:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});
const updateProfileSchema = z.object({
    name: z.string().min(2, 'Le nom doit comporter au moins 2 caractères.'),
    username: z.string().optional().nullable(),
    email: z.string().email('Format email invalide.').optional().nullable().or(z.literal('')),
    idCardFront: z.string().optional().nullable(),
    idCardBack: z.string().optional().nullable(),
    selfie: z.string().optional().nullable(),
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    try {
        const { name, username, email, idCardFront, idCardBack, selfie } = parsed.data;

        let updates: any = { name };

        if (username) {
            const cleanUsername = username.toLowerCase().replace(/\s/g, '');
            const existingUsername = await prisma.user.findFirst({ where: { username: cleanUsername, NOT: { id: req.userId } } });
            if (existingUsername) return res.status(400).json({ error: 'Ce pseudo est déjà utilisé.' });
            updates.username = cleanUsername;
        }

        if (email) {
            const cleanEmail = email.toLowerCase().replace(/\s/g, '');
            const existingEmail = await prisma.user.findFirst({ where: { email: cleanEmail, NOT: { id: req.userId } } });
            if (existingEmail) return res.status(400).json({ error: 'Cet E-mail est déjà utilisé.' });
            updates.email = cleanEmail;
        }

        if (idCardFront && idCardBack && selfie) {
            updates.idCardFront = idCardFront;
            updates.idCardBack = idCardBack;
            updates.selfie = selfie;
            updates.kycStatus = 'PENDING';

            // Signal complémentaire best-effort (voir services/kycVendorCheck.ts) — reste en
            // pratique un no-op tant qu'aucun prestataire n'est configuré (NOT_CONFIGURED),
            // mais place le point d'extension là où un vrai vendor déclencherait sa
            // vérification : à la soumission du dossier, pas seulement à la revue manuelle.
            const vendorCheck = await runKycVendorCheck({ id: req.userId as string, idCardFront, idCardBack, selfie });
            updates.kycVendorProvider = vendorCheck.provider;
            updates.kycVendorStatus = vendorCheck.status;
            updates.kycVendorCheckedAt = vendorCheck.checkedAt;
        } else {
            if (idCardFront) updates.idCardFront = idCardFront;
            if (idCardBack) updates.idCardBack = idCardBack;
            if (selfie) updates.selfie = selfie;
        }

        const user = await (prisma.user as any).update({
            where: { id: req.userId },
            data: updates,
            include: { wallet: true },
        });

        return res.json({
            id: user.id,
            name: user.name,
            username: user.username,
            email: user.email,
            phone: user.phone,
            role: user.role,
            kycStatus: user.kycStatus,
            kycLevel: user.kycLevel,
            wallet: user.wallet,
        });
    } catch (e) {
        console.error('Erreur mise à jour profil:', e);
        return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

const updatePinSchema = z.object({
    oldPin: z.string(),
    newPin: z.string().length(4, 'Le nouveau code PIN doit comporter 4 chiffres.').regex(/^\d+$/, 'Le PIN doit être numérique.'),
});

// PUT /api/auth/pin
router.put('/pin', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = updatePinSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { oldPin, newPin } = parsed.data;

    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
        });

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // 400, pas 401 — voir commentaire dans /login : ce endpoint est authentifié (token
        // valide requis), donc un 401 ici serait indiscernable côté client d'un vrai token
        // expiré et déclencherait un logout complet + message trompeur pour une simple
        // erreur de saisie de l'ancien PIN. verifyUserPin applique aussi le verrouillage à 3
        // échecs — absent ici jusqu'ici, ce qui permettait de brute-forcer l'ancien PIN
        // (4 chiffres, 10 000 combinaisons) sans aucune limite depuis une session compromise.
        const pinCheck = await verifyUserPin(user, oldPin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const hashedPin = await bcrypt.hash(newPin, 10);

        // Invalide toute session déjà ouverte (y compris le refresh token) : un changement de
        // PIN est le geste de remédiation attendu après une compromission suspectée, il doit
        // couper l'accès de quiconque détenait déjà un token valide.
        await prisma.user.update({
            where: { id: req.userId },
            data: { pin: hashedPin, jwtVersion: { increment: 1 }, refreshTokenHash: null, refreshTokenExpiresAt: null },
        });

        return res.json({ message: 'Code PIN mis à jour avec succès' });
    } catch (e) {
        console.error('Erreur mise à jour PIN:', e);
        return res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// PUT /api/auth/push-token
router.put('/push-token', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { pushToken } = req.body;
        if (!pushToken) {
            return res.status(400).json({ error: 'pushToken est requis' });
        }

        await prisma.user.update({
            where: { id: req.userId },
            data: { pushToken } as any
        });

        res.json({ message: 'Push token mis à jour avec succès.' });
    } catch (error: any) {
        console.error('Erreur push-token:', error);
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// POST /api/auth/verify-pin
router.post('/verify-pin', authMiddleware, async (req: AuthRequest, res) => {
    const { pin } = req.body;

    if (!pin || typeof pin !== 'string') {
        return res.status(400).json({ error: 'Code PIN requis.' });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId }
        });

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé.' });
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
            return res.status(403).json({ error: 'Compte temporairement verrouillé.' });
        }

        const pinMatch = await bcrypt.compare(pin, user.pin);

        if (!pinMatch) {
            const newAttempts = user.failedPinAttempts + 1;
            const updateProps: any = { failedPinAttempts: newAttempts };
            if (newAttempts >= 3) {
                updateProps.lockedUntil = new Date(Date.now() + 15 * 60000); // Lock 15 mins
            }
            await prisma.user.update({ where: { id: user.id }, data: updateProps });

            // 400, pas 401 — ce PIN protège le déverrouillage de l'app-lock (SecurityWrapper),
            // pas le token JWT. Voir commentaire dans /login pour le détail de l'incident évité.
            return res.status(400).json({ error: newAttempts >= 3 ? 'Compte bloqué.' : 'Code PIN incorrect.' });
        }

        // Reset attempts on success
        await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, lockedUntil: null } });

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Erreur interne.' });
    }
});

export default router;


