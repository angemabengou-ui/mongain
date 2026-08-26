import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { getOrCreateMerchantCommissionWallet } from '../services/merchantService';
import { initiatePvitPayment, initiatePvitTransfer, isPvitConfigured, toPvitCustomerAccountNumber } from '../services/pvit';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const expo = new Expo();

const CORPORATE_PHONE = process.env.CORPORATE_PHONE || '+2410000000';

// Compte de revenus (frais de transactions) â€” distinct du compte RÃ©serve/VoÃ»te
// (+24199999999, gÃ©rÃ© par la TrÃ©sorerie) qui ne doit contenir que la monnaie qui adosse
// les soldes clients. Auto-guÃ©rison (mÃªme principe que treasury.ts pour la RÃ©serve) : si le
// compte n'existe pas encore en base, tout prÃ©lÃ¨vement de frais Ã©chouait silencieusement en
// erreur 500 ("Compte corporate introuvable"), ce qui pouvait bloquer tous les transferts P2P.
export async function getOrCreateCorporateWallet(tx: any) {
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
    amount: z.number().int('Les dÃ©cimales sont interdites pour le FCFA.').positive('Le montant doit Ãªtre positif.'),
    // Le code PIN est toujours requis et vÃ©rifiÃ© cÃ´tÃ© serveur â€” voir src/services/biometrics.ts
    // cÃ´tÃ© client, oÃ¹ le dÃ©verrouillage biomÃ©trique ne fait que rÃ©vÃ©ler le vrai PIN stockÃ©
    // localement (SecureStore protÃ©gÃ©), plutÃ´t que de contourner la vÃ©rification serveur.
    pin: z.string().length(4),
});

const depositSchema = z.object({
    phone: z.string(),
    amount: z.number().int('Les dÃ©cimales sont interdites pour le FCFA.').positive('Le montant doit Ãªtre positif.'),
});

const topUpSchema = z.object({
    amount: z.number().positive(),
    cardToken: z.string().optional()
});

