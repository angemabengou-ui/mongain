import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { authCorp, AuthRequest, JWT_SECRET } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage, withDbRetry } from '../utils/errors';

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

        const updatedStaff = staff.failedLoginAttempts > 0 || staff.lockedUntil
            ? await prisma.staff.update({ where: { id: staff.id }, data: { failedLoginAttempts: 0, lockedUntil: null } })
            : staff;

        const token = jwt.sign({ userId: staff.id, role: staff.role, isCorp: true, jwtVersion: updatedStaff.jwtVersion }, JWT_SECRET, { expiresIn: '12h' });
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
        console.error('Erreur /corp/login:', e);
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

        const valid = await bcrypt.compare(currentPassword, staff.password);
        if (!valid) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

        const samePassword = await bcrypt.compare(newPassword, staff.password);
        if (samePassword) return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent de l\'ancien.' });

        const hash = await bcrypt.hash(newPassword, 10);
        await prisma.staff.update({
            where: { id: staff.id },
            // jwtVersion incrémenté : révoque immédiatement toute session déjà ouverte
            // ailleurs avec l'ancien mot de passe, comme le fait déjà /auth/reset-pin côté mobile.
            data: { password: hash, mustChangePassword: false, jwtVersion: { increment: 1 } }
        });

        res.json({ success: true });
    } catch (e: any) {
        console.error('Erreur /corp/change-password:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
