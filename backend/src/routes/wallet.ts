import bcrypt from 'bcryptjs';
import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { TelecomGatewayManager } from '../services/mobileMoney';
import { getSystemSettings } from './settings';

const expo = new Expo();

const CORPORATE_PHONE = process.env.CORPORATE_PHONE || '+2410000000';


export const sendPush = async (token: string | null | undefined, title: string, body: string) => {
    if (token && Expo.isExpoPushToken(token)) {
        try {
            await expo.sendPushNotificationsAsync([{
                to: token,
                sound: 'default',
                title,
                body,
                priority: 'high',
                channelId: 'default'
            }]);
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

const topUpSchema = z.object({
    amount: z.number().positive(),
    cardToken: z.string().optional()
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


// ─── Vérification atomique du plafond journalier ───────────────────────────
async function verifyAndIncrementDailyLimit(
    walletId: string,
    userId: string,
    requestedAmount: number,
    settings: any
): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Compte introuvable');
    if (user.role !== 'USER') return; // Agents/Admins exemptés

    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new Error('Portefeuille introuvable');

    // Remettre à zéro si le dernier reset date d'un jour précédent
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (wallet.dailySpentResetAt < todayStart) {
        await prisma.wallet.update({ where: { id: walletId }, data: { dailySpent: 0, dailySpentResetAt: new Date() } });
        wallet.dailySpent = 0;
    }

    const limit = (user as any).kycLevel >= 1 ? settings.dailyLimitTier1 : settings.dailyLimitTier0;
    const newSpent = wallet.dailySpent + requestedAmount;

    if (newSpent > limit) {
        throw new Error(`Plafond journalier dépassé (Limite: ${limit} FCFA). Déjà utilisé : ${wallet.dailySpent} FCFA. Vérifiez votre compte KYC.`);
    }

    // Incrémenter atomiquement avant la transaction financière
    await prisma.wallet.update({ where: { id: walletId }, data: { dailySpent: { increment: requestedAmount } } });
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

        // Vérification du plafond journalier KYC (atomique)
        await verifyAndIncrementDailyLimit(sender.wallet!.id, sender.id, totalDebit, settings);

        // Compte Corporate
        const corporate = await prisma.user.findUnique({
            where: { phone: CORPORATE_PHONE },
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



// POST /api/wallet/request-withdraw (Agent Pushes Request to Client)
router.post('/request-withdraw', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const agentId = req.userId;
        const { targetPhone, amount } = req.body;

        if (!targetPhone || !amount || amount <= 0) {
            return res.status(400).json({ error: 'Numéro du client et montant valides obligatoires.' });
        }

        let cleanedPhone = targetPhone.replace(/\s/g, '');
        if (!cleanedPhone.startsWith('+')) cleanedPhone = '+241' + (cleanedPhone.startsWith('0') ? cleanedPhone.substring(1) : cleanedPhone);

        const agent = await prisma.user.findUnique({
            where: { id: agentId }
        });

        if (!agent || agent.role !== 'AGENT') return res.status(403).json({ error: 'Autorisation refusée. Réservé aux Agents Mongain.' });

        const client = await prisma.user.findUnique({
            where: { phone: cleanedPhone }
        });

        if (!client) return res.status(404).json({ error: 'Ce client est introuvable sur le réseau Mongain.' });

        // Emit Socket.IO Event directly to the user's room
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${client.phone}`).emit('withdraw_request', {
                agentPhone: agent.phone,
                agentName: agent.name,
                amount: amount
            });
        }

        // Send Push Notification
        if ((client as any).pushToken) {
            try {
                sendPush(
                    (client as any).pushToken,
                    "Demande de Retrait ⚠️",
                    `L'Agence ${agent.name} demande un retrait de ${amount.toLocaleString('fr-FR')} FCFA. Ouvrez Mongain pour valider avec votre empreinte.`
                );
            } catch (err) {
                console.error("Push Error", err);
            }
        }

        return res.json({ success: true, message: 'Demande envoyée au client pour validation biométrique.' });
    } catch (error: any) {
        console.error('Request Withdraw Error:', error);
        return res.status(500).json({ error: 'Erreur lors de la demande de retrait.' });
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

            const settings = await tx.systemSettings.findFirst() || { taxP2P: 0.01, taxWithdraw: 0.013, rewardMerchant: 0.003, agencyWithdrawThreshold: 500000, agencyTaxWithdraw: 0.01 };
            const fee = amount * settings.taxP2P;
            const totalRequired = amount + fee;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant. Vous devez avoir au moins ${totalRequired} FCFA (Incluant ${settings.taxP2P * 100}% de frais).`);
            }

            const receiver = await tx.user.findUnique({
                where: { phone: receiverPhone },
                include: { wallet: true },
            });
            if (!receiver || !receiver.wallet) throw new Error("Le destinataire n'existe pas.");
            if (receiver.id === sender.id) throw new Error("Vous ne pouvez pas vous envoyer de l'argent à vous-même.");

            const corporate = await tx.user.findUnique({ where: { phone: CORPORATE_PHONE }, include: { wallet: true } });

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
            if (agent.role !== 'AGENT' && agent.role !== 'MERCHANT') throw new Error("Opération impossible. Ce QR n'appartient ni à un Agent ni à un Commerçant.");

            if (parsed.data.useBiometrics) {
                // Biometrics bypassed PIN
            } else {
                if (!pin) throw new Error('Code PIN requis.');
                const pinMatch = await bcrypt.compare(pin as string, sender.pin);
                if (!pinMatch) throw new Error(`Code PIN incorrect.`);
            }

            const settings = await tx.systemSettings.findFirst() || { taxP2P: 0.01, taxWithdraw: 0.013, rewardMerchant: 0.003, agencyWithdrawThreshold: 500000, agencyTaxWithdraw: 0.01 };

            let fee = 0;
            let merchantReward = 0;

            if (agent.role === 'MERCHANT') {
                fee = amount * settings.taxWithdraw;
                merchantReward = amount * settings.rewardMerchant;
            } else if (agent.role === 'AGENT') {
                if (amount > settings.agencyWithdrawThreshold) {
                    fee = (amount - settings.agencyWithdrawThreshold) * settings.agencyTaxWithdraw;
                }
            }

            const totalRequired = amount + fee;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant pour couvrir le retrait et les frais de ${fee} FCFA.`);
            }

            const corporate = await tx.user.findUnique({ where: { phone: '+2410000000' }, include: { wallet: true } }); // CORPORATE_PHONE normalized

            if (!corporate || !corporate.wallet) throw new Error("Erreur critique: Compte central introuvable.");

            const updatedSenderWallet = await tx.wallet.update({
                where: { id: sender.wallet.id, balance: { gte: totalRequired } },
                data: { balance: { decrement: totalRequired } },
            });

            await tx.wallet.update({
                where: { id: agent.wallet.id },
                data: { balance: { increment: amount + merchantReward } },
            });

            const corporateCut = fee - merchantReward;
            if (corporateCut > 0) {
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: corporateCut } },
                });
            }

            const transaction = await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: agent.wallet.id,
                    status: 'COMPLETED',
                },
            });

            if (fee > 0) {
                await tx.transaction.create({
                    data: {
                        amount: fee,
                        senderWalletId: sender.wallet.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: 'FEE-W-' + transaction.id.substring(0, 8),
                    }
                });
            }

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

