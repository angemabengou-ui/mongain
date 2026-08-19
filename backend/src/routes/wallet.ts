import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { TelecomGatewayManager } from '../services/mobileMoney';
import { friendlyErrorMessage } from '../utils/errors';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const expo = new Expo();

const CORPORATE_PHONE = process.env.CORPORATE_PHONE || '+2410000000';

// Compte de revenus (frais de transactions) — distinct du compte Réserve/Voûte
// (+24199999999, géré par la Trésorerie) qui ne doit contenir que la monnaie qui adosse
// les soldes clients. Auto-guérison (même principe que treasury.ts pour la Réserve) : si le
// compte n'existe pas encore en base, tout prélèvement de frais échouait silencieusement en
// erreur 500 ("Compte corporate introuvable"), ce qui pouvait bloquer tous les transferts P2P.
async function getOrCreateCorporateWallet(tx: any) {
    let corporate = await tx.user.findUnique({ where: { phone: CORPORATE_PHONE }, include: { wallet: true } });
    if (!corporate || !corporate.wallet) {
        corporate = await tx.user.create({
            data: {
                phone: CORPORATE_PHONE,
                name: 'COMPTE CORPORATE (REVENUS)',
                role: 'ADMIN',
                pin: crypto.randomBytes(16).toString('hex'), // PIN non connaissable
                wallet: { create: { balance: 0 } }
            },
            include: { wallet: true }
        });
    }
    return corporate;
}


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
    // Le code PIN est toujours requis et vérifié côté serveur — voir src/services/biometrics.ts
    // côté client, où le déverrouillage biométrique ne fait que révéler le vrai PIN stocké
    // localement (SecureStore protégé), plutôt que de contourner la vérification serveur.
    pin: z.string().length(4),
});

const depositSchema = z.object({
    phone: z.string(),
    amount: z.number().int('Les décimales sont interdites pour le FCFA.').positive('Le montant doit être positif.'),
});

const topUpSchema = z.object({
    amount: z.number().positive(),
    cardToken: z.string().optional()
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

        const code = crypto.randomInt(100000, 1000000).toString(); // 6 digits
        const dbCode = `${code}:${amount}`;
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        await prisma.verificationCode.upsert({
            where: { phone_purpose: { phone: user.phone, purpose: 'WITHDRAW_CODE' } },
            update: { code: dbCode, expiresAt },
            create: { phone: user.phone, purpose: 'WITHDRAW_CODE', code: dbCode, expiresAt }
        });

        return res.json({ code, expiresAt });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur génération code' });
    }
});

// GET /history (Pour l'historique des agents et clients)
router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Wallet missing' });

        const txs = await prisma.transaction.findMany({
            where: {
                OR: [
                    { senderWalletId: user.wallet.id },
                    { receiverWalletId: user.wallet.id }
                ]
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                senderWallet: { include: { user: { select: { phone: true, name: true } }, branch: { select: { name: true, code: true } } } },
                receiverWallet: { include: { user: { select: { phone: true, name: true } }, branch: { select: { name: true, code: true } } } },
            }
        });

        res.json(txs);
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur History' });
    }
});

// POST /api/wallet/qr-cash-out
const qrCashOutSchema = z.object({
    branchCode: z.string(),
    amount: z.number().int().positive(),
    pin: z.string().length(4)
});