const chargeSchema = z.object({
    payerPhone: z.string().min(8),
    amount: z.number().int('Les dÃ©cimales sont interdites pour le FCFA.').positive('Le montant doit Ãªtre positif.'),
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
        return res.status(500).json({ error: 'Erreur gÃ©nÃ©ration code' });
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

        // Applique aussi le verrouillage 3 échecs/15min — absent ici jusqu'ici (bcrypt.compare
        // seul), ce qui permettait de brute-forcer le PIN (4 chiffres) sans aucune limite dès
        // qu'une session valide était compromise. Statut 400 conservé (pas 401) : voir
        // commentaire dans /login, un 401 ici serait à tort traité comme "session expirée".
        const pinCheck = await verifyUserPin(client, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const branch = await prisma.branch.findUnique({ where: { code: branchCode }, include: { wallet: true, sessions: { where: { status: 'OPEN' } } } });

        if (!branch || !branch.wallet) return res.status(404).json({ error: 'Agence ou Guichet systÃ¨me introuvable.' });
        if (branch.status !== 'ACTIVE') return res.status(400).json({ error: 'Cette agence est momentanÃ©ment indisponible.' });

        if (branch.sessions.length === 0) return res.status(400).json({ error: 'Aucun caissier n\'est en ligne pour autoriser ce guichet physiquement.' });
        const activeSession = branch.sessions[0];

        if (branch.balance < amount) return res.status(400).json({ error: 'LiquiditÃ© de caisse insuffisante actuellement pour la remise.' });

        // Frais CentralisÃ©s (TODO: Enrober dans LimitEngine anti-fractionnement)
        const settings = await prisma.systemSettings.findFirst();
        // Marginal sur le seul dépassement du seuil, pas sur le montant entier une fois
        // celui-ci franchi — sinon un retrait de 500 001 FCFA payait des frais sur la
        // totalité alors qu'un retrait de 499 999 FCFA restait gratuit (effet de seuil
        // abrupt). Même formule que /client-initiated-withdraw plus bas, désormais la
        // référence commune aux deux chemins.
        let feeAmount = 0;
        if (settings && amount > settings.agencyWithdrawThreshold) {
            feeAmount = (amount - settings.agencyWithdrawThreshold) * settings.agencyTaxWithdraw;
        }

        const totalDebit = amount + feeAmount;
        if (client.wallet.balance < totalDebit) return res.status(400).json({ error: 'Solde insuffisant pour ce retrait (incluant les frais de rÃ©seau).' });

        // Transaction Ledger 100% Atomique â€” gardes atomiques (balance: gte) sur les deux
        // dÃ©crÃ©ments : les contrÃ´les ci-dessus (client.wallet.balance, branch.balance) lisent
        // une valeur non verrouillÃ©e, donc deux retraits QR simultanÃ©s du mÃªme client ou sur
        // la mÃªme agence pouvaient tous deux passer le contrÃ´le et faire passer le solde en
        // nÃ©gatif (mÃªme classe de bug que celle corrigÃ©e dans CashOperationService).
        await prisma.$transaction(async (tx) => {
            // 🛑 PESSIMISTIC LOCKING : Verrouillage strict anti-course
            const lockIds = [client.wallet!.id, branch.wallet!.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

            // Plafond Anti-Blanchiment : mÃªme contrÃ´le que /transfer et /pay-bill (services.ts)
            // â€” sans Ã§a, un client Tier 0 pouvait contourner sa limite journaliÃ¨re/mensuelle
            // en retirant via QR guichet plutÃ´t que par un transfert P2P classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, client.id, client.wallet!.id, amount, settings);

            await tx.wallet.update({ where: { id: client.wallet!.id, balance: { gte: totalDebit } }, data: { balance: { decrement: totalDebit } } });
            await tx.wallet.update({ where: { id: branch.wallet!.id }, data: { balance: { increment: amount } } });

            if (feeAmount > 0) {
                // Frais rÃ©seau = revenu plateforme, pas de la monnaie qui adosse les soldes
                // clients : va au compte Corporate (comme les frais P2P), pas Ã  la RÃ©serve.
                const corporate = await getOrCreateCorporateWallet(tx);
                await tx.wallet.update({ where: { id: corporate.wallet.id }, data: { balance: { increment: feeAmount } } });
            }

            await tx.transaction.create({
                data: { senderWalletId: client.wallet!.id, receiverWalletId: branch.wallet!.id, amount: amount, fee: feeAmount, status: 'COMPLETED', reference: generateReference('QROUT') }
            });

            await tx.branch.update({ where: { id: branch.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
            await tx.cashSession.update({ where: { id: activeSession.id }, data: { totalCashOutValue: { increment: amount } } });
        });

        // Notifications au Front
        await prisma.notification.createMany({
            data: [
                { userId: client.id, title: 'Retrait Guichet ValidÃ©', body: `Votre retrait de ${amount} FCFA en agence (${branch.name}) a Ã©tÃ© traitÃ© avec succÃ¨s.` }
            ]
        });

        res.json({ success: true, message: 'Transfert au guichet autorisÃ© !' });

    } catch (e: any) { res.status(500).json({ error: 'Erreur validation QR Cash-Out' }); }
});

// â”€â”€â”€ VÃ©rification atomique du plafond journalier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { LimitEngine, MAXIMUM_ALLOWED_LIMIT } from '../services/LimitEngine';

// NOTE: L'ancienne fonction a Ã©tÃ© supprimÃ©e au profit du moteur centralisÃ© LimitEngine
// pour Ã©viter la dette technique et la duplication de code P2P/Withdrawal.


// GET /api/wallet/limits
router.get('/limits', authMiddleware, async (req: AuthRequest, res) => {
    try {
        // `select` scopé : cette route est affichée avec le solde sur l'accueil (l'écran le
        // plus visité) et ne lisait auparavant que 6 champs sur toute la ligne User —
        // photos KYC base64 comprises à chaque appel.
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: {
                role: true, kycLevel: true, kycStatus: true,
                customLimitExpiresAt: true, customDailyLimit: true, customMonthlyLimit: true, customPerTxLimit: true,
                wallet: { select: { dailySpent: true, monthlySpent: true } }
            }
        });
        if (!user || user.role !== 'USER') return res.json({ skip: true });

        const settings = await getSystemSettings();

        // Appelle le moteur global pour un affichage cohÃ©rent sur le Front B2C
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

        // `select` scopé sur `user` : sans lui, chaque page de cet historique (jusqu'à
        // 100 lignes, x2 wallets par ligne) rapatriait la ligne User complète de chaque
        // expéditeur et destinataire — photos KYC base64 comprises — pour n'en afficher
        // au final que le nom et le téléphone (voir formatted ci-dessous). C'est l'écran
        // le plus rechargé de l'app (scroll de l'historique) ; GET /history juste au-dessus
        // restreignait déjà correctement ce même sous-objet, seule cette route ne le faisait pas.
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
            // Si c'est un dÃ©pÃ´t pur ou la mÃªme personne (nous utilisons senderWalletId = receiverWalletId pour dÃ©pÃ´t/retrait)
            if (tx.senderWalletId === tx.receiverWalletId) {
                return {
                    id: tx.id,
                    type: tx.reference?.startsWith('DEPOSIT') ? 'incoming' : 'outgoing',
                    amount: tx.amount,
                    currency: wallet.currency,
                    status: tx.status,
                    reference: tx.reference,
                    counterpart: 'SystÃ¨me (Mongain)',
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

// GET /api/wallet/lookup/:phone â€” Trouver un destinataire par numÃ©ro avant transfert
router.get('/lookup/:phone', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const phone = decodeURIComponent(req.params.phone as string);

        const user = await prisma.user.findUnique({
            where: { phone },
            select: { id: true, name: true, phone: true, role: true },
        });

        if (!user) return res.status(404).json({ error: 'Aucun compte trouvÃ© pour ce numÃ©ro.' });
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
        // VÃ©rification du PIN et gestion des tentatives Ã©chouÃ©es EN DEHORS de la
        // transaction financiÃ¨re ci-dessous : un `throw` dans un `$transaction`
        // interactif Prisma annule TOUTES ses Ã©critures, y compris celle qui
        // enregistre la tentative Ã©chouÃ©e â€” ce qui rendait le verrouillage aprÃ¨s
        // 3 Ã©checs totalement inopÃ©rant.
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) return res.status(400).json({ error: 'Compte expÃ©diteur introuvable.' });

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            return res.status(400).json({ error: 'Votre compte est temporairement bloquÃ© suite Ã  plusieurs Ã©checs. RÃ©essayez plus tard.' });
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

            if (isLocked) return res.status(400).json({ error: 'Compte bloquÃ© (3 Ã©checs). RÃ©essayez dans 15 minutes.' });
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

            if (!sender || !sender.wallet) throw new Error('Compte expÃ©diteur introuvable.');

            // La limite Anti-Blanchiment est maintenant intÃ©gralement calculÃ©e via le moteur.
            // On vÃ©rifie de faÃ§on unifiÃ©e Daily, Monthly et Per_Tx
            // getSystemSettings() (mis en cache, voir routes/settings.ts) au lieu d'un
            // tx.systemSettings.findFirst() : évite un aller-retour Neon de plus à l'intérieur
            // de cette transaction déjà proche du timeout Prisma.
            const settings = await getSystemSettings();
            await LimitEngine.verifyAndIncrementConsumption(tx, sender.id, sender.wallet.id, amount, settings);

            // Un Agent qui crÃ©dite un client via cet endpoint effectue un dÃ©pÃ´t guichet
            // (agent-action.tsx : Â« transfert gratuit d'un Agent vers Client Â»), pas un
            // transfert P2P classique entre deux clients â€” sans cette exemption, l'agent
            // payait de sa poche 1% de frais sur chaque dÃ©pÃ´t qu'il traitait, sans jamais
            // en Ãªtre informÃ© (aucun aperÃ§u de frais dans cet Ã©cran), l'UI le prÃ©sentant
            // comme gratuit alors que le serveur le facturait quand mÃªme.
            const fee = sender.role === 'AGENT' ? 0 : amount * settings.taxP2P;
            const totalRequired = amount + fee;

            if (sender.wallet.balance < totalRequired) {
                throw new Error(`Solde insuffisant. Vous devez avoir au moins ${totalRequired} FCFA.`);
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
            if (receiver.id === sender.id) throw new Error("Vous ne pouvez pas vous envoyer de l'argent Ã  vous-mÃªme.");

            // 🛑 PESSIMISTIC LOCKING : Empêche le Double-Spend. On trie pour éviter les deadlocks croisés.
            const lockIds = [sender.wallet.id, receiver.wallet.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

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
                    fee,
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: receiver.wallet.id,
                    status: 'COMPLETED',
                    // Si l'expÃ©diteur est un Agent rattachÃ© Ã  une agence (ex: agent-action.tsx,
                    // dÃ©pÃ´t guichet), l'opÃ©ration doit compter dans les rapports de cette
                    // agence â€” sans ce champ, ces dÃ©pÃ´ts Ã©taient invisibles du rÃ©seau
                    // d'agences alors qu'ils passent par un agent Mongain identifiÃ©.
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

            // PersistÃ©es en base pour les deux parties â€” le push/socket ci-dessous est un
            // best-effort en temps rÃ©el (Ã©choue silencieusement sans token/connexion), mais
            // sans cette Ã©criture ni l'expÃ©diteur ni le destinataire ne voyaient JAMAIS
            // l'opÃ©ration dans l'onglet Notifications de l'app.
            await tx.notification.create({
                data: { userId: sender.id, title: 'Transfert envoyÃ©', body: `Vous avez envoyÃ© ${amount.toLocaleString('fr-FR')} FCFA Ã  ${receiver.name}.`, type: 'TRANSACTION' }
            });
            await tx.notification.create({
                data: { userId: receiver.id, title: 'ðŸ’° Transfert reÃ§u', body: `Vous avez reÃ§u ${amount.toLocaleString('fr-FR')} FCFA de la part de ${sender.name}.`, type: 'TRANSACTION' }
            });

            return {
                transaction,
                remainingBalance: updatedSenderWallet.balance,
                receiverName: receiver.name,
                receiverPushToken: (receiver as any).pushToken,
                senderName: sender.name
            };
            // Timeout relevé à 15s (défaut Prisma : 5s) — même correctif que sur
            // CashOperationService.executeCashOut, client-initiated-withdraw et le départ
            // de tontine : /transfer (l'endpoint le plus sollicité de toute l'app) dépassait
            // aussi le délai par défaut sous charge réseau réelle contre la base distante.
        }, { timeout: 15000 });

        // Notify Receiver via Expo Push
        if ((result as any).receiverPushToken) {
            fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: (result as any).receiverPushToken,
                    title: 'ðŸ’° Transfert reÃ§u !',
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

        return res.json({ message: 'Transfert rÃ©ussi !', data: result });
    } catch (error: any) {
        return res.status(400).json({ error: friendlyErrorMessage(error) });
    }
});

// â”€â”€â”€ Retrait InitiÃ© par le Client (QR Permanent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/client-initiated-withdraw', authMiddleware, async (req: AuthRequest, res) => {
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { receiverPhone, amount, pin } = parsed.data;

    try {
        // MÃªme raisonnement que /transfer : la vÃ©rification du PIN et la gestion des
        // tentatives Ã©chouÃ©es doivent rester en dehors de la transaction financiÃ¨re,
        // sous peine d'Ãªtre annulÃ©es par le rollback en cas d'Ã©chec.
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) return res.status(400).json({ error: 'Compte client introuvable.' });

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            return res.status(400).json({ error: 'Votre compte est temporairement bloquÃ© suite Ã  plusieurs Ã©checs. RÃ©essayez plus tard.' });
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

            if (isLocked) return res.status(400).json({ error: 'Compte bloquÃ© (3 Ã©checs). RÃ©essayez dans 15 minutes.' });
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
            if (agent.role !== 'AGENT' && agent.role !== 'MERCHANT') throw new Error("OpÃ©ration impossible. Ce QR n'appartient ni Ã  un Agent ni Ã  un CommerÃ§ant.");

            // 🛑 PESSIMISTIC LOCKING
            const lockIds = [sender.wallet.id, agent.wallet.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

            // getSystemSettings() (mis en cache) au lieu d'un tx.systemSettings.findFirst() —
            // même correctif que ci-dessus : un round-trip Neon de moins dans cette transaction.
            const settings = await getSystemSettings();

            // Plafond Anti-Blanchiment : mÃªme contrÃ´le que /transfer et /pay-bill (services.ts)
            // â€” sans Ã§a, un client Tier 0 pouvait contourner sa limite journaliÃ¨re/mensuelle en
            // retirant via QR agent/marchand plutÃ´t que par un transfert P2P classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, sender.id, sender.wallet.id, amount, settings);

            let fee = 0;
            let merchantReward = 0;

            if (agent.role === 'MERCHANT') {
                fee = amount * settings.taxWithdraw;
                merchantReward = amount * settings.rewardMerchant;
                // Si un admin configure rewardMerchant > taxWithdraw (commission marchand plus
                // élevée que les frais qui la financent), `corporateCut = fee - merchantReward`
                // plus bas devient négatif et le garde-fou `if (corporateCut > 0)` ne prélève
                // alors RIEN pour compenser — le marchand est crédité `amount + merchantReward`
                // pour un débit client de seulement `amount + fee` : de la monnaie électronique
                // créée à partir de rien à chaque retrait. Plafonné ici pour que la commission
                // ne puisse jamais dépasser les frais qui la financent, quelle que soit la
                // configuration en base.
                if (merchantReward > fee) merchantReward = fee;
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
                data: { balance: { increment: amount } },
            });

            // La commission part sur un solde séparé (commissionWallet), pas dans le même
            // wallet que la vente — voir merchantService.ts. Créée à la volée au premier
            // gain de commission d'un marchand.
            let commissionWalletId: string | null = null;
            if (agent.role === 'MERCHANT' && merchantReward > 0) {
                const commissionWallet = await getOrCreateMerchantCommissionWallet(agent.id, tx);
                commissionWalletId = commissionWallet.id;
                await tx.wallet.update({
                    where: { id: commissionWallet.id },
                    data: { balance: { increment: merchantReward } },
                });
            }

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
                    fee,
                    senderWalletId: sender.wallet.id,
                    receiverWalletId: agent.wallet.id,
                    status: 'COMPLETED',
                    // Idem /transfer : si l'agent qui reÃ§oit ce retrait guichet est rattachÃ©
                    // Ã  une agence, l'opÃ©ration doit apparaÃ®tre dans les rapports de celle-ci.
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

            // Enregistrement de la commission marchand â€” le crÃ©dit lui-mÃªme a dÃ©jÃ  eu lieu
            // ci-dessus (agent.wallet incrÃ©mentÃ© de `amount + merchantReward` en une seule
            // opÃ©ration, corporate n'ayant reÃ§u que le net `corporateCut`), donc cette ligne
            // ne dÃ©place aucun fonds : elle rend juste la commission traÃ§able et sommable
            // dans le relevÃ© du marchand, qui ne pouvait jusqu'ici jamais la distinguer de la
            // vente elle-mÃªme.
            if (merchantReward > 0 && commissionWalletId) {
                await tx.transaction.create({
                    data: {
                        amount: merchantReward,
                        senderWalletId: corporate.wallet.id,
                        receiverWalletId: commissionWalletId,
                        status: 'COMPLETED',
                        reference: 'REWARD-' + transaction.id.substring(0, 8),
                    }
                });
            }

            // MÃªme correctif que /transfer : le client n'avait jusqu'ici aucune trace de ce
            // retrait dans son onglet Notifications, seulement le reÃ§u affichÃ© une fois Ã 
            // l'Ã©cran juste aprÃ¨s l'opÃ©ration. L'agent/marchand ne recevait qu'un Ã©vÃ©nement
            // Socket.IO best-effort â€” rien s'il n'Ã©tait pas connectÃ© Ã  ce moment prÃ©cis.
            await tx.notification.create({
                data: { userId: sender.id, title: 'Retrait effectuÃ©', body: `Vous avez retirÃ© ${amount.toLocaleString('fr-FR')} FCFA chez ${agent.name}.`, type: 'TRANSACTION' }
            });
            await tx.notification.create({
                data: { userId: agent.id, title: 'Paiement reÃ§u', body: `Vous avez reÃ§u ${amount.toLocaleString('fr-FR')} FCFA de la part de ${sender.name}.`, type: 'TRANSACTION' }
            });

            return {
                transaction,
                remainingBalance: updatedSenderWallet.balance,
                agentName: agent.name,
                agentPhone: agent.phone
            };
            // Timeout relevé à 15s (défaut Prisma : 5s) — cette transaction enchaîne
            // plafonds, anti-fractionnement et plusieurs écritures ; elle expirait déjà
            // sous charge réseau réelle contre la base distante, même chose constatée et
            // corrigée sur CashOperationService.executeCashOut.
        }, { timeout: 15000 });

        // Notify Agent via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${result.agentPhone}`).emit('payment_received', {
                amount,
                from: 'Client ' + req.userId?.substring(0, 5) // Minimal info
            });
        }

        return res.json({ message: 'Retrait autorisÃ© avec succÃ¨s !', data: result });
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