// -- RECHARGE DEPUIS EXTERNE (AIRTEL / MOOV / BANQUE) --
const rechargeSchema = z.object({
    method: z.enum(['AIRTEL', 'MOOV', 'BANK']),
    identifier: z.string().min(5),
    amount: z.number().int('Pas de centimes.').positive('Montant invalide.')
});

router.post('/recharge', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = rechargeSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });

        const { method, identifier, amount } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        // Compte système "Passerelle de Paiement" (Aggregator) pour simuler l'entrée d'argent externe
        const gatewayPhone = '+24133333333';
        let gateway = await prisma.user.findUnique({ where: { phone: gatewayPhone }, include: { wallet: true } });
        if (!gateway) {
            gateway = await prisma.user.create({
                data: {
                    phone: gatewayPhone,
                    name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)',
                    role: 'ADMIN',
                    pin: await bcrypt.hash('0000', 10),
                    wallet: { create: { balance: 999999999, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }

        // Simuler le délai d'une API Bancaire/Mobile Money réelle (ex: chargement OTP, 3D Secure)
        await new Promise(r => setTimeout(r, 1500));

        const ref = `RECHARGE-${method}-${Math.random().toString(36).substring(7).toUpperCase()}`;

        await prisma.$transaction(async (tx) => {
            // "Prendre" l'argent du monde virtuel externe
            await tx.wallet.update({
                where: { id: gateway!.wallet!.id },
                data: { balance: { decrement: amount } }
            });

            // Créditer le client Mongain
            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: gateway!.wallet!.id,
                    receiverWalletId: user.wallet!.id,
                    status: 'COMPLETED',
                    reference: ref
                }
            });
        });

        // Alerte push
        sendPush(user.pushToken, 'Rechargement Réussi 💰', `Votre compte a été crédité de ${amount.toLocaleString()} FCFA via ${method}.`);

        res.json({ message: 'Rechargement réussi.', balance: user.wallet.balance + amount });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/wallet/topup (Rechargement par Carte Bancaire Client)
router.post('/topup', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = topUpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { amount } = parsed.data;

    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') throw new Error('Seuls les clients peuvent utiliser ce service de Top-Up.');
        if (!user.wallet) throw new Error('Wallet introuvable.');

        const newBalance = await prisma.$transaction(async (tx) => {
            const w = await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    receiverWalletId: w.id,
                    status: 'COMPLETED',
                    reference: 'TOPUP-CB-' + Math.random().toString(36).substring(7).toUpperCase(),
                }
            });

            // Sauvegarder la notif in-app
            await (tx as any).notification.create({
                data: {
                    userId: user.id,
                    title: 'Rechargement CB',
                    body: `Votre compte a été rechargé de ${amount.toLocaleString('fr-FR')} FCFA via Carte Bancaire.`,
                    type: 'TRANSACTION'
                }
            });

            return w.balance;
        });

        // Trigger socket IO if needed, but the user is the one initiating it.
        return res.json({
            message: 'Rechargement réussi.',
            balance: newBalance
        });
    } catch (e: any) {
        return res.status(400).json({ error: e.message || 'Erreur lors du rechargement.' });
    }
});

