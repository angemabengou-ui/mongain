import bcrypt from 'bcryptjs';
import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getSystemSettings } from './settings';

const expo = new Expo();

export const sendPush = async (token: string | null | undefined, title: string, body: string) => {
    if (token && Expo.isExpoPushToken(token)) {
        try {
            await expo.sendPushNotificationsAsync([{ to: token, sound: 'default', title, body }]);
        } catch (e) {
            console.error('Erreur Push Notification:', e);
        }
    }
};

const router = Router();

const transferSchema = z.object({
    receiverPhone: z.string(),
    amount: z.number().int('Les décimales sont interdites pour le FCFA.').positive('Le montant doit être positif.'),
    pin: z.string().length(4).optional(),
    useBiometrics: z.boolean().optional(),
});

const depositSchema = z.object({
    phone: z.string(),
    amount: z.number().int('Les décimales sont interdites pour le FCFA.').positive('Le montant doit être positif.'),
});

const withdrawSchema = z.object({
    amount: z.number().int('Les décimales sont interdites pour le FCFA.').positive('Le montant doit être positif.'),
    pin: z.string().length(4).optional(),
    useBiometrics: z.boolean().optional(),
});

const chargeSchema = z.object({
    payerPhone: z.string().min(8),
    amount: z.number().int('Les décimales sont interdites pour le FCFA.').positive('Le montant doit être positif.'),
    withdrawCode: z.string().length(6)
});

router.post('/generate-withdraw-code', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { amount } = req.body;
        if (!amount || typeof amount !== 'number' || amount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
        const dbCode = `${code}:${amount}`;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        await prisma.verificationCode.upsert({
            where: { phone: user.phone },
            update: { code: dbCode, expiresAt },
            create: { phone: user.phone, code: dbCode, expiresAt }
        });

        return res.json({ code });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur génération code' });
    }
});
// --- Valider les Plafonds V4 ---
async function verifyDailyLimit(userId: string, requestedAmount: number, settings: any) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
    if (!user || !user.wallet) throw new Error("Compte expéditeur introuvable");

    // Seuls les utilisateurs standards (USER) sont soumis aux plafonds
    if (user.role !== 'USER') return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const txs = await prisma.transaction.aggregate({
        where: {
            senderWalletId: user.wallet.id,
            createdAt: { gte: today }
        },
        _sum: { amount: true }
    });

    const sumToday = txs._sum.amount || 0;
    const limit = (user as any).kycLevel >= 1 ? settings.dailyLimitTier1 : settings.dailyLimitTier0;

    if (sumToday + requestedAmount > limit) {
        throw new Error(`Plafond journalier dépassé (Limite: ${limit} FCFA). Montant déjà utilisé aujourd'hui : ${sumToday} FCFA. Pour augmenter votre limite, vérifiez votre compte.`);
    }
}

// GET /api/wallet/limits
router.get('/limits', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') return res.json({ skip: true }); // Les Agents/Marchands n'ont pas de limite journalière stricte dans cette V4.

        const settings = await getSystemSettings();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const txs = await prisma.transaction.aggregate({
            where: { senderWalletId: user.wallet!.id, createdAt: { gte: today } },
            _sum: { amount: true }
        });

        const dailySpend = txs._sum.amount || 0;
        const dailyLimit = (user as any).kycLevel >= 1 ? (settings as any).dailyLimitTier1 : (settings as any).dailyLimitTier0;

        res.json({ dailySpend, dailyLimit, kycStatus: (user as any).kycStatus, kycLevel: (user as any).kycLevel });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur lors du calcul des limites.' });
    }
});