// âš ï¸ La recharge utilise maintenant la passerelle PVit (mypvit.pro)
router.post('/recharge', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = rechargeSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'DonnÃ©es invalides.' });

        const { method, identifier, amount } = parsed.data;
        if (amount > MAXIMUM_ALLOWED_LIMIT) {
            return res.status(400).json({ error: `Montant plafonnÃ© Ã  ${MAXIMUM_ALLOWED_LIMIT.toLocaleString('fr-FR')} FCFA par opÃ©ration.` });
        }

        if (method !== 'AIRTEL' && method !== 'MOOV') {
            return res.status(400).json({ error: 'Seuls Airtel et Moov sont supportÃ©s par cette passerelle.' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const settings = await getSystemSettings();
        if (!isPvitConfigured(settings)) {
            return res.status(503).json({ error: 'La passerelle de paiement (PVit) n\'est pas configurÃ©e.' });
        }

        // Compte systÃ¨me "Passerelle de Paiement" (Aggregator) pour simuler l'entrÃ©e d'argent externe
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

        const ref = generateReference(`RECHARGE-${method}`);
        const customerNumber = toPvitCustomerAccountNumber(identifier || user.phone);

        // Appel d'initiation via USSD Push
        await initiatePvitPayment(settings, {
            amount,
            reference: ref,
            customerAccountNumber: customerNumber,
            network: method as 'AIRTEL' | 'MOOV'
        });

        // CrÃ©er la transaction en PENDING. L'argent N'EST PAS crÃ©ditÃ© immÃ©diatement.
        // Le Webhook (/api/webhooks/pvit-status) s'en chargera.
        await prisma.transaction.create({
            data: {
                amount,
                senderWalletId: gateway.wallet.id,
                receiverWalletId: user.wallet.id,
                status: 'PENDING',
                // `type` manquant ici faisait retomber sur le défaut Prisma ("TRANSFER") :
                // le webhook PVit (routes/webhooks.ts) ne crédite le wallet que pour
                // `type === 'CASH_IN'`, donc un SUCCESS confirmé par PVit marquait quand
                // même la transaction COMPLETED sans jamais créditer le client — de
                // l'argent réellement prélevé (Airtel/Moov) mais jamais reçu côté Mongain.
                type: 'CASH_IN',
                reference: ref
            }
        });

        // On avertit le Front que la transaction est en cours
        res.json({
            status: 'PENDING',
            message: 'Veuillez confirmer la transaction sur votre tÃ©lÃ©phone via le menu envoyÃ©.',
            balance: user.wallet.balance
        });
    } catch (e: any) {
        console.error('Erreur /recharge PVit:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/wallet/topup (Rechargement par Carte Bancaire Client)
//
// âš ï¸ Aucune passerelle de paiement rÃ©elle n'est intÃ©grÃ©e : `cardToken` n'est
// jamais vÃ©rifiÃ©. Historiquement cette route crÃ©ditait le wallet du client
// sans aucune contrepartie dÃ©bitÃ©e ailleurs â€” un simple appel authentifiÃ©
// suffisait Ã  crÃ©er de la monnaie Ã©lectronique Ã  partir de rien. DÃ©sormais :
//   1. La route est dÃ©sactivÃ©e par dÃ©faut (401/501) en production tant
//      qu'aucune vraie intÃ©gration PSP (Stripe/CinetPay/etc.) n'est branchÃ©e.
//   2. Quand explicitement activÃ©e (dÃ©mo/staging), le crÃ©dit provient d'un
//      compte "passerelle" prÃ©-approvisionnÃ© (mÃªme schÃ©ma que /recharge),
//      pour conserver une Ã©criture comptable Ã  double entrÃ©e.
router.post('/topup', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CARD_TOPUP !== 'true') {
        return res.status(501).json({
            error: 'Le rechargement par carte bancaire nÃ©cessite une intÃ©gration avec un prestataire de paiement rÃ©el. Cette fonctionnalitÃ© est dÃ©sactivÃ©e tant que cette intÃ©gration n\'est pas en place.'
        });
    }

    const parsed = topUpSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

    const { amount } = parsed.data;
    if (amount > MAXIMUM_ALLOWED_LIMIT) {
        return res.status(400).json({ error: `Montant plafonnÃ© Ã  ${MAXIMUM_ALLOWED_LIMIT.toLocaleString('fr-FR')} FCFA par opÃ©ration.` });
    }

    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') throw new Error('Seuls les clients peuvent utiliser ce service de Top-Up.');
        if (!user.wallet) throw new Error('Wallet introuvable.');

        // Compte passerelle simulÃ© (mÃªme mÃ©canisme que /recharge) : le crÃ©dit
        // client a toujours une contrepartie dÃ©bitÃ©e, jamais crÃ©Ã© "from thin air".
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
                    body: `Votre compte a Ã©tÃ© rechargÃ© de ${amount.toLocaleString('fr-FR')} FCFA via Carte Bancaire.`,
                    type: 'TRANSACTION'
                }
            });

            return w.balance;
        });

        // Trigger socket IO if needed, but the user is the one initiating it.
        return res.json({
            message: 'Rechargement rÃ©ussi.',
            balance: newBalance
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors du rechargement.') });
    }
});

