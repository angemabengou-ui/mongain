import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { NextFunction, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { MAXIMUM_ALLOWED_LIMIT } from '../services/LimitEngine';
import { isSmsConfigured, sendSms } from '../services/sms';
import { friendlyErrorMessage, isDbConnectivityError } from '../utils/errors';
import logger from '../utils/logger';
import { verifyUserPin } from '../utils/pinAuth';

const router = Router();

router.use(authMiddleware);

// Un compte CHILD ne peut jamais gérer d'autres comptes enfant (pas de petits-enfants, pas
// de contournement en enchaînant deux inscriptions) — vérifié une seule fois ici pour
// toutes les routes de ce fichier, plutôt que répété dans chaque handler.
router.use(async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const caller = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
        if (!caller) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        if (caller.role === 'CHILD') return res.status(403).json({ error: 'Un compte enfant ne peut pas gérer de comptes enfant.' });
        next();
    } catch (e: any) {
        logger.error('Erreur /family (contrôle rôle appelant):', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const childOtpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { error: 'Trop de requêtes SMS pour cette adresse IP, veuillez réessayer après 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const requestChildOtpSchema = z.object({
    phone: z.string().regex(/^\+?[0-9\s]{8,15}$/, 'Numéro de téléphone invalide.').transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
});

// POST /api/family/otp
router.post('/otp', childOtpLimiter, async (req: AuthRequest, res) => {
    const parsed = requestChildOtpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { phone } = parsed.data;

    try {
        // Même garde-fou anti-SMS-pumping que /auth/request-otp (VUL-02), par numéro plutôt
        // que par IP.
        const recentOtps = await prisma.verificationCode.count({
            where: { phone, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }
        });
        if (recentOtps >= 3) {
            return res.status(429).json({ error: 'Trop de demandes pour ce numéro. Veuillez réessayer dans 1 heure.' });
        }

        const existingUser = await prisma.user.findUnique({ where: { phone } });
        if (existingUser) return res.status(400).json({ error: 'Ce numéro est déjà inscrit.' });

        const useDemoMode = !isSmsConfigured;
        const code = useDemoMode ? '1234' : crypto.randomInt(1000, 10000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone, purpose: 'CHILD_REGISTER' } },
            update: { code, expiresAt },
            create: { phone, purpose: 'CHILD_REGISTER', code, expiresAt }
        });

        if (useDemoMode) {
            logger.info(`[DEMO MODE] Code 1234 auto-approuvé pour ${phone} (compte enfant)`);
        } else {
            await sendSms(phone, `Votre code de vérification Mongain (compte enfant) est : ${code}. Il expire dans 10 minutes.`);
        }

        return res.json({ message: 'Code envoyé avec succès.' });
    } catch (e: any) {
        logger.error('Erreur /family/otp:', e);
        return res.status(isDbConnectivityError(e) ? 503 : 500).json({ error: friendlyErrorMessage(e) });
    }
});

const registerChildSchema = z.object({
    name: z.string().min(2, 'Le nom doit comporter au moins 2 caractères.'),
    phone: z.string().regex(/^\+?[0-9\s]{8,15}$/, 'Numéro de téléphone invalide.').transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
    pin: z.string().length(4, 'Le code PIN doit comporter 4 chiffres.').regex(/^\d+$/, 'Le PIN doit être numérique.'),
    otpCode: z.string().length(4, 'Le code de vérification doit comporter 4 chiffres.'),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
});