// POST /api/wallet/transfer
router.post('/transfer', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = transferSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { receiverPhone, amount } = parsed.data;

        const sender = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });
        if (!sender || !sender.wallet) return res.status(404).json({ error: 'Expéditeur introuvable.' });
        if (sender.phone === receiverPhone) return res.status(400).json({ error: 'Vous ne pouvez pas vous transférer des fonds à vous-même.' });

        const receiver = await prisma.user.findUnique({
            where: { phone: receiverPhone },
            include: { wallet: true }
        });
        if (!receiver || !receiver.wallet) return res.status(404).json({ error: 'Destinataire introuvable.' });

        const settings = await getSystemSettings();

        // Taxe Mongain Dynamique sur le paiement (P2P et Marchands à 1%)
        let taxVal = Math.ceil(amount * settings.taxP2P);

        // --- Exemptions de Frais ---
        // 1. Transfert de l'Agence (Agent) vers un Client
        if (sender.role === 'AGENT' && receiver.role === 'USER') {
            taxVal = 0;
        }
        // 2. Transfert du Siège (Admin) vers un Agent
        if (sender.role === 'ADMIN' && receiver.role === 'AGENT') {
            taxVal = 0;
        }

        const totalDebit = amount + taxVal;

        if (sender.wallet.balance < totalDebit) {
            return res.status(400).json({ error: `Solde insuffisant. Vous devez disposer de ${totalDebit} FCFA (dont ${taxVal} FCFA de frais de réseau).` });
        }

        // Vérification du plafond journalier KYC
        await verifyDailyLimit(sender.id, totalDebit, settings);

        // Compte Corporate
        const corporate = await prisma.user.findUnique({
            where: { phone: '+24100000000' },
            include: { wallet: true }
        });

        const newBalance = await prisma.$transaction(async (tx) => {
            // Débit
            const sWallet = await tx.wallet.update({
                where: { id: sender.wallet!.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });

            // Crédit destinataire
            await tx.wallet.update({
                where: { id: receiver.wallet!.id },
                data: { balance: { increment: amount } }
            });

            // Crédit Taxe Corporate
            if (corporate && corporate.wallet) {
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: taxVal } }
                });

                await tx.transaction.create({
                    data: {
                        amount: taxVal,
                        senderWalletId: sender.wallet!.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: 'FEE-' + Math.random().toString(36).substring(7).toUpperCase(),
                    }
                });
            }

            // Historique Transfert
            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: sender.wallet!.id,
                    receiverWalletId: receiver.wallet!.id,
                    status: 'COMPLETED',
                    reference: 'TRANSFER-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });

            return sWallet.balance;
        });

        // Notifications asynchrones
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${receiverPhone}`).emit('payment_received', {
                amount,
                from: sender.name
            });
        }

        // Push Notification to Receiver
        sendPush((receiver as any).pushToken, 'Transfert Reçu 💰', `Vous avez reçu ${amount.toLocaleString('fr-FR')} FCFA de ${sender.name}.`);

        return res.json({
            message: 'Transfert effectué avec succès.',
            data: {
                remainingBalance: newBalance,
                receiverName: receiver.name
            }
        });
    } catch (e: any) {
        return res.status(400).json({ error: e.message || 'Erreur lors du transfert.' });
    }
});

// GET /api/wallet/balance
router.get('/balance', authMiddleware, async (req: AuthRequest, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
    if (!wallet) return res.status(404).json({ error: 'Portefeuille introuvable.' });
    return res.json({ balance: wallet.balance, currency: wallet.currency });
});

// GET /api/wallet/transactions
router.get('/transactions', authMiddleware, async (req: AuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const rawLimit = parseInt(req.query.limit as string) || 50;
    const limit = Math.min(Math.max(rawLimit, 1), 100);
    const skip = (page - 1) * limit;

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
    if (!wallet) return res.status(404).json({ error: 'Portefeuille introuvable.' });

    const transactions = await prisma.transaction.findMany({
        where: {
            OR: [{ senderWalletId: wallet.id }, { receiverWalletId: wallet.id }],
        },
        include: {
            senderWallet: { include: { user: true } },
            receiverWallet: { include: { user: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
    });

    const formatted = transactions.map(tx => {
        // Si c'est un dépôt pur ou la même personne (nous utilisons senderWalletId = receiverWalletId pour dépôt/retrait)
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
            counterpart: isIncoming ? (tx.senderWallet?.user.name || 'Banque Centrale (Mongain)') : tx.receiverWallet.user.name,
            counterpartPhone: isIncoming ? (tx.senderWallet?.user.phone || 'SYSTEM') : tx.receiverWallet.user.phone,
            createdAt: tx.createdAt,
        };
    });

    return res.json(formatted);
});

// GET /api/wallet/lookup/:phone — Trouver un destinataire par numéro avant transfert
router.get('/lookup/:phone', authMiddleware, async (req: AuthRequest, res) => {
    const phone = decodeURIComponent(req.params.phone as string);

    const user = await prisma.user.findUnique({
        where: { phone },
        select: { id: true, name: true, phone: true, role: true },
    });

    if (!user) return res.status(404).json({ error: 'Aucun compte trouvé pour ce numéro.' });
    if (user.id === req.userId) return res.status(400).json({ error: "Vous ne pouvez pas vous envoyer de l'argent." });

    return res.json({ id: user.id, name: user.name, phone: user.phone, role: user.role });
});

// POST /api/wallet/deposit (Agent to User)
router.post('/deposit', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = depositSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { amount, phone } = parsed.data as any; // phone string added to body if needed. Wait, depositSchema needs 'phone'. Let's relax it.
    if (!phone) return res.status(400).json({ error: 'Numéro du client manquant.' });

    try {
        const result = await prisma.$transaction(async (tx) => {
            const agent = await tx.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
            if (!agent || agent.role !== 'AGENT') throw new Error('Action non autorisée. Réservé aux Agents.');
            if (!agent.wallet || agent.wallet.balance < amount) throw new Error('Solde Agent insuffisant.');

            const client = await tx.user.findUnique({ where: { phone }, include: { wallet: true } });
            if (!client || !client.wallet) throw new Error('Client introuvable.');

            const updatedAgentWallet = await tx.wallet.update({
                where: { id: agent.wallet.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            await tx.wallet.update({
                where: { id: client.wallet.id },
                data: { balance: { increment: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: agent.wallet.id,
                    receiverWalletId: client.wallet.id,
                    status: 'COMPLETED',
                    reference: 'DEPOSIT-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });
            return { balance: updatedAgentWallet.balance, clientName: client.name, pushToken: (client as any).pushToken };
        });

        // Notify Client via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${phone}`).emit('payment_received', {
                amount,
                from: 'Agent Mongain'
            });
        }

        // Trigger Push
        sendPush(result.pushToken, 'Dépôt Réussi 🏦', `L'agent vous a déposé ${amount.toLocaleString('fr-FR')} FCFA. Ton solde est mis à jour.`);

        return res.json({ message: `Dépôt de ${amount} FCFA effectué vers ${result.clientName}.`, balance: result.balance });
    } catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
});