// POST /api/wallet/pay-service (Achat Électricité, etc.)
router.post('/pay-service', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { type, amount, reference } = req.body;
        if (!amount || amount <= 0) throw new Error('Montant invalide');

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') throw new Error('Seuls les clients peuvent utiliser ce service.');
        if (!user.wallet || user.wallet.balance < amount) throw new Error('Solde insuffisant pour ce paiement.');

        const reserve = await prisma.user.findUnique({ where: { phone: '+24199999999' }, include: { wallet: true } });
        if (!reserve || !reserve.wallet) throw new Error('Le service est temporairement indisponible (compte central manquant).');

        let serviceToken = '';
        if (type === 'ELECTRICITY') {
            throw new Error("L'intégration SEEG/EDAN est en cours de finalisation. Les achats d'électricité sont suspendus pour la Bêta.");
        }

        const newBalance = await prisma.$transaction(async (tx) => {
            const w = await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { decrement: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: w.id, // Débit
                    receiverWalletId: reserve!.wallet!.id, // Crédit à la plateforme centrale
                    status: 'COMPLETED',
                    reference: `SERVICE-${type}-${Math.random().toString(36).substring(7).toUpperCase()}`,
                }
            });

            await (tx as any).notification.create({
                data: {
                    userId: user.id,
                    title: `Achat de Service : ${type}`,
                    body: `Débit de ${amount.toLocaleString('fr-FR')} FCFA. Référence: ${reference}.`,
                    type: 'SYSTEM'
                }
            });

            return w.balance;
        });

        return res.json({
            message: 'Achat effectué avec succès.',
            balance: newBalance,
            serviceToken
        });
    } catch (e: any) {
        return res.status(400).json({ error: e.message || 'Erreur lors de l\'achat du service.' });
    }
});

// POST /api/wallet/pull (Dépot Mobile Money)
router.post('/pull', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { phone, amount, network } = req.body;
        if (!amount || amount < 500) throw new Error('Montant minimum : 500 FCFA');

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) throw new Error('Compte expéditeur introuvable');

        // Initialisation universelle de la Telecom Gateway
        const gateway = TelecomGatewayManager.getProvider(phone, network);

        // Déclenche l'appel USSD PULL
        const response = await gateway.initiateDeposit(phone, amount);

        // Historiser de la transaction (Statut: PENDING en attente de Callback Telco)
        await prisma.transaction.create({
            data: {
                amount,
                receiverWalletId: user.wallet.id,
                status: response.status as any,
                reference: response.reference,
            }
        });

        return res.json({
            message: response.message,
            reference: response.reference,
            network: gateway.name
        });
    } catch (e: any) {
        return res.status(400).json({ error: e.message || 'Erreur lors de la requête de dépôt réseau.' });
    }
});

export default router;
