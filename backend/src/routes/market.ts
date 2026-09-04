import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = Router();

// ==========================================
// 1. Listings
// ==========================================

// Create Listing
router.post('/listings', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { title, description, price } = req.body;

        // `price <= 0` sur une valeur non parsée laissait passer un prix manquant/non
        // numérique (`undefined <= 0` vaut `false` en JS, donc "ni titre manquant ni prix
        // négatif" restait vrai) : l'annonce était créée avec `price: NaN` (Postgres accepte
        // NaN en float8), ensuite invendable — `buyer.wallet.balance < NaN` est toujours
        // `false`, laissant croire l'achat autorisé jusqu'à un 500 confus en transaction.
        const parsedPrice = parseFloat(price);
        if (!title || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            return res.status(400).json({ error: "Invalid data" });
        }

        const listing = await prisma.marketListing.create({
            data: {
                sellerId: req.userId,
                title,
                description,
                price: parsedPrice
            }
        });

        res.status(201).json({ success: true, listing });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Get Active Listings
router.get('/listings', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const listings = await prisma.marketListing.findMany({
            where: { isActive: true },
            include: { seller: { select: { name: true, phone: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, listings });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// 2. Escrow (Purchase)
// ==========================================

// Le find-or-create local dupliquait exactement systemAccounts.ts::getSystemAccount, dont
// c'est justement le rôle (remplacer ce genre de copie dispersée) — même clé `kind`, donc la
// ligne SystemAccount déjà créée par l'ancien code est simplement retrouvée par l'upsert.
async function getEscrowWallet(tx: any) {
    const sa = await getSystemAccount('MARKET_ESCROW', tx);
    return sa.wallet;
}

// Buy Item: Creates Escrow and Locks Funds
router.post('/buy/:id', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { pin } = req.body;
        const listingId = req.params.id as string;

        const buyer = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!buyer || !buyer.wallet) return res.status(400).json({ error: "Buyer error" });

        // Contrôle centralisé (verrouillage 3 échecs) — un bcrypt.compare nu ici n'avait
        // aucune limite de tentatives, rendant l'espace à 4 chiffres du PIN brute-forçable.
        const pinCheck = await verifyUserPin(buyer, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const listing = await prisma.marketListing.findUnique({
            where: { id: listingId }
        });

        if (!listing || !listing.isActive) {
            return res.status(400).json({ error: "Annonce indisponible" });
        }
        if (listing.sellerId === buyer.id) return res.status(400).json({ error: "Vous ne pouvez pas acheter votre propre annonce." });

        if (buyer.wallet.balance < listing.price) {
            return res.status(400).json({ error: "Solde insuffisant" });
        }

        const settings = await getSystemSettings();

        const { escrowTx, seller } = await prisma.$transaction(async (tx) => {
            // Verrou atomique sur l'annonce (updateMany + count===0, comme
            // admin.market.ts pour EscrowTransaction.status) : un simple `update({ where:
            // { id } })` n'a aucune précondition sur `isActive` et réussit toujours, même si
            // l'annonce vient d'être verrouillée par un autre achat concurrent — deux
            // acheteurs scannant/achetant la même annonce en même temps passaient tous deux
            // le contrôle `listing.isActive` (lu hors transaction) et créaient chacun un
            // escrow LOCKED distinct sur le même article, le vendeur ne pouvant livrer qu'à
            // un seul des deux.
            const claimed = await tx.marketListing.updateMany({
                where: { id: listing.id, isActive: true },
                data: { isActive: false }
            });
            if (claimed.count === 0) throw new Error("Cette annonce vient d'être achetée par quelqu'un d'autre.");

            // Plafonds AML/KYC — cet achat débitait le portefeuille de l'acheteur sans passer
            // par aucun contrôle de plafond, contrairement aux rails de paiement équivalents.
            await LimitEngine.verifyAndIncrementConsumption(tx, buyer.id, buyer.wallet!.id, listing.price, settings);

            const escrowWallet = await getEscrowWallet(tx);

            // Move Funds to Escrow
            await tx.wallet.update({
                where: { id: buyer.wallet!.id, balance: { gte: listing.price } },
                data: { balance: { decrement: listing.price } }
            });
            await tx.wallet.update({
                where: { id: escrowWallet.id },
                data: { balance: { increment: listing.price } }
            });

            // Log Transaction System
            const ref = `LOCKED_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await tx.transaction.create({
                data: {
                    reference: ref,
                    amount: listing.price,
                    status: 'COMPLETED', // Transaction to Escrow is completed
                    senderWalletId: buyer.wallet!.id,
                    receiverWalletId: escrowWallet.id,
                    fee: 0
                }
            });

            // Create Escrow Rule Record
            const escrowTx = await tx.escrowTransaction.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: listing.sellerId,
                    listingId: listing.id,
                    amount: listing.price,
                    status: 'LOCKED'
                }
            });

            // Aucune notification n'existait jusqu'ici pour le vendeur — il ne pouvait
            // apprendre qu'un article s'était vendu qu'en ouvrant l'app par hasard, alors
            // qu'il doit livrer l'article pour débloquer les fonds.
            const soldTitle = 'Article vendu !';
            const soldBody = `« ${listing.title} » a été acheté pour ${listing.price.toLocaleString('fr-FR')} FCFA. Les fonds sont bloqués en séquestre jusqu'à confirmation de réception.`;
            await tx.notification.create({
                data: { userId: listing.sellerId, title: soldTitle, body: soldBody, type: 'TRANSACTION' }
            });
            const seller = await tx.user.findUnique({ where: { id: listing.sellerId }, select: { phone: true, pushToken: true } });

            return { escrowTx, seller };
        });

        await sendPush(seller?.pushToken, 'Article vendu !', `« ${listing.title} » a été acheté pour ${listing.price.toLocaleString('fr-FR')} FCFA. Les fonds sont bloqués en séquestre jusqu'à confirmation de réception.`);
        const io = req.app.get('io');
        if (io && seller) io.to(`user_${seller.phone}`).emit('global_push', { title: 'Article vendu !', body: `« ${listing.title} » a été acheté.` });

        res.json({ success: true, escrowTx, message: "Achat sécurisé ! Les fonds sont bloqués chez Mongain." });
    } catch (e: any) {
        // 400 + message réel : un rejet métier (annonce déjà vendue, plafond AML, solde
        // insuffisant détecté dans la transaction) ne doit pas remonter comme une panne
        // serveur générique — même convention que le reste des rails de paiement.
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

// Release Escrow (By Buyer upon receipt)
router.post('/escrow/:id/release', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const escrowId = req.params.id as string;

        const escrow = await prisma.escrowTransaction.findUnique({
            where: { id: escrowId }
        });

        if (!escrow) return res.status(404).json({ error: "Escrow introuvable" });
        if (escrow.buyerId !== req.userId) {
            return res.status(403).json({ error: "Accès refusé" });
        }
        if (escrow.status !== 'LOCKED') return res.status(400).json({ error: "Les fonds ne sont plus bloqués." });

        const releaseTitle = 'Fonds débloqués !';
        const releaseBody = `Le séquestre de ${escrow.amount.toLocaleString('fr-FR')} FCFA a été libéré sur votre solde.`;

        const sellerUser = await prisma.$transaction(async (tx) => {
            const escrowWallet = await getEscrowWallet(tx);
            const sellerUser = await tx.user.findUnique({
                where: { id: escrow.sellerId },
                include: { wallet: true }
            });

            if (!sellerUser || !sellerUser.wallet) throw new Error("Vendeur corrompu");

            // Release Funds to Seller
            await tx.wallet.update({
                where: { id: escrowWallet.id, balance: { gte: escrow.amount } },
                data: { balance: { decrement: escrow.amount } }
            });
            await tx.wallet.update({
                where: { id: sellerUser.wallet.id },
                data: { balance: { increment: escrow.amount } }
            });

            const ref = `RELEASE_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await tx.transaction.create({
                data: {
                    reference: ref,
                    amount: escrow.amount,
                    status: 'COMPLETED',
                    senderWalletId: escrowWallet.id,
                    receiverWalletId: sellerUser.wallet.id,
                    fee: 0
                }
            });

            await tx.escrowTransaction.update({
                where: { id: escrow.id },
                data: { status: 'RELEASED', releasedAt: new Date() }
            });

            // Même angle mort que l'achat : aucune notification n'existait pour prévenir le
            // vendeur que l'argent, jusque-là bloqué, est désormais réellement sur son solde.
            await tx.notification.create({
                data: { userId: sellerUser.id, title: releaseTitle, body: releaseBody, type: 'TRANSACTION' }
            });

            return sellerUser;
        });

        await sendPush(sellerUser.pushToken, releaseTitle, releaseBody);
        const io = req.app.get('io');
        if (io) io.to(`user_${sellerUser.phone}`).emit('global_push', { title: releaseTitle, body: releaseBody });

        res.json({ success: true, message: "Fonds libérés avec succès vers le vendeur." });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