// POST /api/wallet/agent-withdraw (Agent Pulls from Client)
router.post('/agent-withdraw', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const agentId = req.userId;
        const agent = await prisma.user.findUnique({
            where: { id: agentId },
            include: { wallet: true }
        });

        if (!agent) return res.status(404).json({ error: 'Agent introuvable' });
        if (agent.role !== 'AGENT' && agent.role !== 'MERCHANT') return res.status(403).json({ error: 'Autorisation refusée. Seul un AGENT ou COMMEÇANT peut encaisser un retrait physique.' });

        const { payerPhone, withdrawCode } = req.body;
        if (!payerPhone || !withdrawCode) {
            return res.status(400).json({ error: 'Téléphone et Jeton requis.' });
        }

        const client = await prisma.user.findUnique({
            where: { phone: payerPhone },
            include: { wallet: true }
        });

        if (!client || !client.wallet) return res.status(404).json({ error: 'Client introuvable' });

        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone: payerPhone } });
        if (!otpRecord || otpRecord.expiresAt < new Date()) {
            return res.status(403).json({ error: 'Jeton de retrait invalide ou expiré.' });
        }

        const [savedCode, savedAmountStr] = otpRecord.code.split(':');
        if (savedCode !== withdrawCode || !savedAmountStr) {
            return res.status(403).json({ error: 'Jeton de retrait incorrect.' });
        }

        const amount = parseFloat(savedAmountStr);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Erreur intégrité. Montant corrompu.' });
        }

        const settings = await getSystemSettings();

        // --- Commission Partagée Dynamique selon le rôle ---
        let totalTax = 0;
        let agentReward = 0;

        // Si c'est un Commerçant, le retrait est payant (ex: 1.3%)
        if (agent.role === 'MERCHANT') {
            totalTax = Math.ceil(amount * settings.taxWithdraw);
            agentReward = Math.ceil(amount * settings.rewardMerchant);
        }
        // Si c'est un Agent Mongain, le retrait est gratuit (0%)
        else if (agent.role === 'AGENT') {
            totalTax = 0;
            agentReward = 0;
            // Note: Si une prime spécifique agent existe (payée par Mongain), on l'ajoute ici. On reste gratuit pour le client.
        }

        const totalDebit = amount + totalTax;

        // Mongain encaisse le reste (ex: 1.0%)
        const netMongain = totalTax - agentReward;

        if (client.wallet.balance < totalDebit) return res.status(400).json({ error: `Solde insuffisant pour le retrait (Frais: ${totalTax} FCFA).` });
        if (client.id === agent.id) return res.status(400).json({ error: 'Opération circulaire interdite.' });

        // Vérification du plafond pour le retrait client
        await verifyDailyLimit(client.id, totalDebit, settings);

        const corporate = await prisma.user.findUnique({
            where: { phone: '+24100000000' },
            include: { wallet: true }
        });

        // Transaction atomique
        const transactionResult = await prisma.$transaction(async (tx) => {
            // 1. Débit client total
            const clientNav = await tx.wallet.update({
                where: { id: client.wallet!.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });

            // 2. Crédit Agent (Montant du retrait + Prime Commerçant)
            await tx.wallet.update({
                where: { id: agent.wallet!.id },
                data: { balance: { increment: amount + agentReward } }
            });

            // 3. Bénéfice Corporate
            if (corporate && corporate.wallet && netMongain > 0) {
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: netMongain } }
                });

                await tx.transaction.create({
                    data: {
                        amount: netMongain,
                        senderWalletId: client.wallet!.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: 'FEE-REVENUE-' + Math.random().toString(36).substring(7).toUpperCase(),
                    }
                });
            }

            // Historique Global
            const transactionRecord = await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: client.wallet!.id,
                    receiverWalletId: agent.wallet!.id,
                    status: 'COMPLETED',
                    reference: 'WITHDRAW-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });

            // Destruction du Jeton OTP pour empêcher le Replay Attack
            await prisma.verificationCode.delete({ where: { phone: client.phone } });

            return transactionRecord;
        });

        // Notifications
        if ((client as any).pushToken) {
            fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: (client as any).pushToken,
                    title: '💵 Retrait effectué',
                    body: `Vous avez retiré ${amount.toLocaleString('fr-FR')} FCFA chez l'Agent ${agent.name}. Frais: 0 FCFA.`,
                    data: { amount },
                    sound: 'default'
                })
            }).catch(e => console.error('Push Error:', e));
        }

        const io = req.app.get('io');
        if (io) {
            io.to(`user_${agent.phone}`).emit('payment_received', {
                amount: amount,
                from: payerPhone
            });
            io.to(`user_${payerPhone}`).emit('payment_received', {
                amount: -totalDebit,
                from: 'Agent ' + agent.name
            });
        }

        res.json({ message: 'Retrait autorisé avec succès. Remettez les espèces au client.', transaction: transactionResult, agentCommission: agentReward });
    } catch (e: any) {
        console.error('Agent Withdraw Error:', e);
        res.status(400).json({ error: e.message || 'Erreur lors du retrait' });
    }
});

