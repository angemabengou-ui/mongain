import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthRequest, JWT_SECRET, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { sendSms } from '../services/sms';

const router = Router();

const registerSchema = z.object({
    name: z.string().min(2, 'Le nom doit comporter au moins 2 caractères.'),
    phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide.'),
    pin: z.string().length(4, 'Le code PIN doit comporter 4 chiffres.').regex(/^\d+$/, 'Le PIN doit être numérique.'),
    otpCode: z.string().length(4, 'Le code de vérification doit comporter 4 chiffres.'),
});

const requestOtpSchema = z.object({
    phone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro de téléphone invalide.'),
});

const loginSchema = z.object({
    phone: z.string(),
    pin: z.string(),
});

// POST /api/auth/request-otp
router.post('/request-otp', async (req, res) => {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { phone } = parsed.data;

    try {
        const existingUser = await prisma.user.findUnique({ where: { phone } });
        if (existingUser) return res.status(400).json({ error: 'Ce numéro est déjà inscrit.' });

        const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.verificationCode.upsert({
            where: { phone },
            update: { code, expiresAt },
            create: { phone, code, expiresAt }
        });

        await sendSms(phone, `Votre code de vérification Mongain est : ${code}. Il expire dans 10 minutes.`);

        return res.json({ message: 'Code envoyé avec succès.' });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// POST /api/auth/request-reset-otp
router.post('/request-reset-otp', async (req, res) => {
    const parsed = requestOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone } = parsed.data;
    try {
        const existingUser = await prisma.user.findUnique({ where: { phone } });
        if (!existingUser) return res.status(400).json({ error: 'Ce numéro n\'est pas reconnu.' });

        const code = Math.floor(1000 + Math.random() * 9000).toString(); // 4 chiffres
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.verificationCode.upsert({
            where: { phone },
            update: { code, expiresAt },
            create: { phone, code, expiresAt }
        });

        await sendSms(phone, `[Mongain] Réinitialisation demandée. Votre code de sécurité est : ${code}. Valable 10 min.`);
        return res.json({ message: 'Code envoyé.' });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

const resetPinSchema = z.object({
    phone: z.string(),
    otpCode: z.string().length(4),
    newPin: z.string().length(4).regex(/^\d+$/),
});

// POST /api/auth/reset-pin
router.post('/reset-pin', async (req, res) => {
    const parsed = resetPinSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone, otpCode, newPin } = parsed.data;

    try {
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code expiré ou invalide.' });
        }

        const hashedPin = await bcrypt.hash(newPin, 10);
        await prisma.verificationCode.delete({ where: { phone } });

        const updatedUser = await prisma.user.update({
            where: { phone },
            data: { pin: hashedPin, failedPinAttempts: 0, lockedUntil: null, jwtVersion: { increment: 1 } },
            include: { wallet: true }
        });

        const token = jwt.sign({ userId: updatedUser.id, jwtVersion: updatedUser.jwtVersion }, JWT_SECRET, { expiresIn: '30d' });

        return res.status(200).json({
            token,
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

    const { name, phone, pin, otpCode } = parsed.data;

    try {
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
        }

        const hashedPin = await bcrypt.hash(pin, 10);

        // Delete successful OTP record
        await prisma.verificationCode.delete({ where: { phone } });

        const user = await prisma.user.create({
            data: {
                name,
                phone,
                pin: hashedPin,
                wallet: {
                    create: {
                        balance: 0,
                        currency: 'FCFA',
                    },
                },
            },
            include: { wallet: true },
        });

        const token = jwt.sign({ userId: user.id, jwtVersion: user.jwtVersion }, JWT_SECRET, { expiresIn: '30d' });

        return res.status(201).json({
            token,
            user: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                wallet: user.wallet,
            },
        });
    } catch {
        return res.status(400).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { phone, pin } = parsed.data;

    const user = await prisma.user.findUnique({
        where: { phone },
        include: { wallet: true },
    });

    if (!user) {
        return res.status(401).json({ error: 'Numéro ou code PIN incorrect.' });
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

        return res.status(401).json({
            error: attemptsInfo >= 3
                ? 'Compte bloqué suite à trop de tentatives.'
                : `Code PIN incorrect. Tentatives restantes : ${3 - attemptsInfo}`
        });
    }

    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { failedPinAttempts: 0, lockedUntil: null, jwtVersion: { increment: 1 } },
    });

    const token = jwt.sign({ userId: user.id, jwtVersion: updatedUser.jwtVersion }, JWT_SECRET, { expiresIn: '30d' });

    return res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            role: user.role,
            wallet: user.wallet,
        },
    });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { wallet: true },
    });

    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    return res.json({
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        wallet: user.wallet,
    });
});
const updateProfileSchema = z.object({
    name: z.string().min(2, 'Le nom doit comporter au moins 2 caractères.'),
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    try {
        const updatedUser = await prisma.user.update({
            where: { id: req.userId },
            data: { name: parsed.data.name },
            include: { wallet: true },
        });

        return res.json({
            id: updatedUser.id,
            name: updatedUser.name,
            phone: updatedUser.phone,
            wallet: updatedUser.wallet,
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

        const isPinValid = await bcrypt.compare(oldPin, user.pin);
        if (!isPinValid) {
            return res.status(401).json({ error: 'Ancien code PIN incorrect' });
        }

        const hashedPin = await bcrypt.hash(newPin, 10);

        await prisma.user.update({
            where: { id: req.userId },
            data: { pin: hashedPin },
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
        res.status(500).json({ error: error.message });
    }
});

export default router;
