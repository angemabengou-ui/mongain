import bcrypt from 'bcryptjs';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { sendSms } from '../services/sms';

const router = express.Router();

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const totalUsers = await prisma.user.count({ where: { role: 'USER', isActive: true } });
        const agentsCount = await prisma.user.count({ where: { role: 'AGENT', isActive: true } });
        const merchantsCount = await prisma.user.count({ where: { role: 'MERCHANT', isActive: true } });

        const company = await prisma.user.findUnique({ where: { phone: '+24100000000' }, include: { wallet: true } });

        const circulatingWallets = await prisma.wallet.aggregate({
            where: { user: { role: { notIn: ['ADMIN'] } } },
            _sum: { balance: true }
        });
        const reserveAccount = await prisma.user.findUnique({ where: { phone: '+24199999999' }, include: { wallet: true } });
        const reserveBalance = reserveAccount?.wallet?.balance || 0;

        const fundTxs = await prisma.transaction.findMany({
            where: { reference: { startsWith: 'FUND_AGENT-' }, status: 'COMPLETED' },
            include: { receiverWallet: { include: { user: true } } }
        });

        // The total money minted into circulation is all MINT- transactions (into the vault)
        const pureMintTxs = await prisma.transaction.aggregate({
            where: { reference: { startsWith: 'MINT-' }, status: 'COMPLETED' },
            _sum: { amount: true }
        });

        let totalMinted = pureMintTxs._sum.amount || 0;
        let mintedToAgents = 0;
        let mintedToMerchants = 0;
        let mintedToClients = 0;

        fundTxs.forEach(tx => {
            if (tx.receiverWallet?.user?.role === 'AGENT') mintedToAgents += tx.amount;
            else if (tx.receiverWallet?.user?.role === 'MERCHANT') mintedToMerchants += tx.amount;
            else if (tx.receiverWallet?.user?.role === 'USER') mintedToClients += tx.amount;
        });

        const pureVolume = await prisma.transaction.aggregate({
            where: {
                status: 'COMPLETED',
                NOT: {
                    OR: [
                        { reference: { startsWith: 'MINT-' } },
                        { reference: { startsWith: 'FUND_AGENT-' } },
                        { reference: { startsWith: 'FEE-' } }
                    ]
                }
            },
            _sum: { amount: true }
        });
        const totalVolume = pureVolume._sum.amount || 0;

        res.json({
            totalUsers,
            agentsCount,
            merchantsCount,
            totalVolume,
            revenue: company?.wallet?.balance || 0,
            reserve: reserveBalance,
            totalCirculating: circulatingWallets._sum.balance || 0,
            totalMinted,
            mintedToAgents,
            mintedToMerchants,
            mintedToClients
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/reclamations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const reclamations = await prisma.reclamation.findMany({
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { phone: true, name: true } } }
        });

        res.json(reclamations);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/mint', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const schema = z.object({ amount: z.number().int('Pas de centimes (FCFA).').positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Montant invalide' });
        const { amount } = parsed.data;

        // Auto-create Reserve account if missing
        let reserve = await prisma.user.findUnique({ where: { phone: '+24199999999' }, include: { wallet: true } });
        if (!reserve) {
            reserve = await prisma.user.create({
                data: {
                    phone: '+24199999999',
                    name: 'COMPTE RÉSERVE (VOÛTE)',
                    role: 'ADMIN',
                    pin: await bcrypt.hash('0000', 10),
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }

        await prisma.$transaction(async (tx) => {
            await tx.wallet.update({
                where: { id: reserve!.wallet!.id },
                data: { balance: { increment: amount } }
            });
            await tx.transaction.create({
                data: {
                    amount,
                    receiverWalletId: reserve!.wallet!.id,
                    status: 'COMPLETED',
                    reference: 'MINT-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });
            await tx.auditLog.create({
                data: { adminId: user.id, action: 'MINT_CURRENCY', details: `Création monétaire de ${amount} FCFA vers la Voûte.` }
            });
        });

        res.json({ message: 'Voûte Centrale (Réserve) créditée avec succès.', amount });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/fund-agent', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const schema = z.object({ phone: z.string(), amount: z.number().int('Pas de centimes.').positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });
        const { phone, amount } = parsed.data;

        const reserve = await prisma.user.findUnique({ where: { phone: '+24199999999' }, include: { wallet: true } });
        if (!reserve || !reserve.wallet || reserve.wallet.balance < amount) {
            return res.status(400).json({ error: 'Fonds insuffisants dans la Voûte Centrale (Réserve).' });
        }

        const targetUser = await prisma.user.findUnique({ where: { phone }, include: { wallet: true } });
        if (!targetUser || !targetUser.wallet) return res.status(404).json({ error: 'Utilisateur cible introuvable.' });

        await prisma.$transaction(async (tx) => {
            await tx.wallet.update({ where: { id: reserve.wallet!.id }, data: { balance: { decrement: amount } } });
            await tx.wallet.update({ where: { id: targetUser.wallet!.id }, data: { balance: { increment: amount } } });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: reserve.wallet!.id,
                    receiverWalletId: targetUser.wallet!.id,
                    status: 'COMPLETED',
                    reference: 'FUND_AGENT-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });
            await tx.auditLog.create({
                data: { adminId: user.id, action: 'FUND_FRANCHISE', details: `Financement de ${amount} FCFA pour ${targetUser.phone}` }
            });
        });

        res.json({ message: 'Franchise financée avec succès depuis la Réserve.', amount });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/users
router.get('/users', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const role = req.query.role as string;
        const users = await prisma.user.findMany({
            where: role ? { role } : undefined,
            select: {
                id: true,
                name: true,
                phone: true,
                role: true,
                isActive: true,
                failedPinAttempts: true,
                createdAt: true,
                wallet: { select: { balance: true, currency: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(users);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/users/create-pro
router.post('/users/create-pro', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const schema = z.object({
            phone: z.string(),
            name: z.string().min(2),
            role: z.enum(['AGENT', 'MERCHANT', 'ADMIN']),
            pin: z.string().min(4),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });

        const { phone, name, role, pin } = parsed.data;

        const existing = await prisma.user.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ error: 'Ce numéro de téléphone est déjà pris.' });

        const hashedPin = await bcrypt.hash(pin, 10);
        const newUser = await prisma.user.create({
            data: {
                phone,
                name,
                pin: hashedPin,
                role,
                wallet: { create: { balance: 0, currency: 'FCFA' } }
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: user.id,
                action: 'CREATE_PRO_USER',
                details: `Création du compte PRO ${role} pour ${phone}`,
            }
        });

        res.json({ message: 'Compte Pro créé avec succès.', user: { id: newUser.id, name, phone, role } });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/users/:id/toggle-status
router.post('/users/:id/toggle-status', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        if (targetUser.role === 'ADMIN') return res.status(400).json({ error: 'Impossible de désactiver un Administrateur Supremo.' });

        const updated = await prisma.user.update({
            where: { id: targetUser.id },
            data: { isActive: !targetUser.isActive }
        });

        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'TOGGLE_STATUS',
                details: `Le compte ${targetUser.phone} a été passé en statut ${updated.isActive ? 'ACTIF' : 'SUSPENDU'}`,
            }
        });

        res.json({ message: `Le compte est désormais ${updated.isActive ? 'ACTIF' : 'SUSPENDU'}.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/users/:id/reset-pin
router.post('/users/:id/reset-pin', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur non trouvé' });

        const newPin = Math.floor(1000 + Math.random() * 9000).toString(); // Génère 4 chiffres aléatoires
        const hashedPin = await bcrypt.hash(newPin, 10);

        await prisma.user.update({
            where: { id: targetUser.id },
            data: { pin: hashedPin, failedPinAttempts: 0, lockedUntil: null }
        });

        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'RESET_PIN',
                details: `Réinitialisation du PIN pour l'utilisateur ${targetUser.phone}`,
            }
        });

        // Envoi du SMS (Simulé ou Réel Twilio)
        await sendSms(targetUser.phone, `Mongain : Votre code PIN a été réinitialisé par un Administrateur. Votre nouveau PIN de sécurité est : ${newPin}. Ne le partagez avec personne.`);

        // SECURITE : on ne renvoie pas le PIN en clair au front-end
        res.json({ message: `Code PIN réinitialisé avec succès. Un SMS contenant le nouveau code a été envoyé au client.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/logs
router.get('/logs', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const logs = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            include: { admin: { select: { phone: true, name: true } } },
            take: 100 // On limite aux 100 derniers logs
        });

        res.json(logs);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/ledger
router.get('/ledger', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const txs = await prisma.transaction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 200, // Les 200 dernières transactions
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true, role: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true, role: true } } } },
            }
        });

        res.json(txs);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- V4: Modération KYC ---
router.get('/users/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const pendingList = await (prisma.user as any).findMany({
            where: { kycStatus: 'PENDING' },
            select: { id: true, name: true, phone: true, kycStatus: true, idCardFront: true, idCardBack: true, selfie: true, createdAt: true }
        });

        res.json(pendingList);
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau (KYC List)' });
    }
});

const kycReviewSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
});

router.put('/users/:id/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const parsed = kycReviewSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Statut invalide.' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        const newLevel = parsed.data.status === 'APPROVED' ? 1 : 0;

        await (prisma.user as any).update({
            where: { id: targetId },
            data: { kycStatus: parsed.data.status, kycLevel: newLevel }
        });

        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: `KYC_${parsed.data.status}`,
                details: `KYC for ${targetUser.phone} set to ${parsed.data.status}`
            }
        });

        // Optionnel : Notifier le client du succès ou de l'échec (Firebase)

        res.json({ message: 'Dossier KYC traité avec succès.' });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur serveur.' });
    }
});

export default router;