// POST /api/wallet/pay-service (Achat Ã‰lectricitÃ©, etc.)
//
// MÃªme situation que /api/services/pay-bill (services.ts) : aucune intÃ©gration rÃ©elle avec
// SEEG/Edan n'existe (le type ELECTRICITY refuse plus bas), et aucun autre `type` n'est
// rÃ©ellement implÃ©mentÃ© (serviceToken reste toujours vide) â€” sans ce gate, un appel direct
// avec n'importe quel `type` autre que ELECTRICITY dÃ©bitait quand mÃªme le client pour un
// service jamais livrÃ©. DÃ©sactivÃ© par dÃ©faut, mÃªme flag que services.ts (mÃªme catÃ©gorie :
// paiement de service externe non branchÃ©, pas un rechargement de wallet).
router.post('/pay-service', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES !== 'true') {
        return res.status(501).json({
            error: 'Le paiement de services nÃ©cessite une intÃ©gration rÃ©elle avec le fournisseur. Cette fonctionnalitÃ© est dÃ©sactivÃ©e tant que cette intÃ©gration n\'est pas en place.'
        });
    }
    try {
        const { type, amount, reference } = req.body;
        if (!amount || amount <= 0) throw new Error('Montant invalide');

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'USER') throw new Error('Seuls les clients peuvent utiliser ce service.');
        if (!user.wallet || user.wallet.balance < amount) throw new Error('Solde insuffisant pour ce paiement.');

        const reserve = await getCentralTreasury();

        let serviceToken = '';
        if (type === 'ELECTRICITY') {
            throw new Error("L'intÃ©gration SEEG/EDAN est en cours de finalisation. Les achats d'Ã©lectricitÃ© sont suspendus pour la BÃªta.");
        }

        const newBalance = await prisma.$transaction(async (tx) => {
            // Garde atomique (balance: gte) : le contrÃ´le ci-dessus lit une valeur non
            // verrouillÃ©e, donc deux paiements concurrents pouvaient tous deux le passer et
            // faire passer le solde en nÃ©gatif (mÃªme classe de bug que /pay-bill, /topup).
            const w = await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: w.id, // DÃ©bit
                    receiverWalletId: reserve!.wallet!.id, // CrÃ©dit Ã  la plateforme centrale
                    status: 'COMPLETED',
                    reference: generateReference(`SERVICE-${type}`),
                }
            });

            await (tx as any).notification.create({
                data: {
                    userId: user.id,
                    title: `Achat de Service : ${type}`,
                    body: `DÃ©bit de ${amount.toLocaleString('fr-FR')} FCFA. RÃ©fÃ©rence: ${reference}.`,
                    type: 'SYSTEM'
                }
            });

            return w.balance;
        });

        return res.json({
            message: 'Achat effectuÃ© avec succÃ¨s.',
            balance: newBalance,
            serviceToken
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors de l\'achat du service.') });
    }
});

