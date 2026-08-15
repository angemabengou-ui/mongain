import bcrypt from 'bcryptjs';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { sendSms } from '../services/sms';

const router = express.Router();

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const totalUsers = await prisma.user.count({ where: { role: 'USER', isActive: true } });
        const agentsCount = await prisma.user.count({ where: { role: 'AGENT', isActive: true } });
        const merchantsCount = await prisma.user.count({ where: { role: 'MERCHANT', isActive: true } });

        const company = await prisma.user.findUnique({ where: { phone: '+2410000000' }, include: { wallet: true } });

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
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const role = req.query.role as string;
        const users = await prisma.user.findMany({
            where: role ? { role } : undefined,
            select: {
                id: true,
                name: true,
                phone: true,
                username: true,
                email: true,
                role: true,
                isActive: true,
                kycStatus: true,
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

// PUT /api/admin/users/:id (Update Profile)
router.put('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(admin.role)) {
            return res.status(403).json({ error: 'Autorisation insuffisante.' });
        }

        const { name, phone, username, role } = req.body;
        const targetId = req.params.id as string;

        const updated = await prisma.user.update({
            where: { id: targetId },
            data: { name, phone, username: username || null, role }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'UPDATE_USER', details: `Mise à jour CRM du profil: ${updated.phone}` }
        });

        res.json({ success: true, message: 'Profil utilisateur mis à jour avec succès.', user: updated });
    } catch (e: any) {
        if (e.code === 'P2002') return res.status(400).json({ error: 'Le numéro de téléphone ou pseudo est déjà pris.' });
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const targetId = req.params.id as string;
        const targetUser: any = await prisma.user.findUnique({ where: { id: targetId }, include: { wallet: true } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (targetUser.phone === '+2410000000') {
            return res.status(403).json({ error: 'Le compte corporate racine ne peut pas être supprimé.' });
        }

        if (targetUser.wallet && targetUser.wallet.balance > 0) {
            return res.status(400).json({ error: 'Impossible de supprimer un compte avec un solde positif. Veuillez vider le compte d\'abord.' });
        }

        await prisma.user.delete({ where: { id: targetId } });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'DELETE_USER', details: `Suppression du compte de ${targetUser.name} (${targetUser.phone})` }
        });

        res.json({ success: true, message: 'Utilisateur supprimé définitivement.' });
    } catch (e: any) {
        if (e.code === 'P2003') {
            return res.status(400).json({ error: 'Impossible de supprimer ce compte car il a un historique de transactions complexe. Désactivez-le plutôt.' });
        }
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/users/create-pro
router.post('/users/create-pro', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const schema = z.object({
            phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
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
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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

// PUT /api/admin/users/:id
router.put('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const schema = z.object({
            name: z.string().min(2),
            phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
            username: z.string().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (targetUser.role === 'ADMIN' && admin.id !== targetUser.id) {
            return res.status(403).json({ error: 'Impossible de modifier un autre Administrateur.' });
        }

        const { name, phone, username } = parsed.data;

        // Check uniqueness if changing
        if (phone !== targetUser.phone) {
            const exists = await prisma.user.findUnique({ where: { phone } });
            if (exists) return res.status(400).json({ error: 'Ce numéro est déjà utilisé.' });
        }
        if (username && username !== targetUser.username) {
            const exists = await prisma.user.findUnique({ where: { username } });
            if (exists) return res.status(400).json({ error: 'Ce pseudo est déjà utilisé.' });
        }

        const updated = await prisma.user.update({
            where: { id: targetId },
            data: { name, phone, username: username || null }
        });

        res.json({ message: 'Profil mis à jour avec succès.', user: { id: updated.id, name: updated.name, phone: updated.phone } });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/users/:id/reset-pin
router.post('/users/:id/reset-pin', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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

        // SECURITE (Temporaire) : On renvoie le PIN à l'Admin Web car l'envoi de SMS réel n'est pas encore actif
        res.json({ message: `Code PIN réinitialisé avec succès ! \n\nNouveau code provisoire : ${newPin}\n\nVeuillez le communiquer à l'utilisateur de manière sécurisée.` });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/logs
router.get('/logs', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId }, include: { wallet: true } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (targetUser.role === 'ADMIN' && admin.id !== targetUser.id) {
            return res.status(403).json({ error: 'Impossible de supprimer un autre Administrateur.' });
        }

        // Soft delete logic to preserve financial logs
        const scrambledPhone = `DEL_${targetId.substring(0, 8)}_${targetUser.phone}`;
        const scrambledUsername = targetUser.username ? `DEL_${targetId.substring(0, 8)}_${targetUser.username}` : null;
        const scrambledEmail = targetUser.email ? `DEL_${targetId.substring(0, 8)}_${targetUser.email}` : null;

        await prisma.user.update({
            where: { id: targetId },
            data: {
                phone: scrambledPhone,
                username: scrambledUsername,
                email: scrambledEmail,
                isActive: false,
                name: `[SUPPRIMÉ] ${targetUser.name}`
            }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'DELETE_USER', details: `Clôture définitive du compte ${targetUser.phone}` }
        });

        res.json({ success: true, message: 'Utilisateur supprimé avec succès.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/admin/transactions/:id/refund
router.post('/transactions/:id/refund', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        // Assume ADMIN is required
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const txId = req.params.id as string;
        const reason = req.body.reason || 'Annulé par l\'administrateur';

        const originalTx = await prisma.transaction.findUnique({
            where: { id: txId },
            include: { senderWallet: { include: { user: true } }, receiverWallet: { include: { user: true } } }
        });

        if (!originalTx) return res.status(404).json({ error: 'Transaction introuvable.' });
        if (originalTx.status === 'REFUNDED') return res.status(400).json({ error: 'Cette transaction a déjà été remboursée.' });
        if (originalTx.status !== 'COMPLETED') return res.status(400).json({ error: 'Seules les transactions validées peuvent être remboursées.' });

        if (!originalTx.senderWalletId || !originalTx.receiverWalletId) {
            return res.status(400).json({ error: 'Remboursement impossible sur les dépôts cash ou retraits purs s\'il manque un portefeuille.' });
        }

        // Ensure receiver has enough balance to refund
        if (originalTx.receiverWallet!.balance < originalTx.amount) {
            return res.status(400).json({ error: 'Le destinataire n\'a plus assez de fonds pour couvrir le remboursement.' });
        }

        await prisma.$transaction(async (tx) => {
            // Take from receiver
            await tx.wallet.update({ where: { id: originalTx.receiverWalletId! }, data: { balance: { decrement: originalTx.amount } } });
            // Give to sender
            await tx.wallet.update({ where: { id: originalTx.senderWalletId! }, data: { balance: { increment: originalTx.amount } } });

            // Mark original as refunded
            await tx.transaction.update({ where: { id: txId }, data: { status: 'REFUNDED' } });

            // Create Reversal transaction
            await tx.transaction.create({
                data: {
                    amount: originalTx.amount,
                    senderWalletId: originalTx.receiverWalletId!,
                    receiverWalletId: originalTx.senderWalletId!,
                    status: 'COMPLETED',
                    reference: 'REFUND-' + originalTx.reference,
                }
            });

            await tx.auditLog.create({
                data: { adminId: admin.id, action: 'REFUND_TRANSACTION', details: `Remboursement de la TX ${originalTx.reference}. Raison: ${reason}` }
            });
        });

        res.json({ message: 'Transaction remboursée avec succès.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- V4: Modération KYC ---
router.get('/users/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const filter = req.query.status as string || 'PENDING';
        const pendingList = await (prisma.user as any).findMany({
            where: { kycStatus: filter },
            select: { id: true, name: true, phone: true, kycStatus: true, idCardFront: true, idCardBack: true, selfie: true, createdAt: true }
        });

        res.json(pendingList);
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau (KYC List)' });
    }
});

const vipLimitSchema = z.object({ limit: z.number().int().min(100) });

router.put('/users/:id/vip-limit', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

        const parsed = vipLimitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Limite invalide.' });

        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
        if (!targetUser) return res.status(404).json({ error: 'Introuvable' });

        await (prisma.user as any).update({
            where: { id: targetUser.id },
            data: { kycLevel: parsed.data.limit, kycStatus: 'APPROVED' }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'VIP_LIMIT_SET', details: `Limit of ${parsed.data.limit} FCFA set for ${targetUser.phone}` }
        });

        res.json({ message: 'Plafond VIP appliqué avec succès.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

const kycReviewSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
});

router.put('/users/:id/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Accès refusé.' });

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
        res.status(500).json({ error: `Crash Serveur KYC: ${e.message}` });
    }
});

// ==========================================
// V6 ERP: FLOAT MANAGEMENT (BRANCHES)
// ==========================================

router.get('/branches', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(admin.role)) {
            return res.status(403).json({ error: 'Accès refusé.' });
        }

        const branches = await prisma.branch.findMany({
            include: { staff: { select: { id: true, name: true, role: true, email: true } } },
            orderBy: { isHQ: 'desc' }
        });

        return res.json(branches);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post('/branches', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Seul le Super Admin peut créer une agence.' });

        const schema = z.object({ name: z.string().min(2), city: z.string().optional() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Nom invalide.' });

        const branch = await prisma.branch.create({
            data: { name: parsed.data.name, city: parsed.data.city || 'Non défini' }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'CREATE_BRANCH', details: `Création agence: ${branch.name}` }
        });

        return res.json({ success: true, branch });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post('/branches/:id/fund', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        // Only SuperAdmin or Risk can inject physical Liquidity
        if (!admin || !['SUPER_ADMIN', 'RISK'].includes(admin.role)) {
            return res.status(403).json({ error: 'Autorisation "Injection de Liquidité" requise.' });
        }

        const branchId = req.params.id as string;
        const schema = z.object({ amount: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Montant invalide.' });
        const amount = parsed.data.amount;

        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch) return res.status(404).json({ error: 'Succursale introuvable' });

        const hq = await prisma.branch.findFirst({ where: { isHQ: true } });
        if (!hq) return res.status(500).json({ error: 'Caisse Centrale HQ introuvable.' });

        if (hq.id === branchId) {
            return res.status(400).json({ error: 'Impossible d\'alimenter la Caisse Centrale avec elle-même.' });
        }

        if (hq.balance < amount) {
            return res.status(400).json({ error: `Fonds insuffisants. Solde HQ : ${hq.balance.toLocaleString('fr-FR')} FCFA` });
        }

        const [updatedHQ, updatedBranch] = await prisma.$transaction([
            prisma.branch.update({ where: { id: hq.id }, data: { balance: { decrement: amount } } }),
            prisma.branch.update({ where: { id: branchId }, data: { balance: { increment: amount } } })
        ]);

        // Audit Trail (Float Injection - Double Entry Security)
        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'FLOAT_INJECTION',
                details: `Transfert de ${amount} FCFA (HQ -> ${branch.name}). Solde HQ restant: ${updatedHQ.balance}`
            }
        });

        return res.json({ success: true, message: `Liquidité de ${amount} FCFA transférée à ${branch.name}.`, branch: updatedBranch });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// ==========================================
// V6 ERP: TELLER TERMINAL (GUICHET)
// ==========================================

router.get('/teller/lookup/:phone', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !['TELLER', 'BRANCH_MANAGER', 'SUPER_ADMIN'].includes(staff.role)) {
            return res.status(403).json({ error: 'Accès Guichet refusé.' });
        }

        const user = await prisma.user.findUnique({
            where: { phone: req.params.phone },
            select: { id: true, name: true, phone: true, kycStatus: true, role: true, avatar: true }
        });

        if (!user) return res.status(404).json({ error: 'Client introuvable.' });
        return res.json(user);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post('/teller/deposit', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, include: { branch: true } });
        if (!staff || !staff.isActive) return res.status(403).json({ error: 'Accès refusé.' });
        if (!['TELLER', 'BRANCH_MANAGER'].includes(staff.role)) return res.status(403).json({ error: 'Seul un Caissier peut effectuer un dépôt physique.' });
        if (!staff.branch) return res.status(400).json({ error: 'Vous n\'êtes affecté à aucune Agence (Coffre manquant).' });

        const schema = z.object({ phone: z.string(), amount: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });
        const { phone, amount } = parsed.data;

        const targetUser = await prisma.user.findUnique({ where: { phone }, include: { wallet: true } });
        if (!targetUser || !targetUser.wallet) return res.status(404).json({ error: 'Client introuvable.' });

        if (staff.branch.balance < amount) {
            return res.status(400).json({ error: `Fonds insuffisants dans le Coffre de l'Agence (${staff.branch.balance} FCFA). Contactez le siège.` });
        }

        const [updatedBranch, updatedWallet] = await prisma.$transaction([
            prisma.branch.update({ where: { id: staff.branch.id }, data: { balance: { decrement: amount } } }),
            prisma.wallet.update({ where: { id: targetUser.wallet.id }, data: { balance: { increment: amount } } }),
            prisma.transaction.create({
                data: {
                    reference: 'DEP' + Date.now(),
                    type: 'DEPOSIT',
                    amount: amount,
                    status: 'COMPLETED',
                    receiverId: targetUser.wallet.id, // technically it's a deposit into user's wallet
                    fee: 0,
                    metadata: { branch: staff.branch.name, teller: staff.name }
                }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'CASH_DEPOSIT',
                    details: `Dépôt Espèces: ${amount} FCFA vers ${targetUser.phone}. Nouveau solde Coffre: ${staff.branch.balance - amount}`
                }
            })
        ]);

        return res.json({ success: true, message: `Dépôt de ${amount} FCFA réussi pour ${targetUser.name}.` });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post('/teller/withdraw', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, include: { branch: true } });
        if (!staff || !staff.isActive) return res.status(403).json({ error: 'Accès refusé.' });
        if (!['TELLER', 'BRANCH_MANAGER'].includes(staff.role)) return res.status(403).json({ error: 'Seul un Caissier peut effectuer un retrait physique.' });
        if (!staff.branch) return res.status(400).json({ error: 'Vous n\'êtes affecté à aucune Agence.' });

        const schema = z.object({ phone: z.string(), amount: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });
        const { phone, amount } = parsed.data;

        const targetUser = await prisma.user.findUnique({ where: { phone }, include: { wallet: true } });
        if (!targetUser || !targetUser.wallet) return res.status(404).json({ error: 'Client introuvable.' });

        if (targetUser.wallet.balance < amount) {
            return res.status(400).json({ error: `Solde électronique client insuffisant.` });
        }

        // Customer withdrawal means they give e-Money in exchange for physical Cash from the Branch Vault.
        const [updatedWallet, updatedBranch] = await prisma.$transaction([
            prisma.wallet.update({ where: { id: targetUser.wallet.id }, data: { balance: { decrement: amount } } }),
            prisma.branch.update({ where: { id: staff.branch.id }, data: { balance: { increment: amount } } }),
            prisma.transaction.create({
                data: {
                    reference: 'WIT' + Date.now(),
                    type: 'WITHDRAWAL',
                    amount: amount,
                    status: 'COMPLETED',
                    senderId: targetUser.wallet.id,
                    fee: 0,
                    metadata: { branch: staff.branch.name, teller: staff.name }
                }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'CASH_WITHDRAW',
                    details: `Retrait Espèces: ${amount} FCFA par ${targetUser.phone}. Nouveau solde Coffre: ${staff.branch.balance + amount}`
                }
            })
        ]);

        return res.json({ success: true, message: `Retrait de ${amount} FCFA validé. Veuillez remettre les espèces au client.` });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// ==========================================
// V6 ERP: STAFF MANAGEMENT (HABILITATIONS)
// ==========================================

router.get('/staff', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(admin.role)) {
            return res.status(403).json({ error: 'Accès refusé.' });
        }

        const staffList = await prisma.staff.findMany({
            select: { id: true, email: true, name: true, role: true, isActive: true, branchId: true, branch: true, createdAt: true },
            orderBy: { createdAt: 'desc' }
        });
        return res.json(staffList);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.post('/staff', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK'].includes(admin.role)) {
            return res.status(403).json({ error: 'Seule la direction peut habiliter du personnel.' });
        }

        const schema = z.object({
            email: z.string().email(),
            name: z.string().min(2),
            password: z.string().min(6),
            role: z.enum(['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER', 'TELLER']),
            matricule: z.string().min(2),
            cni: z.string().min(2),
            phone: z.string().min(8),
            address: z.string().optional(),
            dob: z.string().optional(),
            gender: z.string().optional(),
            emergencyPhone: z.string().optional(),
            branchId: z.string().optional()
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides ou incomplètes (Matricule, CNI requis).' });

        const existing = await prisma.staff.findUnique({ where: { email: parsed.data.email } });
        if (existing) return res.status(400).json({ error: 'Cet email professionnel est déjà attribué.' });

        const hash = await bcrypt.hash(parsed.data.password, 10);

        const newStaff = await prisma.staff.create({
            data: {
                email: parsed.data.email,
                name: parsed.data.name,
                password: hash,
                role: parsed.data.role,
                matricule: parsed.data.matricule,
                cni: parsed.data.cni,
                phone: parsed.data.phone,
                address: parsed.data.address || null,
                dob: parsed.data.dob || null,
                gender: parsed.data.gender || null,
                emergencyPhone: parsed.data.emergencyPhone || null,
                status: 'PENDING', // MAKER-CHECKER LOCK
                branchId: parsed.data.branchId || null
            }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'CREATE_STAFF_PENDING', details: `Création compte Staff en attente: ${newStaff.email} (${newStaff.role})` }
        });

        return res.json({ success: true, message: 'Employé Corporate ajouté (STATUT: EN ATTENTE DE VALIDATION).' });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.put('/staff/:id/approve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK'].includes(admin.role)) {
            return res.status(403).json({ error: 'Autorisation Maker-Checker requise pour valider un recrutement.' });
        }

        const targetId = req.params.id as string;
        const targetStaff = await prisma.staff.findUnique({ where: { id: targetId } });
        if (!targetStaff) return res.status(404).json({ error: 'Staff introuvable.' });
        if (targetStaff.status === 'ACTIVE') return res.status(400).json({ error: 'Ce compte est déjà actif.' });

        await prisma.staff.update({
            where: { id: targetId },
            data: { status: 'ACTIVE', isActive: true }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'APPROVE_STAFF', details: `Habilitation définitive du matricule: ${targetStaff.matricule}` }
        });

        return res.json({ success: true, message: 'Habilitation bancaire approuvée avec succès !' });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

router.put('/staff/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'RISK'].includes(admin.role)) {
            return res.status(403).json({ error: 'Droit institutionnel requis.' });
        }

        const targetId = req.params.id as string;
        // Allows modifying Role and BranchId
        const { role, branchId, isActive } = req.body;

        const updated = await prisma.staff.update({
            where: { id: targetId },
            data: { role, branchId: branchId || null, isActive }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'UPDATE_STAFF', details: `Mutation appliquée à ${updated.name} (${updated.matricule})` }
        });

        return res.json({ success: true, message: 'Fiche du personnel mise à jour avec succès.', staff: updated });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

export default router;
