import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

// GET /api/wallet/cards
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const cards = await prisma.virtualCard.findMany({
            where: { userId: req.userId },
            orderBy: { id: 'desc' }
        });
        res.json(cards);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/wallet/cards/issue
router.post('/issue', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId! },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte restreint ou inexistant.' });
        }

        // Logic to generate unique 16 digit card number
        let cardNumber = '';
        let isUnique = false;
        while (!isUnique) {
            cardNumber = '4' + Math.floor(100000000000000 + Math.random() * 900000000000000).toString();
            const existing = await prisma.virtualCard.findUnique({ where: { cardNumber } });
            if (!existing) isUnique = true;
        }

        const cvv = Math.floor(100 + Math.random() * 900).toString();
        const date = new Date();
        date.setFullYear(date.getFullYear() + 3);
        const expiryDate = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear().toString().slice(-2)}`;

        const card = await prisma.virtualCard.create({
            data: {
                userId: user.id,
                fundingWalletId: user.wallet!.id,
                cardNumber,
                cvv,
                expiryDate,
                spendingLimit: 50000 // default 50k XAF
            }
        });

        res.json(card);
    } catch (e: any) {
        logger.error(`[Card Issue Error] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/wallet/cards/:id/fund
router.post('/:id/fund', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { amount } = req.body;
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Montant invalide.' });

        const cardId = String(req.params.id);
        const card = await prisma.virtualCard.findUnique({ where: { id: cardId }, include: { fundingWallet: true, user: true } });
        if (!card || card.userId !== req.userId) return res.status(404).json({ error: 'Carte introuvable.' });
        if (card.status !== 'ACTIVE') return res.status(403).json({ error: 'Carte inactive ou bloquée.' });

        if (!card.fundingWallet || card.fundingWallet.balance < parsedAmount) {
            return res.status(400).json({ error: 'Fonds insuffisants dans votre portefeuille.' });
        }

        // Atomically transfer value from wallet to card balance
        const updatedCard = await prisma.$transaction(async (tx: any) => {
            const w = await tx.wallet.update({
                where: { id: card.fundingWalletId },
                data: { balance: { decrement: parsedAmount } }
            });
            const c = await tx.virtualCard.update({
                where: { id: card.id },
                data: { balance: { increment: parsedAmount } }
            });
            // Record internal transaction trace
            await tx.transaction.create({
                data: {
                    type: 'TRANSFER',
                    amount: parsedAmount,
                    status: 'COMPLETED',
                    senderWalletId: w.id,
                    receiverWalletId: w.id, // Internal flow
                    reference: 'VC-FUND-' + Date.now()
                }
            });
            return c;
        });

        res.json(updatedCard);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PUT /api/wallet/cards/:id/freeze
router.put('/:id/freeze', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const cardId = String(req.params.id);
        const card = await prisma.virtualCard.findUnique({ where: { id: cardId } });
        if (!card || card.userId !== req.userId) return res.status(404).json({ error: 'Carte introuvable.' });

        const newStatus = card.status === 'ACTIVE' ? 'FROZEN' : 'ACTIVE';
        const updated = await prisma.virtualCard.update({
            where: { id: card.id },
            data: { status: newStatus }
        });
        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