router.post('/qr-cash-out', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = qrCashOutSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { branchCode, amount, pin } = parsed.data;

        const client = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!client || !client.wallet) return res.status(404).json({ error: 'Client introuvable.' });

        const isPinValid = await bcrypt.compare(pin, client.pin);
        if (!isPinValid) return res.status(401).json({ error: 'Code PIN incorrect.' });

        const branch = await prisma.branch.findUnique({ where: { code: branchCode }, include: { wallet: true, sessions: { where: { status: 'OPEN' } } } });

        if (!branch || !branch.wallet) return res.status(404).json({ error: 'Agence ou Guichet système introuvable.' });
        if (branch.status !== 'ACTIVE') return res.status(400).json({ error: 'Cette agence est momentanément indisponible.' });

        if (branch.sessions.length === 0) return res.status(400).json({ error: 'Aucun caissier n\'est en ligne pour autoriser ce guichet physiquement.' });
        const activeSession = branch.sessions[0];

        if (branch.balance < amount) return res.status(400).json({ error: 'Liquidité de caisse insuffisante actuellement pour la remise.' });

        // Frais Centralisés (TODO: Enrober dans LimitEngine anti-fractionnement)
        const settings = await prisma.systemSettings.findFirst();
        let feeAmount = 0;
        if (settings && amount > settings.agencyWithdrawThreshold) {
            feeAmount = amount * settings.agencyTaxWithdraw;
        }

        const totalDebit = amount + feeAmount;
        if (client.wallet.balance < totalDebit) return res.status(400).json({ error: 'Solde insuffisant pour ce retrait (incluant les frais de réseau).' });

        // Transaction Ledger 100% Atomique — gardes atomiques (balance: gte) sur les deux
        // décréments : les contrôles ci-dessus (client.wallet.balance, branch.balance) lisent
        // une valeur non verrouillée, donc deux retraits QR simultanés du même client ou sur
        // la même agence pouvaient tous deux passer le contrôle et faire passer le solde en
        // négatif (même classe de bug que celle corrigée dans CashOperationService).
        await prisma.$transaction(async (tx) => {
            // Plafond Anti-Blanchiment : même contrôle que /transfer et /pay-bill (services.ts)
            // — sans ça, un client Tier 0 pouvait contourner sa limite journalière/mensuelle
            // en retirant via QR guichet plutôt que par un transfert P2P classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, client.id, client.wallet!.id, amount, settings);

            await tx.wallet.update({ where: { id: client.wallet!.id, balance: { gte: totalDebit } }, data: { balance: { decrement: totalDebit } } });
            await tx.wallet.update({ where: { id: branch.wallet!.id }, data: { balance: { increment: amount } } });

            if (feeAmount > 0) {
                // Frais réseau = revenu plateforme, pas de la monnaie qui adosse les soldes
                // clients : va au compte Corporate (comme les frais P2P), pas à la Réserve.
                const corporate = await getOrCreateCorporateWallet(tx);
                await tx.wallet.update({ where: { id: corporate.wallet.id }, data: { balance: { increment: feeAmount } } });
            }

            await tx.transaction.create({
                data: { senderWalletId: client.wallet!.id, receiverWalletId: branch.wallet!.id, amount: amount, status: 'COMPLETED', reference: generateReference('QROUT') }
            });

            await tx.branch.update({ where: { id: branch.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
            await tx.cashSession.update({ where: { id: activeSession.id }, data: { totalCashOutValue: { increment: amount } } });
        });

        // Notifications au Front
        await prisma.notification.createMany({
            data: [
                { userId: client.id, title: 'Retrait Guichet Validé', body: `Votre retrait de ${amount} FCFA en agence (${branch.name}) a été traité avec succès.` }
            ]
        });

        res.json({ success: true, message: 'Transfert au guichet autorisé !' });

    } catch (e: any) { res.status(500).json({ error: 'Erreur validation QR Cash-Out' }); }
});

// ─── Vérification atomique du plafond journalier ───────────────────────────
import { LimitEngine, MAXIMUM_ALLOWED_LIMIT } from '../services/LimitEngine';

// NOTE: L'ancienne fonction a été supprimée au profit du moteur centralisé LimitEngine
// pour éviter la dette technique et la duplication de code P2P/Withdrawal.


// GET /api/wallet/limits
router.get('/limits', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') return res.json({ skip: true });

        const settings = await getSystemSettings();

        // Appelle le moteur global pour un affichage cohérent sur le Front B2C
        const limits = await LimitEngine.getApplicableLimits(user, settings);

        res.json({
            dailySpend: user.wallet?.dailySpent || 0,
            monthlySpend: (user.wallet as any)?.monthlySpent || 0,
            dailyLimit: limits.effectiveDaily,
            monthlyLimit: limits.effectiveMonthly,
            perTxLimit: limits.effectivePerTx,
            kycStatus: (user as any).kycStatus,
            kycLevel: (user as any).kycLevel,
            isCustomActive: limits.isCustomActive
        });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur limit engine.' });
    }
});

