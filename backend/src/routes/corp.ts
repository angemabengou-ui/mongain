import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authCorp, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { prisma } from '../prisma';
import { isSmsConfigured, sendSms } from '../services/sms';
import { friendlyErrorMessage, withDbRetry } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

// Défense en profondeur en plus du verrouillage par compte ci-dessous : limite aussi les
// essais par IP, pour ralentir une attaque distribuée sur plusieurs emails à la fois.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Trop de tentatives de connexion depuis cette adresse. Réessayez dans 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/init', async (req, res) => {
    // VUL-07 : Désactivé en production. Si un attaquant vide la table Staff,
    // il ne peut pas s'en servir pour re-créer un SUPER_ADMIN.
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found.' });
    }
    try {
        const count = await prisma.staff.count();
        if (count > 0) return res.status(403).json({ error: 'Root already initialized' });

        // Create Headquarters Branch
        const hq = await prisma.branch.create({
            data: { name: 'Mongain Headquarters', city: 'Libreville', isHQ: true }
        });

        // Ce mot de passe n'est retourné qu'une seule fois dans cette réponse — l'opérateur
        // doit le noter immédiatement. La route ne se ré-exécute jamais (garde count > 0
        // ci-dessus), donc pas de fallback en dur réutilisable.
        const password = crypto.randomBytes(9).toString('base64url');
        const hash = await bcrypt.hash(password, 10);
        const root = await prisma.staff.create({
            data: {
                email: 'admin@mongain.com',
                password: hash,
                name: 'Root SuperAdmin',
                role: 'SUPER_ADMIN',
                branchId: hq.id
            }
        });

        res.json({ message: 'Root initialized', email: root.email, password });
    } catch (e: any) {
        console.error('Erreur /corp/init:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const staff = await withDbRetry(() => prisma.staff.findUnique({ where: { email } }));

        if (!staff || !staff.isActive) {
            return res.status(401).json({ error: 'Identifiants invalides ou compte suspendu' });
        }

        if (staff.status === 'PENDING') {
            return res.status(401).json({ error: 'Accès refusé. Votre recrutement est "EN ATTENTE" de validation par la Direction (Maker-Checker).' });
        }

        if (staff.lockedUntil && staff.lockedUntil > new Date()) {
            const minutesLeft = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60000);
            return res.status(403).json({ error: `Compte verrouillé suite à trop de tentatives. Réessayez dans ${minutesLeft} minute(s).` });
        }

        const valid = await bcrypt.compare(password, staff.password);
        if (!valid) {
            const attempts = staff.failedLoginAttempts + 1;
            const updates: any = { failedLoginAttempts: attempts };
            if (attempts >= 5) updates.lockedUntil = new Date(Date.now() + 15 * 60000);
            await prisma.staff.update({ where: { id: staff.id }, data: updates });

            return res.status(401).json({
                error: attempts >= 5
                    ? 'Compte verrouillé suite à trop de tentatives. Réessayez dans 15 minutes.'
                    : 'Identifiants invalides'
            });
        }

        if (staff.failedLoginAttempts > 0 || staff.lockedUntil) {
            await prisma.staff.update({ where: { id: staff.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
        }

        // 2FA — le compte client a déjà PIN + OTP SMS (deux facteurs), ce portail se
        // limitait jusqu'ici au mot de passe seul alors qu'il donne accès aux documents
        // KYC, à l'émission de monnaie, etc. Staff.phone est optionnel (contrairement au
        // téléphone client, obligatoire) : un compte sans numéro enregistré ne peut pas
        // recevoir de code, donc pas se connecter — pas de repli silencieux qui
        // contournerait le 2FA pour ces comptes-là.
        if (!staff.phone) {
            return res.status(400).json({ error: 'Aucun numéro de téléphone enregistré pour ce compte. Contactez un SUPER_ADMIN pour l\'ajouter avant de pouvoir vous connecter.' });
        }

        // Même garde qu'auth.ts : jamais de mode démo en production. `!isSmsConfigured` (pas
        // `!process.env.TWILIO_ACCOUNT_SID` seul) : reflète la VRAIE condition d'envoi de
        // sms.ts, pour ne jamais générer un code aléatoire qui ne finit que dans les logs
        // serveur pendant qu'un compte SID partiel traîne dans l'environnement.
        const useDemoMode = process.env.NODE_ENV !== 'production' && !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes, comme le login client

        await prisma.staffVerificationCode.upsert({
            where: { staffId: staff.id },
            update: { code, expiresAt },
            create: { staffId: staff.id, code, expiresAt }
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code d'accès 1234 généré pour le login staff de ${staff.email}`);
        } else {
            await sendSms(staff.phone, `[Mongain] Votre code de connexion personnel est : ${code}.`);
        }

        return res.json({ requireOtp: true, message: 'Un code de sécurité a été envoyé par SMS.' });
    } catch (e: any) {
        console.error('Erreur /corp/login:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const verifyLoginOtpSchema = z.object({
    email: z.string().min(1, 'Email requis.'),
    otpCode: z.string().length(4, 'Le code doit comporter 4 chiffres.'),
});

router.post('/verify-login-otp', loginLimiter, async (req, res) => {
    const parsed = verifyLoginOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { email, otpCode } = parsed.data;

    try {
        const staff = await prisma.staff.findUnique({ where: { email } });
        if (!staff || !staff.isActive) return res.status(401).json({ error: 'Identifiants invalides ou compte suspendu' });

        const otpRecord = await prisma.staffVerificationCode.findUnique({ where: { staffId: staff.id } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code expiré ou invalide.' });
        }

        await prisma.staffVerificationCode.delete({ where: { staffId: staff.id } });

        const token = jwt.sign({ userId: staff.id, role: staff.role, isCorp: true, jwtVersion: staff.jwtVersion }, JWT_SECRET, { expiresIn: '12h' });
        res.json({
            token,
            user: {
                id: staff.id,
                name: staff.name,
                role: staff.role,
                email: staff.email,
                branchId: staff.branchId,
                mustChangePassword: staff.mustChangePassword
            }
        });
    } catch (e: any) {
        console.error('Erreur /corp/verify-login-otp:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/corp/me — équivalent de /api/auth/me pour les comptes Staff (portail admin-web),
// qui ne peuvent pas utiliser /api/auth/me (celui-ci ne cherche que dans la table User B2C).
router.get('/me', authCorp, async (req: AuthRequest, res) => {
    try {
        const staff = await withDbRetry(() => prisma.staff.findUnique({
            where: { id: req.userId },
            select: { id: true, name: true, role: true, email: true, branchId: true, isActive: true, status: true, mustChangePassword: true }
        }));
        if (!staff) return res.status(404).json({ error: 'Compte introuvable.' });
        res.json(staff);
    } catch (e: any) {
        console.error('Erreur /corp/me:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PUT /api/corp/change-password — self-service, requiert le mot de passe actuel. Obligatoire
// après un onboarding (mustChangePassword=true posé par POST /api/admin/staff) mais utilisable
// par n'importe quel Staff à tout moment.
router.put('/change-password', authCorp, async (req: AuthRequest, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
        }

        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff) return res.status(404).json({ error: 'Compte introuvable.' });

        // Même verrouillage que /login (failedLoginAttempts/lockedUntil, champs déjà existants
        // sur Staff) : sans lui, une session déjà ouverte (token volé, poste laissé sans
        // surveillance) permettait de deviner le mot de passe actuel sans aucune limite de
        // tentatives, alors que /login lui-même est protégé (5 échecs -> 15 min).
        if (staff.lockedUntil && staff.lockedUntil > new Date()) {
            const minutesLeft = Math.ceil((staff.lockedUntil.getTime() - Date.now()) / 60000);
            return res.status(403).json({ error: `Compte verrouillé suite à trop de tentatives. Réessayez dans ${minutesLeft} minute(s).` });
        }

        const valid = await bcrypt.compare(currentPassword, staff.password);
        if (!valid) {
            const attempts = staff.failedLoginAttempts + 1;
            const updates: any = { failedLoginAttempts: attempts };
            if (attempts >= 5) updates.lockedUntil = new Date(Date.now() + 15 * 60000);
            await prisma.staff.update({ where: { id: staff.id }, data: updates });
            return res.status(401).json({
                error: attempts >= 5
                    ? 'Compte verrouillé suite à trop de tentatives. Réessayez dans 15 minutes.'
                    : 'Mot de passe actuel incorrect.'
            });
        }

        const samePassword = await bcrypt.compare(newPassword, staff.password);
        if (samePassword) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'ancien.' });

        const hash = await bcrypt.hash(newPassword, 10);
        await prisma.staff.update({
            where: { id: staff.id },
            // jwtVersion incrémenté : révoque immédiatement toute session déjà ouverte
            // ailleurs avec l'ancien mot de passe, comme le fait déjà /auth/reset-pin côté mobile.
            // failedLoginAttempts remis à 0 : un changement de mot de passe réussi efface
            // l'ardoise des tentatives précédentes, comme le fait déjà /login sur succès.
            data: { password: hash, mustChangePassword: false, jwtVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null }
        });

        res.json({ success: true });
    } catch (e: any) {
        console.error('Erreur /corp/change-password:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