// POST /api/family/children — crée le compte de l'enfant (son propre login), rattaché au
// parent appelant. Ne renvoie AUCUN token : la session en cours reste celle du parent.
router.post('/children', async (req: AuthRequest, res) => {
    const parsed = registerChildSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { name, phone, pin, otpCode, gender } = parsed.data;

    try {
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone_purpose: { phone, purpose: 'CHILD_REGISTER' } } });
        if (!otpRecord || otpRecord.code !== otpCode || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code de vérification invalide ou expiré.' });
        }

        const hashedPin = await bcrypt.hash(pin, 10);
        const accNum = '1000100001' + crypto.randomInt(10000000000, 100000000000).toString() + crypto.randomInt(10, 100).toString();

        await prisma.verificationCode.delete({ where: { phone_purpose: { phone, purpose: 'CHILD_REGISTER' } } });

        const child = await prisma.user.create({
            data: {
                accountNumber: accNum,
                name,
                phone,
                pin: hashedPin,
                role: 'CHILD',
                parentId: req.userId!,
                gender,
                wallet: { create: { balance: 0, currency: 'FCFA' } },
            },
            include: { wallet: true },
        });

        await prisma.auditLog.create({
            data: {
                adminId: req.userId!,
                action: 'CHILD_ACCOUNT_CREATED',
                details: `Compte enfant créé : ${child.name} (${child.phone}), id=${child.id}`,
            }
        });

        return res.status(201).json({
            id: child.id,
            name: child.name,
            phone: child.phone,
            gender: child.gender,
            wallet: child.wallet,
        });
    } catch (e: any) {
        // P2002 = numéro déjà pris entre l'OTP et la soumission (voir /auth/register, même
        // logique) — seule cause réaliste ici puisque /family/otp a déjà vérifié la disponibilité.
        if (e?.code === 'P2002') {
            return res.status(400).json({ error: 'Ce numéro de téléphone est déjà utilisé.' });
        }
        logger.error('Erreur /family/children (POST):', e);
        return res.status(isDbConnectivityError(e) ? 503 : 500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/family/children
router.get('/children', async (req: AuthRequest, res) => {
    try {
        const children = await prisma.user.findMany({
            where: { parentId: req.userId, role: 'CHILD' },
            select: {
                id: true, name: true, phone: true, gender: true,
                childSpendLimitAmount: true, childSpendLimitPeriod: true,
                createdAt: true,
                wallet: { select: { id: true, balance: true, currency: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        return res.json(children);
    } catch (e: any) {
        logger.error('Erreur /family/children (GET):', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/family/children/:id
router.get('/children/:id', async (req: AuthRequest, res) => {
    try {
        const childId = String(req.params.id);
        const child = await prisma.user.findFirst({
            where: { id: childId, parentId: req.userId, role: 'CHILD' },
            select: {
                id: true, name: true, phone: true, gender: true,
                childSpendLimitAmount: true, childSpendLimitPeriod: true,
                createdAt: true,
                wallet: { select: { id: true, balance: true, currency: true } },
            },
        });
        if (!child) return res.status(404).json({ error: 'Compte enfant introuvable.' });
        return res.json(child);
    } catch (e: any) {
        logger.error('Erreur /family/children/:id (GET):', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const setLimitSchema = z.object({
    period: z.enum(['DAILY', 'WEEKLY']),
    // .int() : le FCFA n'a aucune sous-unité (User.childSpendLimitAmount est Int) — sans ça,
    // un montant décimal passait la validation Zod puis échouait plus loin sur l'écriture Prisma.
    amount: z.number().int('Le montant doit être un nombre entier.').positive('Le montant doit être positif.'),
    pin: z.string(),
});

// PUT /api/family/children/:id/limit — ajuste le plafond de dépense de l'enfant. Protégé par
// le PIN du PARENT (pas celui de l'enfant, qui n'a pas d'autorité sur son propre plafond).
router.put('/children/:id/limit', async (req: AuthRequest, res) => {
    const parsed = setLimitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { period, amount, pin } = parsed.data;

    try {
        const parent = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!parent) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        const pinCheck = await verifyUserPin(parent, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const childId = String(req.params.id);
        const child = await prisma.user.findFirst({ where: { id: childId, parentId: req.userId, role: 'CHILD' } });
        if (!child) return res.status(404).json({ error: 'Compte enfant introuvable.' });

        const clampedAmount = Math.min(amount, MAXIMUM_ALLOWED_LIMIT);

        const updated = await prisma.user.update({
            where: { id: child.id },
            data: { childSpendLimitAmount: clampedAmount, childSpendLimitPeriod: period },
        });

        await prisma.auditLog.create({
            data: {
                adminId: req.userId!,
                action: 'CHILD_LIMIT_UPDATED',
                details: `Plafond mis à jour pour l'enfant ${child.id} : ${period} ${clampedAmount} FCFA`,
            }
        });

        return res.json({
            id: updated.id,
            childSpendLimitAmount: updated.childSpendLimitAmount,
            childSpendLimitPeriod: updated.childSpendLimitPeriod,
        });
    } catch (e: any) {
        logger.error('Erreur /family/children/:id/limit (PUT):', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/family/children/:id/transactions — supervision parentale : historique des
// transactions de l'enfant, même format que GET /api/wallet/transactions (wallet.ts), scopé à
// l'enfant demandé ET vérifié appartenir à l'appelant (même garde que les routes ci-dessus).
router.get('/children/:id/transactions', async (req: AuthRequest, res) => {
    try {
        const childId = String(req.params.id);
        const child = await prisma.user.findFirst({
            where: { id: childId, parentId: req.userId, role: 'CHILD' },
            select: { id: true },
        });
        if (!child) return res.status(404).json({ error: 'Compte enfant introuvable.' });

        const wallet = await prisma.wallet.findUnique({ where: { userId: child.id } });
        if (!wallet) return res.status(404).json({ error: 'Portefeuille introuvable.' });

        const page = parseInt(req.query.page as string) || 1;
        const rawLimit = parseInt(req.query.limit as string) || 50;
        const limit = Math.min(Math.max(rawLimit, 1), 100);
        const skip = (page - 1) * limit;

        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [{ senderWalletId: wallet.id }, { receiverWalletId: wallet.id }],
            },
            include: {
                senderWallet: { include: { user: { select: { phone: true, name: true } } } },
                receiverWallet: { include: { user: { select: { phone: true, name: true } } } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        });

        const formatted = transactions.map(tx => {
            if (tx.senderWalletId === tx.receiverWalletId) {
                return {
                    id: tx.id,
                    type: tx.reference?.startsWith('DEPOSIT') ? 'incoming' : 'outgoing',
                    amount: tx.amount,
                    currency: wallet.currency,
                    status: tx.status,
                    reference: tx.reference,
                    counterpart: 'Système (Mongain)',
                    counterpartPhone: 'Mongain',
                    createdAt: tx.createdAt,
                };
            }

            const isIncoming = tx.receiverWalletId === wallet.id;
            return {
                id: tx.id,
                type: isIncoming ? 'incoming' as const : 'outgoing' as const,
                amount: tx.amount,
                currency: wallet.currency,
                status: tx.status,
                reference: tx.reference,
                counterpart: isIncoming ? (tx.senderWallet?.user?.name || 'Agence / Banque Centrale') : (tx.receiverWallet?.user?.name || 'Agence / Banque Centrale'),
                counterpartPhone: isIncoming ? (tx.senderWallet?.user?.phone || 'SYSTEM') : (tx.receiverWallet?.user?.phone || 'SYSTEM'),
                createdAt: tx.createdAt,
            };
        });

        return res.json(formatted);
    } catch (e: any) {
        logger.error('Erreur /family/children/:id/transactions (GET):', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
