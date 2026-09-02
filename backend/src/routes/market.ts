import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';

const router = Router();

// ==========================================
// 1. Listings
// ==========================================

// Create Listing
router.post('/listings', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { title, description, price } = req.body;

        if (!title || price <= 0) return res.status(400).json({ error: "Invalid data" });

        const listing = await prisma.marketListing.create({
            data: {
                sellerId: req.userId,
                title,
                description,
                price: parseFloat(price)
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

// Get or Create Escrow System Wallet
async function getEscrowWallet(tx: any) {
    let sa = await tx.systemAccount.findUnique({
        where: { kind: 'MARKET_ESCROW' },
        include: { wallet: true }
    });

    if (!sa) {
        const w = await tx.wallet.create({ data: { currency: 'FCFA' } });
        sa = await tx.systemAccount.create({
            data: {
                kind: 'MARKET_ESCROW',
                name: 'Mongain Escrow Reserve',
                walletId: w.id
            },
            include: { wallet: true }
        });
    }
    return sa.wallet;
}

// Buy Item: Creates Escrow and Locks Funds
router.post('/buy/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { pin } = req.body;
        const listingId = req.params.id as string;

        const buyer = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!buyer || !buyer.wallet) return res.status(400).json({ error: "Buyer error" });

        const isValidPin = await bcrypt.compare(pin, buyer.pin);
        if (!isValidPin) return res.status(401).json({ error: "Code PIN incorrect" });

        const listing = await prisma.marketListing.findUnique({
            where: { id: listingId }
        });

        if (!listing || !listing.isActive) {
            return res.status(400).json({ error: "Annonce indisponible" });
        }

        if (buyer.wallet.balance < listing.price) {
            return res.status(400).json({ error: "Solde insuffisant" });
        }

        const escrowTx = await prisma.$transaction(async (tx) => {
            // Lock Listing
            await tx.marketListing.update({
                where: { id: listing.id },
                data: { isActive: false }
            });

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
            return await tx.escrowTransaction.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: listing.sellerId,
                    listingId: listing.id,
                    amount: listing.price,
                    status: 'LOCKED'
                }
            });
        });

        res.json({ success: true, escrowTx, message: "Achat sécurisé ! Les fonds sont bloqués chez Mongain." });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Release Escrow (By Buyer upon receipt)
router.post('/escrow/:id/release', authMiddleware, async (req: AuthRequest, res) => {
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

        await prisma.$transaction(async (tx) => {
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
        });

        res.json({ success: true, message: "Fonds libérés avec succès vers le vendeur." });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