// GET /api/wallet/balance
router.get('/balance', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId } });
        if (!wallet) return res.status(404).json({ error: 'Portefeuille introuvable.' });
        return res.json({ balance: wallet.balance, currency: wallet.currency });
    } catch (e: any) {
        console.error('Erreur /wallet/balance:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/wallet/transactions
router.get('/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
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
                counterpart: isIncoming ? (tx.senderWallet?.user?.name || 'Agence / Banque Centrale') : (tx.receiverWallet?.user?.name || 'Agence / Banque Centrale'),
                counterpartPhone: isIncoming ? (tx.senderWallet?.user?.phone || 'SYSTEM') : (tx.receiverWallet?.user?.phone || 'SYSTEM'),
                createdAt: tx.createdAt,
            };
        });

        return res.json(formatted);
    } catch (e: any) {
        console.error('Erreur /wallet/transactions:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/wallet/lookup/:phone — Trouver un destinataire par numéro avant transfert
router.get('/lookup/:phone', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const phone = decodeURIComponent(req.params.phone as string);

        const user = await prisma.user.findUnique({
            where: { phone },
            select: { id: true, name: true, phone: true, role: true },
        });

        if (!user) return res.status(404).json({ error: 'Aucun compte trouvé pour ce numéro.' });
        if (user.id === req.userId) return res.status(400).json({ error: "Vous ne pouvez pas vous envoyer de l'argent." });

        return res.json({ id: user.id, name: user.name, phone: user.phone, role: user.role });
    } catch (e: any) {
        console.error('Erreur /wallet/lookup:', e);
        return res.status(500).json({ error: friendlyErrorMessage(e) });
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
        // Vérification du PIN et gestion des tentatives échouées EN DEHORS de la
        // transaction financière ci-dessous : un `throw` dans un `$transaction`
        // interactif Prisma annule TOUTES ses écritures, y compris celle qui
        // enregistre la tentative échouée — ce qui rendait le verrouillage après
        // 3 échecs totalement inopérant.
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) return res.status(400).json({ error: 'Compte expéditeur introuvable.' });

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            return res.status(400).json({ error: 'Votre compte est temporairement bloqué suite à plusieurs échecs. Réessayez plus tard.' });
        }

        const pinMatch = await bcrypt.compare(pin, senderPreCheck.pin);
        if (!pinMatch) {
            const attempts = senderPreCheck.failedPinAttempts + 1;
            const isLocked = attempts >= 3;
            const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

            await prisma.user.update({
                where: { id: senderPreCheck.id },
                data: { failedPinAttempts: attempts, lockedUntil }
            });

            if (isLocked) return res.status(400).json({ error: 'Compte bloqué (3 échecs). Réessayez dans 15 minutes.' });
            return res.status(400).json({ error: `Code PIN incorrect. Tentative ${attempts}/3.` });
        }

        if (senderPreCheck.failedPinAttempts > 0) {
            await prisma.user.update({ where: { id: senderPreCheck.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
        }

        const result = await prisma.$transaction(async (tx) => {
            const sender = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true },
            });

            if (!sender || !sender.wallet) throw new Error('Compte expéditeur introuvable.');

            // La limite Anti-Blanchiment est maintenant intégralement calculée via le moteur.
            // On vérifie de façon unifiée Daily, Monthly et Per_Tx
            const settings = await tx.systemSettings.findFirst() || { taxP2P: 0.01, taxWithdraw: 0.013, rewardMerchant: 0.003, agencyWithdrawThreshold: 500000, agencyTaxWithdraw: 0.01 };
            await LimitEngine.verifyAndIncrementConsumption(tx, sender.id, sender.wallet.id, amount, settings);

            // Un Agent qui crédite un client via cet endpoint effectue un dépôt guichet
            // (agent-action.tsx : « transfert gratuit d'un Agent vers Client »), pas un
            // transfert P2P classique entre deux clients — sans cette exemption, l'agent
            // payait de sa poche 1% de frais sur chaque dépôt qu'il traitait, sans jamais
            // en être informé (aucun aperçu de frais dans cet écran), l'UI le présentant
            // comme gratuit alors que le serveur le facturait quand même.
            const fee = sender.role === 'AGENT' ? 0 : amount * settings.taxP2P;
            const totalRequired = amount + fee;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant. Vous devez avoir au moins ${totalRequired} FCFA (Incluant ${settings.taxP2P * 100}% de frais).`);
            }

            const receiver = await tx.user.findFirst({
                where: {
                    OR: [
                        { phone: receiverPhone },
                        { accountNumber: receiverPhone }
                    ]
                },
                include: { wallet: true },
            });
            if (!receiver || !receiver.wallet) throw new Error("Le destinataire n'existe pas.");
            if (receiver.id === sender.id) throw new Error("Vous ne pouvez pas vous envoyer de l'argent à vous-même.");

            const corporate = await getOrCreateCorporateWallet(tx);

            const updatedSenderWallet = await tx.wallet.update({
                where: { id: sender.wallet.id, balance: { gte: totalRequired } },
                data: { balance: { decrement: totalRequired } },
            });

            await tx.wallet.update({
                where: { id: receiver.wallet.id },
                data: { balance: { increment: amount } },
            });

            if (fee > 0) {
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: fee } },
                });
            }

            const transaction = await tx.transaction.create({
                data: {
                    amount, // The user sees they sent X amount to Y
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: receiver.wallet.id,
                    status: 'COMPLETED',
                    // Si l'expéditeur est un Agent rattaché à une agence (ex: agent-action.tsx,
                    // dépôt guichet), l'opération doit compter dans les rapports de cette
                    // agence — sans ce champ, ces dépôts étaient invisibles du réseau
                    // d'agences alors qu'ils passent par un agent Mongain identifié.
                    branchId: sender.role === 'AGENT' ? (sender as any).branchId : undefined,
                    tellerId: sender.role === 'AGENT' ? sender.id : undefined,
                },
            });

            // We log the fee transaction silently to trace it
            if (fee > 0) {
                await tx.transaction.create({
                    data: {
                        amount: fee,
                        senderWalletId: sender.wallet.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: 'FEE-' + transaction.id.substring(0, 8),
                    }
                });
            }

            // Persistées en base pour les deux parties — le push/socket ci-dessous est un
            // best-effort en temps réel (échoue silencieusement sans token/connexion), mais
            // sans cette écriture ni l'expéditeur ni le destinataire ne voyaient JAMAIS
            // l'opération dans l'onglet Notifications de l'app.
            await tx.notification.create({
                data: { userId: sender.id, title: 'Transfert envoyé', body: `Vous avez envoyé ${amount.toLocaleString('fr-FR')} FCFA à ${receiver.name}.`, type: 'TRANSACTION' }
            });
            await tx.notification.create({
                data: { userId: receiver.id, title: '💰 Transfert reçu', body: `Vous avez reçu ${amount.toLocaleString('fr-FR')} FCFA de la part de ${sender.name}.`, type: 'TRANSACTION' }
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
        return res.status(400).json({ error: friendlyErrorMessage(error) });
    }
});

// ─── Retrait Initié par le Client (QR Permanent) ──────────────────────
router.post('/client-initiated-withdraw', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { receiverPhone, amount, pin } = parsed.data;

    try {
        // Même raisonnement que /transfer : la vérification du PIN et la gestion des
        // tentatives échouées doivent rester en dehors de la transaction financière,
        // sous peine d'être annulées par le rollback en cas d'échec.
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) return res.status(400).json({ error: 'Compte client introuvable.' });

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            return res.status(400).json({ error: 'Votre compte est temporairement bloqué suite à plusieurs échecs. Réessayez plus tard.' });
        }

        const pinMatchPreCheck = await bcrypt.compare(pin, senderPreCheck.pin);
        if (!pinMatchPreCheck) {
            const attempts = senderPreCheck.failedPinAttempts + 1;
            const isLocked = attempts >= 3;
            const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

            await prisma.user.update({
                where: { id: senderPreCheck.id },
                data: { failedPinAttempts: attempts, lockedUntil }
            });

            if (isLocked) return res.status(400).json({ error: 'Compte bloqué (3 échecs). Réessayez dans 15 minutes.' });
            return res.status(400).json({ error: `Code PIN incorrect. Tentative ${attempts}/3.` });
        }

        if (senderPreCheck.failedPinAttempts > 0) {
            await prisma.user.update({ where: { id: senderPreCheck.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
        }

        const result = await prisma.$transaction(async (tx) => {
            const sender = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true },
            });

            if (!sender || !sender.wallet) throw new Error('Compte client introuvable.');

            const agent = await tx.user.findFirst({
                where: {
                    OR: [
                        { phone: receiverPhone },
                        { accountNumber: receiverPhone }
                    ]
                },
                include: { wallet: true },
            });
            if (!agent || !agent.wallet) throw new Error("Agent introuvable.");
            if (agent.role !== 'AGENT' && agent.role !== 'MERCHANT') throw new Error("Opération impossible. Ce QR n'appartient ni à un Agent ni à un Commerçant.");

            const settings = await tx.systemSettings.findFirst() || { taxP2P: 0.01, taxWithdraw: 0.013, rewardMerchant: 0.003, agencyWithdrawThreshold: 500000, agencyTaxWithdraw: 0.01 };

            // Plafond Anti-Blanchiment : même contrôle que /transfer et /pay-bill (services.ts)
            // — sans ça, un client Tier 0 pouvait contourner sa limite journalière/mensuelle en
            // retirant via QR agent/marchand plutôt que par un transfert P2P classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, sender.id, sender.wallet.id, amount, settings);

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

            const corporate = await getOrCreateCorporateWallet(tx);

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
                    // Idem /transfer : si l'agent qui reçoit ce retrait guichet est rattaché
                    // à une agence, l'opération doit apparaître dans les rapports de celle-ci.
                    branchId: agent.role === 'AGENT' ? (agent as any).branchId : undefined,
                    tellerId: agent.role === 'AGENT' ? agent.id : undefined,
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

            // Enregistrement de la commission marchand — le crédit lui-même a déjà eu lieu
            // ci-dessus (agent.wallet incrémenté de `amount + merchantReward` en une seule
            // opération, corporate n'ayant reçu que le net `corporateCut`), donc cette ligne
            // ne déplace aucun fonds : elle rend juste la commission traçable et sommable
            // dans le relevé du marchand, qui ne pouvait jusqu'ici jamais la distinguer de la
            // vente elle-même.
            if (merchantReward > 0) {
                await tx.transaction.create({
                    data: {
                        amount: merchantReward,
                        senderWalletId: corporate.wallet.id,
                        receiverWalletId: agent.wallet.id,
                        status: 'COMPLETED',
                        reference: 'REWARD-' + transaction.id.substring(0, 8),
                    }
                });
            }

            // Même correctif que /transfer : le client n'avait jusqu'ici aucune trace de ce
            // retrait dans son onglet Notifications, seulement le reçu affiché une fois à
            // l'écran juste après l'opération.
            await tx.notification.create({
                data: { userId: sender.id, title: 'Retrait effectué', body: `Vous avez retiré ${amount.toLocaleString('fr-FR')} FCFA chez ${agent.name}.`, type: 'TRANSACTION' }
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
        return res.status(400).json({ error: friendlyErrorMessage(error) });
    }
});

// -- RECHARGE DEPUIS EXTERNE (AIRTEL / MOOV / BANQUE) --
const rechargeSchema = z.object({
    method: z.enum(['AIRTEL', 'MOOV', 'BANK']),
    identifier: z.string().min(5),
    amount: z.number().int('Pas de centimes.').positive('Montant invalide.')
});

// ⚠️ Comme /topup : `identifier` n'est jamais vérifié auprès d'un opérateur réel.
// Désactivé par défaut hors intégration réelle avec Airtel/Moov/une banque.
router.post('/recharge', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CARD_TOPUP !== 'true') {
        return res.status(501).json({
            error: 'Le rechargement externe nécessite une intégration avec un opérateur réel (Airtel/Moov/banque). Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }

    try {
        const parsed = rechargeSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });

        const { method, identifier, amount } = parsed.data;
        if (amount > MAXIMUM_ALLOWED_LIMIT) {
            return res.status(400).json({ error: `Montant plafonné à ${MAXIMUM_ALLOWED_LIMIT.toLocaleString('fr-FR')} FCFA par opération.` });
        }

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
                    pin: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
                    wallet: { create: { balance: 999999999, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }
        if (!gateway.wallet) return res.status(500).json({ error: 'Compte passerelle introuvable.' });

        // Simuler le délai d'une API Bancaire/Mobile Money réelle (ex: chargement OTP, 3D Secure)
        await new Promise(r => setTimeout(r, 1500));

        const ref = generateReference(`RECHARGE-${method}`);

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
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/wallet/topup (Rechargement par Carte Bancaire Client)
//
// ⚠️ Aucune passerelle de paiement réelle n'est intégrée : `cardToken` n'est
// jamais vérifié. Historiquement cette route créditait le wallet du client
// sans aucune contrepartie débitée ailleurs — un simple appel authentifié
// suffisait à créer de la monnaie électronique à partir de rien. Désormais :
//   1. La route est désactivée par défaut (401/501) en production tant
//      qu'aucune vraie intégration PSP (Stripe/CinetPay/etc.) n'est branchée.
//   2. Quand explicitement activée (démo/staging), le crédit provient d'un
//      compte "passerelle" pré-approvisionné (même schéma que /recharge),
//      pour conserver une écriture comptable à double entrée.
router.post('/topup', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CARD_TOPUP !== 'true') {
        return res.status(501).json({
            error: 'Le rechargement par carte bancaire nécessite une intégration avec un prestataire de paiement réel. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }

    const parsed = topUpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { amount } = parsed.data;
    if (amount > MAXIMUM_ALLOWED_LIMIT) {
        return res.status(400).json({ error: `Montant plafonné à ${MAXIMUM_ALLOWED_LIMIT.toLocaleString('fr-FR')} FCFA par opération.` });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') throw new Error('Seuls les clients peuvent utiliser ce service de Top-Up.');
        if (!user.wallet) throw new Error('Wallet introuvable.');

        // Compte passerelle simulé (même mécanisme que /recharge) : le crédit
        // client a toujours une contrepartie débitée, jamais créé "from thin air".
        const gatewayPhone = '+24133333333';
        let gateway = await prisma.user.findUnique({ where: { phone: gatewayPhone }, include: { wallet: true } });
        if (!gateway) {
            gateway = await prisma.user.create({
                data: {
                    phone: gatewayPhone,
                    name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)',
                    role: 'ADMIN',
                    pin: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
                    wallet: { create: { balance: 999999999, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }
        if (!gateway.wallet) throw new Error('Compte passerelle introuvable.');

        const newBalance = await prisma.$transaction(async (tx) => {
            await tx.wallet.update({
                where: { id: gateway!.wallet!.id },
                data: { balance: { decrement: amount } }
            });

            const w = await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: gateway!.wallet!.id,
                    receiverWalletId: w.id,
                    status: 'COMPLETED',
                    reference: generateReference('TOPUP-CB'),
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
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors du rechargement.') });
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

        // Le Siège est la Réserve Centrale — plus un compte User abstrait séparé.
        const reserve = await prisma.branch.findFirst({ where: { isHQ: true }, include: { wallet: true } });
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
                    reference: generateReference(`SERVICE-${type}`),
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
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors de l\'achat du service.') });
    }
});

// POST /api/wallet/pull (Dépot Mobile Money)
//
// ⚠️ Comme /recharge et /topup : TelecomGatewayManager (mobileMoney.ts) ne fait qu'un
// SIMULACRE d'appel Airtel/Moov — aucune vraie intégration USSD PULL n'existe, et surtout
// aucun endpoint webhook/callback telco n'existe nulle part dans le backend pour faire
// passer la transaction PENDING créée ci-dessous à COMPLETED et créditer le wallet. Avant
// ce garde-fou, le client voyait "Appel USSD déclenché" puis n'était JAMAIS crédité — un
// dépôt qui disparaît silencieusement dans une transaction PENDING permanente. Désactivé
// par défaut (même flag que /recharge et /topup) tant qu'une vraie intégration + callback
// telco ne sont pas branchés.
router.post('/pull', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CARD_TOPUP !== 'true') {
        return res.status(501).json({
            error: 'Le dépôt Mobile Money nécessite une intégration réelle avec Airtel/Moov (y compris le webhook de confirmation). Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }

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
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors de la requête de dépôt réseau.') });
    }
});

export default router;