// POST /api/wallet/transfer
router.post('/transfer', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { receiverPhone, amount, pin } = parsed.data;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const sender = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true },
            });

            if (!sender || !sender.wallet) throw new Error('Compte expéditeur introuvable.');

            // Limite Anti-Blanchiment (KYC Niveau 1)
            if (amount > 500000) {
                throw new Error('Limite de transfert dépassée (Max: 500 000 FCFA). Veuillez certifier votre compte KYC pour augmenter vos plafonds.');
            }

            if (sender.lockedUntil && sender.lockedUntil > new Date()) {
                throw new Error('Votre compte est temporairement bloqué suite à plusieurs échecs. Réessayez plus tard.');
            }

            if (parsed.data.useBiometrics) {
                // Success bypassed via Biometrics
            } else {
                if (!pin) throw new Error('Code PIN requis.');
                const pinMatch = await bcrypt.compare(pin as string, sender.pin);
                if (!pinMatch) {
                    const attempts = sender.failedPinAttempts + 1;
                    const isLocked = attempts >= 3;
                    const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

                    await tx.user.update({
                        where: { id: sender.id },
                        data: { failedPinAttempts: attempts, lockedUntil }
                    });

                    if (isLocked) throw new Error('Compte bloqué (3 échecs). Réessayez dans 15 minutes.');
                    throw new Error(`Code PIN incorrect. Tentative ${attempts}/3.`);
                }

                if (sender.failedPinAttempts > 0) {
                    await tx.user.update({ where: { id: sender.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
                }
            }

            const fee = amount * 0.01; // 1% fee
            const totalRequired = amount + fee;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant. Vous devez avoir au moins ${totalRequired} FCFA (Incluant 1% de frais).`);
            }

            const receiver = await tx.user.findUnique({
                where: { phone: receiverPhone },
                include: { wallet: true },
            });
            if (!receiver || !receiver.wallet) throw new Error("Le destinataire n'existe pas.");
            if (receiver.id === sender.id) throw new Error("Vous ne pouvez pas vous envoyer de l'argent à vous-même.");

            const corporate = await tx.user.findUnique({ where: { phone: '+24100000000' }, include: { wallet: true } });
            if (!corporate || !corporate.wallet) throw new Error("Erreur critique: Compte corporate introuvable.");

            const updatedSenderWallet = await tx.wallet.update({
                where: { id: sender.wallet.id, balance: { gte: totalRequired } },
                data: { balance: { decrement: totalRequired } },
            });

            await tx.wallet.update({
                where: { id: receiver.wallet.id },
                data: { balance: { increment: amount } },
            });

            await tx.wallet.update({
                where: { id: corporate.wallet.id },
                data: { balance: { increment: fee } },
            });

            const transaction = await tx.transaction.create({
                data: {
                    amount, // The user sees they sent X amount to Y
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: receiver.wallet.id,
                    status: 'COMPLETED',
                },
            });

            // We log the fee transaction silently to trace it
            await tx.transaction.create({
                data: {
                    amount: fee,
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: corporate.wallet.id,
                    status: 'COMPLETED',
                    reference: 'FEE-' + transaction.id.substring(0, 8),
                }
            });

            return {
                transaction,
                remainingBalance: updatedSenderWallet.balance,
                receiverName: receiver.name,
                receiverPushToken: (receiver as any).pushToken,
                senderName: sender.name
            };
        });

        // Notify Receiver via Expo Push
        if ((result as any).receiverPushToken) {
            fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: (result as any).receiverPushToken,
                    title: '💰 Transfert reçu !',
                    body: `Vous venez de recevoir ${amount.toLocaleString('fr-FR')} FCFA de la part de ${result.senderName || 'Un utilisateur'}.`,
                    data: { amount },
                    sound: 'default'
                })
            }).catch(e => console.error('Push Error:', e));
        }

        // Notify Receiver via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${receiverPhone}`).emit('payment_received', {
                amount,
                from: result.senderName || 'Un utilisateur'
            });
        }

        return res.json({ message: 'Transfert réussi !', data: result });
    } catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
});