// POST /api/wallet/pull (DÃ©pÃ´t Mobile Money via PVit)
//
// IntÃ©gration rÃ©elle (voir backend/src/services/pvit.ts) : cette route ne fait qu'INITIER la
// demande â€” PVit rÃ©pond immÃ©diatement avec un accusÃ© de prise en compte, jamais le rÃ©sultat
// final. Le wallet n'est crÃ©ditÃ© que par le webhook (backend/src/routes/webhooks.ts,
// POST /api/webhooks/pvit-status) une fois l'opÃ©rateur confirmÃ©, ce qui est pourquoi la
// transaction ci-dessous dÃ©marre PENDING et non COMPLETED.
router.post('/pull', authMiddleware, async (req: AuthRequest, res) => {
    const settings = await getSystemSettings();
    if (!isPvitConfigured(settings)) {
        return res.status(501).json({
            error: 'Le dÃ©pÃ´t Mobile Money nÃ©cessite une intÃ©gration rÃ©elle avec Airtel/Moov. Cette fonctionnalitÃ© est dÃ©sactivÃ©e tant que cette intÃ©gration n\'est pas configurÃ©e.'
        });
    }

    try {
        const { phone, amount, network } = req.body;
        if (!amount || amount < 500) throw new Error('Montant minimum : 500 FCFA');
        if (network !== 'AIRTEL' && network !== 'MOOV') throw new Error('OpÃ©rateur invalide.');
        if (!phone) throw new Error('NumÃ©ro de tÃ©lÃ©phone requis.');

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) throw new Error('Compte expÃ©diteur introuvable');

        // PVit rejette tout caractÃ¨re non-alphanumÃ©rique dans `reference` (leur propre exemple
        // de doc, "ORDER-2026-0001", ne passe pourtant pas leur propre validation â€” vÃ©rifiÃ© en
        // sandbox : "Le champ 'reference' doit Ãªtre une valeur alphanumerique") â€” retirer le
        // tiret de generateReference() avant envoi, cette mÃªme valeur sert aussi de clÃ© de
        // correspondance pour le webhook (Transaction.reference), donc les deux doivent Ãªtre
        // strictement identiques au caractÃ¨re prÃ¨s.
        const reference = generateReference('PULL').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const customerAccountNumber = toPvitCustomerAccountNumber(String(phone));

        const response = await initiatePvitPayment(settings, { amount, reference, customerAccountNumber, network });

        // Historiser la transaction â€” PENDING jusqu'Ã  confirmation par webhook.
        await prisma.transaction.create({
            data: {
                amount,
                receiverWalletId: user.wallet.id,
                status: 'PENDING',
                type: 'CASH_IN',
                reference,
            }
        });

        return res.json({
            message: response.message || 'Demande de dÃ©pÃ´t initiÃ©e. Consultez votre tÃ©lÃ©phone pour valider avec votre code PIN Mobile Money.',
            reference,
            network,
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors de la requÃªte de dÃ©pÃ´t rÃ©seau.') });
    }
});

// POST /api/wallet/push (Retrait Mobile Money vers Airtel/Moov via PVit)
router.post('/push', authMiddleware, async (req: AuthRequest, res) => {
    const settings = await getSystemSettings();
    if (!isPvitConfigured(settings)) {
        return res.status(501).json({
            error: 'Les retraits Mobile Money nÃ©cessitent une configuration PVit active.'
        });
    }

    try {
        const { phone, amount, network, pin } = req.body;
        if (!amount || amount < 500) throw new Error('Montant minimum : 500 FCFA');
        if (network !== 'AIRTEL' && network !== 'MOOV') throw new Error('OpÃ©rateur invalide.');
        if (!phone) throw new Error('NumÃ©ro de tÃ©lÃ©phone requis.');

        // 1. VÃ©rification du profil et du PIN (hors transaction pour incrÃ©menter les Ã©checs)
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) throw new Error('Compte expÃ©diteur introuvable.');

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            throw new Error('Votre compte est temporairement bloquÃ© suite Ã  plusieurs Ã©checs. RÃ©essayez plus tard.');
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
            throw new Error(isLocked ? 'Compte bloquÃ© (3 Ã©checs). RÃ©essayez dans 15 minutes.' : `Code PIN incorrect. Tentative ${attempts}/3.`);
        }

        if (senderPreCheck.failedPinAttempts > 0) {
            await prisma.user.update({ where: { id: senderPreCheck.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
        }

        const reference = generateReference('PUSH').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const customerAccountNumber = toPvitCustomerAccountNumber(String(phone));

        // 2. PrÃ©-dÃ©bit du solde + Frais
        const fee = amount * settings.taxWithdraw;
        const totalRequired = amount + fee;

        // RÃ©cupÃ©rer le compte passerelle pour Ã©quilibrer la comptabilitÃ©
        const gatewayPhone = '+24133333333';
        let gateway = await prisma.user.findUnique({ where: { phone: gatewayPhone }, include: { wallet: true } });
        if (!gateway || !gateway.wallet) {
            gateway = await prisma.user.create({
                data: {
                    phone: gatewayPhone,
                    name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)',
                    role: 'ADMIN',
                    pin: await bcrypt.hash('gateWaySecret', 10),
                    wallet: { create: { balance: 999999999, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }

        let senderWalletId = '';
        let corporateWalletId: string | null = null;
        let transactionId = '';

        await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
            if (!user || user.wallet!.balance < totalRequired) {
                throw new Error(`Solde insuffisant pour le montant et les ${fee} FCFA de frais de retrait.`);
            }
            senderWalletId = user.wallet!.id;

            // Anti-blanchiment
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, amount, settings);

            // On dÃ©duit directement pour verrouiller les fonds — updateMany + garde `gte`
            // (pas un simple `update`) : la lecture ci-dessus ne prend aucun verrou de ligne,
            // donc deux appels concurrents peuvent tous deux passer le contrÃ´le JS avant que
            // l'un ou l'autre n'Ã©crive. Seule la condition Ã©valuÃ©e par Postgres AU MOMENT de
            // l'Ã©criture (sous le verrou de ligne pris par l'UPDATE) empÃªche le double-retrait.
            const debited = await tx.wallet.updateMany({
                where: { id: user.wallet!.id, balance: { gte: totalRequired } },
                data: { balance: { decrement: totalRequired } }
            });
            if (debited.count === 0) {
                throw new Error(`Solde insuffisant pour le montant et les ${fee} FCFA de frais de retrait.`);
            }
            // L'argent "sort" vers la passerelle
            await tx.wallet.update({
                where: { id: gateway!.wallet!.id },
                data: { balance: { increment: amount } }
            });

            // Résolu une seule fois : ce compte était recherché deux fois de suite dans la
            // même transaction (crédit du solde, puis à nouveau pour la ligne Transaction de
            // traçabilité des frais juste en dessous) alors que rien ne change entre les deux.
            const corporate = fee > 0 ? await getOrCreateCorporateWallet(tx) : null;
            if (corporate) corporateWalletId = corporate.wallet.id;

            if (fee > 0 && corporate) {
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: fee } }
                });
            }

            const transaction = await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: gateway!.wallet!.id,
                    status: 'PENDING',
                    type: 'CASH_OUT',
                    reference,
                }
            });
            transactionId = transaction.id;

            if (fee > 0 && corporate) {
                await tx.transaction.create({
                    data: {
                        amount: fee,
                        senderWalletId: user.wallet!.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: 'FEE-MM-' + transaction.id.substring(0, 8),
                    }
                });
            }
        });

        // 3. Demande Ã  PVit d'exÃ©cuter le virement (Transfert)
        try {
            await initiatePvitTransfer(settings, { amount, reference, customerAccountNumber, network });
        } catch (pvitError: any) {
            // PVit a refusé/n'a jamais reçu la demande — différent d'un statut FAILED transmis
            // plus tard par webhook (routes/webhooks.ts) : ici, aucun webhook ne viendra
            // jamais, puisque PVit n'a rien accepté à confirmer. Sans cette reprise, le
            // pré-débit ci-dessus restait définitif alors que le client voit une erreur lui
            // disant que le retrait a échoué — de l'argent perdu sans aucun chemin de recours.
            await prisma.$transaction(async (tx) => {
                const claim = await tx.transaction.updateMany({
                    where: { id: transactionId, status: 'PENDING' },
                    data: { status: 'FAILED' }
                });
                // count===0 : un webhook est arrivé entre-temps et a déjà traité ce cas
                // (rarissime vu que PVit n'a rien accepté, mais on ne reprend jamais deux fois).
                if (claim.count === 0) return;

                await tx.wallet.update({
                    where: { id: gateway!.wallet!.id },
                    data: { balance: { decrement: amount } }
                });
                if (corporateWalletId && fee > 0) {
                    await tx.wallet.update({
                        where: { id: corporateWalletId },
                        data: { balance: { decrement: fee } }
                    });
                }
                await tx.wallet.update({
                    where: { id: senderWalletId },
                    data: { balance: { increment: totalRequired } }
                });
            });
            throw pvitError;
        }

        return res.json({
            message: 'Votre demande de retrait est initiÃ©e. Vous allez le recevoir dans quelques instants.',
            reference,
            network,
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors du retrait.') });
    }
});

export default router;



