import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Expo } from 'expo-server-sdk';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { getOrCreateMerchantCommissionWallet } from '../services/merchantService';
import { initiatePvitPayment, initiatePvitTransfer, isPvitConfigured, toPvitCustomerAccountNumber } from '../services/pvit';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const expo = new Expo();

// Compte de revenus (frais de transactions) — distinct du compte Réserve/Voûte
// (+24199999999, géré par la Trésorerie) qui ne doit contenir que la monnaie qui adosse
// les soldes clients. Auto-guérison (même principe que treasury.ts pour la Réserve) : si le
// compte n'existe pas encore en base, tout prélèvement de frais échouait silencieusement en
// erreur 500 ("Compte corporate introuvable"), ce qui pouvait bloquer tous les transferts P2P.
export async function getOrCreateCorporateWallet(tx: any) {
    return getSystemAccount('CORPORATE', tx);
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

const topUpSchema = z.object({
    amount: z.number().positive(),
    cardToken: z.string().optional()
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

        // Applique aussi le verrouillage 3 échecs/15min — absent ici jusqu'ici (bcrypt.compare
        // seul), ce qui permettait de brute-forcer le PIN (4 chiffres) sans aucune limite dès
        // qu'une session valide était compromise. Statut 400 conservé (pas 401) : voir
        // commentaire dans /login, un 401 ici serait à tort traité comme "session expirée".
        const pinCheck = await verifyUserPin(client, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const branch = await prisma.branch.findUnique({ where: { code: branchCode }, include: { wallet: true, sessions: { where: { status: 'OPEN' } } } });

        if (!branch || !branch.wallet) return res.status(404).json({ error: 'Agence ou Guichet système introuvable.' });
        if (branch.status !== 'ACTIVE') return res.status(400).json({ error: 'Cette agence est momentanément indisponible.' });

        if (branch.sessions.length === 0) return res.status(400).json({ error: 'Aucun caissier n\'est en ligne pour autoriser ce guichet physiquement.' });
        const activeSession = branch.sessions[0];

        if (branch.balance < amount) return res.status(400).json({ error: 'Liquidité de caisse insuffisante actuellement pour la remise.' });

        // Frais Centralisés (TODO: Enrober dans LimitEngine anti-fractionnement)
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
        if (client.wallet.balance < totalDebit) return res.status(400).json({ error: 'Solde insuffisant pour ce retrait (incluant les frais de réseau).' });

        // Transaction Ledger 100% Atomique — gardes atomiques (balance: gte) sur les deux
        // décréments : les contrôles ci-dessus (client.wallet.balance, branch.balance) lisent
        // une valeur non verrouillée, donc deux retraits QR simultanés du même client ou sur
        // la même agence pouvaient tous deux passer le contrôle et faire passer le solde en
        // négatif (même classe de bug que celle corrigée dans CashOperationService).
        await prisma.$transaction(async (tx) => {
            // 🛑 PESSIMISTIC LOCKING : Verrouillage strict anti-course
            const lockIds = [client.wallet!.id, branch.wallet!.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

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
                data: { senderWalletId: client.wallet!.id, receiverWalletId: branch.wallet!.id, amount: amount, fee: feeAmount, status: 'COMPLETED', reference: generateReference('QROUT') }
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

    } catch (e: any) {
        // 400 + message réel (pas un 500 générique muet) : sinon un dépassement de plafond
        // AML légitime (LimitEngine) ou un solde insuffisant (garde atomique ci-dessus)
        // remontait comme une simple "erreur de validation" sans dire au client pourquoi —
        // même convention que /transfer, /client-initiated-withdraw et le reste de ce fichier.
        res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur validation QR Cash-Out') });
    }
});

// ─── Vérification atomique du plafond journalier ───────────────────────────
import { LimitEngine, MAXIMUM_ALLOWED_LIMIT } from '../services/LimitEngine';

// NOTE: L'ancienne fonction a été supprimée au profit du moteur centralisé LimitEngine
// pour éviter la dette technique et la duplication de code P2P/Withdrawal.


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

const matchContactsSchema = z.object({
    // Numéros déjà normalisés côté mobile (même format que User.phone, ex: +241XXXXXXXX) —
    // voir src/services/contacts.ts. Plafonné pour éviter qu'un carnet d'adresses géant (ou
    // un appel abusif) ne déclenche une requête arbitrairement lourde.
    phones: z.array(z.string()).min(1).max(1000),
});

// Un utilisateur authentifié pourrait sinon appeler cette route en boucle avec des numéros
// devinés/générés pour cartographier qui, parmi une liste arbitraire, a un compte Mongain
// et sous quel nom — une fuite de PII bien plus large que l'usage normal (synchroniser SON
// PROPRE carnet, une poignée de fois par session tout au plus). 20 requêtes/15 min plafonne
// la casse à 20 000 numéros testés dans la fenêtre, largement suffisant pour l'usage réel.
const matchContactsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Trop de requêtes de synchronisation de contacts, veuillez réessayer plus tard.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// POST /api/wallet/match-contacts — Retrouve, parmi les numéros du carnet de contacts du
// téléphone, lesquels correspondent à un compte Mongain déjà inscrit (même principe que
// WhatsApp : montrer directement qui de ses contacts est déjà sur l'app, plutôt que de
// faire taper un numéro à l'aveugle pour chaque personne qu'on veut inviter/payer). Ne
// renvoie et ne conserve jamais les numéros SANS correspondance — uniquement les comptes
// réellement trouvés, avec le strict nécessaire pour les afficher (jamais de solde, de PIN,
// ni aucune autre donnée sensible).
router.post('/match-contacts', authMiddleware, matchContactsLimiter, async (req: AuthRequest, res) => {
    const parsed = matchContactsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    try {
        const uniquePhones = [...new Set(parsed.data.phones)];
        const users = await prisma.user.findMany({
            where: { phone: { in: uniquePhones }, id: { not: req.userId } },
            select: { id: true, name: true, phone: true, role: true },
        });
        return res.json({ matches: users });
    } catch (e: any) {
        console.error('Erreur /wallet/match-contacts:', e);
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

            // 🛑 PESSIMISTIC LOCKING : Empêche le Double-Spend. On trie pour éviter les deadlocks croisés.
            // Acquis AVANT LimitEngine (juste en dessous) : LimitEngine verrouille aussi
            // sender.wallet.id en interne (FOR UPDATE) — s'il le faisait EN PREMIER, deux
            // /transfer concurrents en sens opposé entre les deux mêmes wallets (Alice→Bob et
            // Bob→Alice) verrouillaient chacun leur propre wallet expéditeur puis se
            // bloquaient mutuellement en tentant d'acquérir l'autre dans l'ordre trié — un
            // deadlock réel que Postgres détecte et résout en annulant l'une des deux
            // transactions. Verrouiller la paire triée ICI d'abord rend le verrou interne de
            // LimitEngine sur sender.wallet.id un no-op (même transaction, même ligne déjà
            // tenue), fermant la fenêtre.
            const lockIds = [sender.wallet.id, receiver.wallet.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

            // La limite Anti-Blanchiment est maintenant intégralement calculée via le moteur.
            // On vérifie de façon unifiée Daily, Monthly et Per_Tx
            // getSystemSettings() (mis en cache, voir routes/settings.ts) au lieu d'un
            // tx.systemSettings.findFirst() : évite un aller-retour Neon de plus à l'intérieur
            // de cette transaction déjà proche du timeout Prisma.
            const settings = await getSystemSettings();
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
                throw new Error(`Solde insuffisant. Vous devez avoir au moins ${totalRequired} FCFA.`);
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

            // 🛑 PESSIMISTIC LOCKING
            const lockIds = [sender.wallet.id, agent.wallet.id].sort();
            for (const id of lockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

            // getSystemSettings() (mis en cache) au lieu d'un tx.systemSettings.findFirst() —
            // même correctif que ci-dessus : un round-trip Neon de moins dans cette transaction.
            const settings = await getSystemSettings();

            // Plafond Anti-Blanchiment : même contrôle que /transfer et /pay-bill (services.ts)
            // — sans ça, un client Tier 0 pouvait contourner sa limite journalière/mensuelle en
            // retirant via QR agent/marchand plutôt que par un transfert P2P classique.
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
            // ci-dessus (commissionWallet incrémenté de `merchantReward`, séparément de
            // agent.wallet qui ne reçoit que `amount` ; corporate ne reçoit que le net
            // `corporateCut`), donc cette ligne ne déplace aucun fonds : elle rend juste la
            // commission traçable et sommable dans le relevé du marchand, qui ne pouvait
            // jusqu'ici jamais la distinguer de la vente elle-même.
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

            // Même correctif que /transfer : le client n'avait jusqu'ici aucune trace de ce
            // retrait dans son onglet Notifications, seulement le reçu affiché une fois à
            // l'écran juste après l'opération. L'agent/marchand ne recevait qu'un événement
            // Socket.IO best-effort — rien s'il n'était pas connecté à ce moment précis.
            await tx.notification.create({
                data: { userId: sender.id, title: 'Retrait effectué', body: `Vous avez retiré ${amount.toLocaleString('fr-FR')} FCFA chez ${agent.name}.`, type: 'TRANSACTION' }
            });
            await tx.notification.create({
                data: { userId: agent.id, title: 'Paiement reçu', body: `Vous avez reçu ${amount.toLocaleString('fr-FR')} FCFA de la part de ${sender.name}.`, type: 'TRANSACTION' }
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

// ⚠️ La recharge utilise maintenant la passerelle PVit (mypvit.pro)
router.post('/recharge', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = rechargeSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides.' });

        const { method, identifier, amount } = parsed.data;
        if (amount > MAXIMUM_ALLOWED_LIMIT) {
            return res.status(400).json({ error: `Montant plafonné à ${MAXIMUM_ALLOWED_LIMIT.toLocaleString('fr-FR')} FCFA par opération.` });
        }

        if (method !== 'AIRTEL' && method !== 'MOOV') {
            return res.status(400).json({ error: 'Seuls Airtel et Moov sont supportés par cette passerelle.' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const settings = await getSystemSettings();
        if (!isPvitConfigured(settings)) {
            return res.status(503).json({ error: 'La passerelle de paiement (PVit) n\'est pas configurée.' });
        }

        // Compte système "Passerelle de Paiement" (Aggregator) pour simuler l'entrée d'argent externe
        const gateway = await getSystemAccount('EXTERNAL_GATEWAY');
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

        // Créer la transaction en PENDING. L'argent N'EST PAS crédité immédiatement.
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
            message: 'Veuillez confirmer la transaction sur votre téléphone via le menu envoyé.',
            balance: user.wallet.balance
        });
    } catch (e: any) {
        console.error('Erreur /recharge PVit:', e);
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
        const gateway = await getSystemAccount('EXTERNAL_GATEWAY');
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
//
// Même situation que /api/services/pay-bill (services.ts) : aucune intégration réelle avec
// SEEG/Edan n'existe (le type ELECTRICITY refuse plus bas), et aucun autre `type` n'est
// réellement implémenté (serviceToken reste toujours vide) — sans ce gate, un appel direct
// avec n'importe quel `type` autre que ELECTRICITY débitait quand même le client pour un
// service jamais livré. Désactivé par défaut, même flag que services.ts (même catégorie :
// paiement de service externe non branché, pas un rechargement de wallet).
router.post('/pay-service', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES !== 'true') {
        return res.status(501).json({
            error: 'Le paiement de services nécessite une intégration réelle avec le fournisseur. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
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
            throw new Error("L'intégration SEEG/EDAN est en cours de finalisation. Les achats d'électricité sont suspendus pour la Bêta.");
        }

        const newBalance = await prisma.$transaction(async (tx) => {
            // Même contrôle Anti-Blanchiment que /pay-bill (services.ts) — sans lui, ce rail
            // permettait à un client Tier 0 de contourner sa limite journalière/mensuelle
            // dès que ce flag bêta est activé.
            const settings = await getSystemSettings();
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, amount, settings);

            // Garde atomique (balance: gte) : le contrôle ci-dessus lit une valeur non
            // verrouillée, donc deux paiements concurrents pouvaient tous deux le passer et
            // faire passer le solde en négatif (même classe de bug que /pay-bill, /topup).
            const w = await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Créditer la réserve centrale — sans ce update, le débit ci-dessus faisait
            // purement et simplement disparaître l'argent : la ligne Transaction ci-dessous
            // ENREGISTRE un crédit vers `reserve.wallet` mais ne le PROVOQUE pas, un
            // Transaction n'étant qu'une écriture d'audit, jamais un mouvement de solde.
            await tx.wallet.update({
                where: { id: reserve!.wallet!.id },
                data: { balance: { increment: amount } }
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

// POST /api/wallet/pull (Dépôt Mobile Money via PVit)
//
// Intégration réelle (voir backend/src/services/pvit.ts) : cette route ne fait qu'INITIER la
// demande — PVit répond immédiatement avec un accusé de prise en compte, jamais le résultat
// final. Le wallet n'est crédité que par le webhook (backend/src/routes/webhooks.ts,
// POST /api/webhooks/pvit-status) une fois l'opérateur confirmé, ce qui est pourquoi la
// transaction ci-dessous démarre PENDING et non COMPLETED.
router.post('/pull', authMiddleware, async (req: AuthRequest, res) => {
    const settings = await getSystemSettings();
    if (!isPvitConfigured(settings)) {
        return res.status(501).json({
            error: 'Le dépôt Mobile Money nécessite une intégration réelle avec Airtel/Moov. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas configurée.'
        });
    }

    try {
        const { phone, amount, network } = req.body;
        if (!amount || amount < 500) throw new Error('Montant minimum : 500 FCFA');
        if (network !== 'AIRTEL' && network !== 'MOOV') throw new Error('Opérateur invalide.');
        if (!phone) throw new Error('Numéro de téléphone requis.');

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) throw new Error('Compte expéditeur introuvable');

        // PVit rejette tout caractère non-alphanumérique dans `reference` (leur propre exemple
        // de doc, "ORDER-2026-0001", ne passe pourtant pas leur propre validation — vérifié en
        // sandbox : "Le champ 'reference' doit être une valeur alphanumerique") — retirer le
        // tiret de generateReference() avant envoi, cette même valeur sert aussi de clé de
        // correspondance pour le webhook (Transaction.reference), donc les deux doivent être
        // strictement identiques au caractère près.
        const reference = generateReference('PULL').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const customerAccountNumber = toPvitCustomerAccountNumber(String(phone));

        const response = await initiatePvitPayment(settings, { amount, reference, customerAccountNumber, network });

        // Historiser la transaction — PENDING jusqu'à confirmation par webhook.
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
            message: response.message || 'Demande de dépôt initiée. Consultez votre téléphone pour valider avec votre code PIN Mobile Money.',
            reference,
            network,
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors de la requête de dépôt réseau.') });
    }
});

// POST /api/wallet/push (Retrait Mobile Money vers Airtel/Moov via PVit)
router.post('/push', authMiddleware, async (req: AuthRequest, res) => {
    const settings = await getSystemSettings();
    if (!isPvitConfigured(settings)) {
        return res.status(501).json({
            error: 'Les retraits Mobile Money nécessitent une configuration PVit active.'
        });
    }

    try {
        const { phone, amount, network, pin } = req.body;
        if (!amount || amount < 500) throw new Error('Montant minimum : 500 FCFA');
        if (network !== 'AIRTEL' && network !== 'MOOV') throw new Error('Opérateur invalide.');
        if (!phone) throw new Error('Numéro de téléphone requis.');

        // 1. Vérification du profil et du PIN (hors transaction pour incrémenter les échecs)
        const senderPreCheck = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!senderPreCheck) throw new Error('Compte expéditeur introuvable.');

        if (senderPreCheck.lockedUntil && senderPreCheck.lockedUntil > new Date()) {
            throw new Error('Votre compte est temporairement bloqué suite à plusieurs échecs. Réessayez plus tard.');
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
            throw new Error(isLocked ? 'Compte bloqué (3 échecs). Réessayez dans 15 minutes.' : `Code PIN incorrect. Tentative ${attempts}/3.`);
        }

        if (senderPreCheck.failedPinAttempts > 0) {
            await prisma.user.update({ where: { id: senderPreCheck.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
        }

        const reference = generateReference('PUSH').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
        const customerAccountNumber = toPvitCustomerAccountNumber(String(phone));

        // 2. Pré-débit du solde + Frais
        const fee = amount * settings.taxWithdraw;
        const totalRequired = amount + fee;

        // Récupérer le compte passerelle pour équilibrer la comptabilité
        const gateway = await getSystemAccount('EXTERNAL_GATEWAY');

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

            // On déduit directement pour verrouiller les fonds — updateMany + garde `gte`
            // (pas un simple `update`) : la lecture ci-dessus ne prend aucun verrou de ligne,
            // donc deux appels concurrents peuvent tous deux passer le contrôle JS avant que
            // l'un ou l'autre n'écrive. Seule la condition évaluée par Postgres AU MOMENT de
            // l'écriture (sous le verrou de ligne pris par l'UPDATE) empêche le double-retrait.
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

        // 3. Demande à PVit d'exécuter le virement (Transfert)
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

                // Sans ça, la ligne FEE-MM- restait `COMPLETED` alors que les frais qu'elle
                // trace viennent d'être reversés au client ci-dessus — un retrait annulé
                // continuait donc d'apparaître comme ayant généré une commission bien réelle
                // dans l'historique/la comptabilité, malgré aucune perte de fonds.
                if (corporateWalletId && fee > 0) {
                    await tx.transaction.updateMany({
                        where: { reference: 'FEE-MM-' + transactionId.substring(0, 8), status: 'COMPLETED' },
                        data: { status: 'FAILED' }
                    });
                }
            });
            throw pvitError;
        }

        return res.json({
            message: 'Votre demande de retrait est initiée. Vous allez le recevoir dans quelques instants.',
            reference,
            network,
        });
    } catch (e: any) {
        return res.status(400).json({ error: friendlyErrorMessage(e, 'Erreur lors du retrait.') });
    }
});

export default router;