// ─── Retrait Initié par le Client (QR Permanent) ──────────────────────
router.post('/client-initiated-withdraw', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { receiverPhone, amount, pin } = parsed.data;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const sender = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true },
            });

            if (!sender || !sender.wallet) throw new Error('Compte client introuvable.');

            const agent = await tx.user.findUnique({
                where: { phone: receiverPhone },
                include: { wallet: true },
            });
            if (!agent || !agent.wallet) throw new Error("Agent introuvable.");
            if (agent.role !== 'AGENT') throw new Error("Le QR scanné n'est pas celui d'un Agent.");

            if (parsed.data.useBiometrics) {
                // Biometrics bypassed PIN
            } else {
                if (!pin) throw new Error('Code PIN requis.');
                const pinMatch = await bcrypt.compare(pin as string, sender.pin);
                if (!pinMatch) throw new Error(`Code PIN incorrect.`);
            }

            // Withdrawals are free!
            const totalRequired = amount;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant pour retirer ${amount} FCFA.`);
            }

            const updatedSenderWallet = await tx.wallet.update({
                where: { id: sender.wallet.id, balance: { gte: totalRequired } },
                data: { balance: { decrement: totalRequired } },
            });

            await tx.wallet.update({
                where: { id: agent.wallet.id },
                data: { balance: { increment: amount } },
            });

            const transaction = await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: agent.wallet.id,
                    status: 'COMPLETED',
                },
            });

            return {
                transaction,
                remainingBalance: updatedSenderWallet.balance,
                agentName: agent.name,
                agentPhone: agent.phone
            };
        });

        // Notify Agent via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${result.agentPhone}`).emit('payment_received', {
                amount,
                from: 'Client ' + req.userId?.substring(0, 5) // Minimal info
            });
        }

        return res.json({ message: 'Retrait autorisé avec succès !', data: result });
    } catch (error: any) {
        return res.status(400).json({ error: error.message });
    }
});

