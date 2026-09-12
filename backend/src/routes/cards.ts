import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import logger from '../utils/logger';
import { getSystemSettings } from './settings';
import { notifyParentOfChildSpend } from './wallet';

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
// Le numéro/CVV sont générés localement (Math.random()) — aucun réseau Visa/Mastercard ni
// processeur de cartes n'est connecté, cette "carte" ne fonctionnerait chez aucun marchand
// réel. Désactivé tant qu'un émetteur de cartes réel n'est pas intégré. `/fund` est désactivé
// pour la même raison juste en dessous — voir docs/AUTO_CRITIQUE_PROJET.md.
router.post('/issue', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CARDS !== 'true') {
        return res.status(501).json({
            error: 'Les cartes virtuelles nécessitent une intégration réelle avec un émetteur de cartes. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId! },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte restreint ou inexistant.' });
        }

        // Restriction Comptes Enfant : l'émission d'une carte virtuelle ne fait pas partie des
        // fonctionnalités approuvées pour un compte enfant. Garde SÉPARÉE du flag
        // ENABLE_UNVERIFIED_CARDS ci-dessus : le jour où cette fonctionnalité sera activée pour
        // de vrais utilisateurs, un compte enfant doit rester bloqué — le mobile masque déjà le
        // bouton correspondant, mais un masquage d'UI seul n'est jamais une garantie de sécurité.
        if (user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });

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
    if (process.env.ENABLE_UNVERIFIED_CARDS !== 'true') {
        return res.status(501).json({
            error: 'Les cartes virtuelles nécessitent une intégration réelle avec un émetteur de cartes. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const { amount, pin } = req.body;
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Montant invalide.' });

        const cardId = String(req.params.id);
        const card = await prisma.virtualCard.findUnique({ where: { id: cardId }, include: { fundingWallet: true, user: true } });
        if (!card || card.userId !== req.userId) return res.status(404).json({ error: 'Carte introuvable.' });
        if (card.status !== 'ACTIVE') return res.status(403).json({ error: 'Carte inactive ou bloquée.' });

        // Restriction Comptes Enfant : même raisonnement que /issue ci-dessus — garde SÉPARÉE
        // du flag ENABLE_UNVERIFIED_CARDS, pour qu'un compte enfant reste bloqué même une fois
        // cette fonctionnalité activée pour de vrais utilisateurs. Le mobile masque déjà le
        // bouton correspondant, mais seul ce contrôle serveur constitue une vraie barrière.
        if (card.user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });

        if (!pin) return res.status(400).json({ error: 'Code PIN requis.' });
        const pinCheck = await verifyUserPin(card.user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        if (!card.fundingWallet || card.fundingWallet.balance < parsedAmount) {
            return res.status(400).json({ error: 'Fonds insuffisants dans votre portefeuille.' });
        }

        const settings = await getSystemSettings();

        // Atomically transfer value from wallet to card balance
        const updatedCard = await prisma.$transaction(async (tx: any) => {
            await LimitEngine.verifyAndIncrementConsumption(tx, req.userId!, card.fundingWalletId, parsedAmount, settings);

            const w = await tx.wallet.update({
                where: { id: card.fundingWalletId, balance: { gte: parsedAmount } },
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

        await notifyParentOfChildSpend(req.userId!, parsedAmount, 'rechargement de carte virtuelle');

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

        // BLOCKED = gel d'urgence posé par le back-office (admin.ts PUT /cards/:id/freeze,
        // perm_customer_freeze), distinct de FROZEN (pause volontaire du titulaire) : sans
        // cette distinction, ce toggle client basculait sur le MÊME statut que l'admin, et
        // le titulaire d'une carte gelée pour fraude suspectée pouvait se re-débloquer
        // lui-même en rappelant cette route.
        if (card.status === 'BLOCKED') {
            return res.status(403).json({ error: 'Cette carte a été bloquée par notre équipe sécurité. Contactez le support pour la débloquer.' });
        }

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
