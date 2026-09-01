import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

/**
 * GET /api/loyalty/balance
 * Returns the exact loyalty balance of the active user.
 */
router.get('/balance', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId! },
            select: { loyaltyPoints: true }
        });
        if (!user) return res.status(403).json({ error: 'Utilisateur introuvable.' });
        res.json({ points: user.loyaltyPoints });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * POST /api/loyalty/convert
 * Converts Mongain Points to XAF. (Ratio: 10 MP = 1 XAF, meaning 1,000 MP = 100 XAF)
 */
router.post('/convert', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { pointsToConvert } = req.body;
        const points = parseInt(pointsToConvert);

        if (isNaN(points) || points <= 0) return res.status(400).json({ error: 'Montant de points invalide.' });

        await prisma.$transaction(async (tx: any) => {
            const user = await tx.user.findUnique({
                where: { id: req.userId! },
                include: { wallet: true }
            });

            if (!user) throw new Error('Utilisateur introuvable.');
            if (user.loyaltyPoints < points) throw new Error(`Points insuffisants. Vous avez ${user.loyaltyPoints} MP.`);

            const xafEquiv = points / 10; // 10:1 ratio

            // Deduct Points
            await tx.user.update({
                where: { id: user.id },
                data: { loyaltyPoints: { decrement: points } }
            });

            // Credit User Wallet
            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: xafEquiv } }
            });

            // Debit Corporate Fees Engine (for accounting)
            const sys = await tx.systemAccount.findUnique({ where: { role: 'FEES_COLLECTION' } });
            if (sys) {
                await tx.systemAccount.update({
                    where: { id: sys.id },
                    data: { balance: { decrement: xafEquiv } } // we "burn" collected fees to give rewards
                });
            }

            // Create Transaction Log
            await tx.transaction.create({
                data: {
                    type: 'CASHBACK_REWARD',
                    amount: xafEquiv,
                    fee: 0,
                    status: 'COMPLETED',
                    receiverWalletId: user.wallet!.id,
                    reference: 'MP-REWARD-' + Date.now()
                }
            });

            logger.info(`[Mongain Rewards] User ${req.userId} converted ${points} MP -> ${xafEquiv} XAF.`);
        });

        res.json({ message: 'Conversion réussie !' });
    } catch (e: any) {
        logger.error(`[Mongain Rewards Convert Error] ${e.message}`);
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * POST /api/loyalty/simulate-earn
 * ONLY FOR DEMO PURPOSES (To let the user test gaining points)
 */
router.post('/simulate-earn', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        await prisma.user.update({
            where: { id: req.userId! },
            data: { loyaltyPoints: { increment: 5000 } }
        });
        res.json({ message: '5,000 MP réclamés avec succès !' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