// ─── Paiement Marchand (Show-To-Pay) ──────────────────────────────────

router.post('/charge', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const merchantId = req.userId;
        const merchant = await prisma.user.findUnique({
            where: { id: merchantId },
            include: { wallet: true }
        });

        if (!merchant) return res.status(404).json({ error: 'Compte encaisseur introuvable.' });

        const { payerPhone, amount, withdrawCode } = chargeSchema.parse(req.body);

        const payer = await prisma.user.findUnique({
            where: { phone: payerPhone },
            include: { wallet: true }
        });

        if (!payer || !payer.wallet) return res.status(404).json({ error: 'Client introuvable' });

        // Valider le profil cryptographique (Evite le Zero Auth)
        const otpRecord = await prisma.verificationCode.findUnique({ where: { phone: payerPhone } });
        if (!otpRecord || otpRecord.expiresAt < new Date()) {
            return res.status(403).json({ error: 'Jeton de transfert invalide ou expiré.' });
        }

        const [savedCode, savedAmountStr] = otpRecord.code.split(':');
        if (savedCode !== withdrawCode || !savedAmountStr) {
            return res.status(403).json({ error: 'Jeton de sécurité incorrect.' });
        }

        const boundAmount = parseFloat(savedAmountStr);
        if (isNaN(boundAmount) || boundAmount <= 0) {
            return res.status(400).json({ error: 'Erreur intégrité jeton. Montant corrompu.' });
        }

        // Fix de sécurité : Le commerçant DOIT facturer exactement ce que le client a signé dans son jeton.
        if (boundAmount !== amount) {
            return res.status(400).json({ error: `La requête indique ${amount} CFA mais le client n'a généré un jeton que pour ${boundAmount} CFA.` });
        }

        // Limite Anti-Blanchiment (KYC Niveau 1)
        if (amount > 500000) {
            return res.status(400).json({ error: 'Limite quotidienne KYC dépassée. Le client ne peut pas payer plus de 500 000 FCFA.' });
        }
        if (payer.wallet.balance < amount) return res.status(400).json({ error: 'Solde insuffisant chez le client' });

        if (payer.id === merchant.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous prélever vous-même' });

        // Transaction atomique
        const transactionResult = await prisma.$transaction(async (tx) => {
            // Débit client avec Contrainte Atomique SQL
            await tx.wallet.update({
                where: { id: payer.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Crédit marchand
            await tx.wallet.update({
                where: { id: merchant.wallet!.id },
                data: { balance: { increment: amount } }
            });

            // Log de la transaction (uniquement une entrée liant les deux portefeuilles)
            const transactionRecord = await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: payer.wallet!.id,
                    receiverWalletId: merchant.wallet!.id,
                    status: 'COMPLETED',
                    reference: 'PAYCODE-' + Math.random().toString(36).substring(7).toUpperCase()
                }
            });

            // Détruire le JWT OTP Token pour empêcher un Replay
            await tx.verificationCode.delete({ where: { phone: payer.phone } });

            return transactionRecord;
        });

        // Notify Merchant via Socket.IO
        // Notify Payer via Push
        if ((payer as any).pushToken) {
            fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: (payer as any).pushToken,
                    title: '🛍️ Paiement Marchand effectué',
                    body: `Vous avez payé ${amount.toLocaleString('fr-FR')} FCFA chez ${merchant.name}.`,
                    data: { amount },
                    sound: 'default'
                })
            }).catch(e => console.error('Push Error:', e));
        }

        // Notify both via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${merchant.phone}`).emit('payment_received', {
                amount,
                from: payerPhone
            });
            io.to(`user_${payerPhone}`).emit('payment_received', {
                amount: -amount,
                from: merchant.name
            });
        }

        res.json({ message: 'Paiement encaissé avec succès', transaction: transactionResult });
    } catch (e: any) {
        console.error('Merchant Charge Error:', e);
        res.status(400).json({ error: e.message || 'Erreur lors de l\'encaissement' });
    }
});

export default router;
