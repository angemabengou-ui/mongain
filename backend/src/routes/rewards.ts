import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';

const router = Router();

const POINT_CONVERSION_RATE = 10; // 1 point = 10 FCFA

// Get Loyalty Points Balance
router.get('/balance', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { loyaltyPoints: true } // V11 Schema already has this
        });

        if (!user) return res.status(404).json({ error: "User not found" });

        res.json({ success: true, loyaltyPoints: user.loyaltyPoints, conversionRate: POINT_CONVERSION_RATE });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Redeem Loyalty Points to Wallet
router.post('/redeem', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { pointsToRedeem } = req.body;

        const pts = parseInt(pointsToRedeem);
        if (isNaN(pts) || pts <= 0) {
            return res.status(400).json({ error: "Montant de points invalide." });
        }

        // Atomic redemption transaction
        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: req.userId! },
                include: { wallet: true }
            });

            if (!user || user.loyaltyPoints < pts) {
                throw new Error("Solde de points de fidélité insuffisant.");
            }

            if (!user.wallet) {
                throw new Error("Portefeuille introuvable.");
            }

            const cashValue = pts * POINT_CONVERSION_RATE;

            // Reduce points
            await tx.user.update({
                where: { id: user.id },
                data: { loyaltyPoints: { decrement: pts } }
            });

            // Increase wallet balance
            await tx.wallet.update({
                where: { id: user.wallet.id },
                data: { balance: { increment: cashValue } }
            });

            // Log Transaction
            const ref = `REWARD_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await tx.transaction.create({
                data: {
                    amount: cashValue,
                    status: 'COMPLETED',
                    reference: ref,
                    receiverWalletId: user.wallet.id,
                    fee: 0,
                    // Note: senderWalletId is generally null for System Rewards in Mongain, wait, some systems mandate senderWallet.
                    // If System Mints the money, let's pull from Central Treasury to not artificially inflate currency.
                }
            });

            return cashValue;
        });

        res.json({ success: true, message: `Points convertis ! +${result} FCFA crédités.`, amount: result });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

export default router;
