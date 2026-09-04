import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';
import { verifyUserPin } from '../utils/pinAuth';
import { getSystemSettings } from './settings';

const router = express.Router();

/**
 * POST /api/split/request
 * Creates a split request targeted at specific phone numbers.
 * The amount is divided equally among the targets by the client, or sent directly.
 * Example body: { totalAmount: 15000, targetPhones: ["+24177000001", "+24177000002"], splitAmountPerPerson: 5000 }
 */
router.post('/request', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { targetPhones, splitAmountPerPerson } = req.body;
        const amount = parseFloat(splitAmountPerPerson);

        if (!targetPhones || !Array.isArray(targetPhones) || targetPhones.length === 0) {
            return res.status(400).json({ error: 'Fournissez au moins un numéro cible.' });
        }
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ error: 'Le montant par personne doit être positif.' });
        }

        const requester = await prisma.user.findUnique({ where: { id: req.userId! } });
        if (!requester) return res.status(403).json({ error: 'Utilisateur introuvable.' });

        const createdRequests = [];

        for (const phone of targetPhones) {
            const cleanPhone = phone.trim();
            if (cleanPhone === requester.phone) continue; // don't split with yourself

            // Check if user exists to link them immediately
            const targetUser = await prisma.user.findUnique({ where: { phone: cleanPhone } });

            const splitReq = await prisma.splitRequest.create({
                data: {
                    amount,
                    requesterId: requester.id,
                    targetPhone: cleanPhone,
                    targetId: targetUser ? targetUser.id : null,
                    status: 'PENDING'
                }
            });
            createdRequests.push(splitReq);
        }

        logger.info(`[Mongain Split] User ${requester.phone} a émis ${createdRequests.length} demandes de ${amount}XAF.`);
        res.json({ message: 'Demandes de partages envoyées avec succès !', requests: createdRequests });
    } catch (e: any) {
        logger.error(`[Mongain Split Request ERREUR] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * GET /api/split/pending
 * Retreives pending splits for the connected user (as target, needing to pay)
 */
router.get('/pending', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId! } });
        if (!user) return res.status(403).json({ error: 'Non autorisé.' });

        // Link any unlinked requests by phone
        await prisma.splitRequest.updateMany({
            where: { targetPhone: user.phone, targetId: null },
            data: { targetId: user.id }
        });

        const pending = await prisma.splitRequest.findMany({
            where: { targetId: user.id, status: 'PENDING' },
            include: { requester: { select: { name: true, phone: true } } },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ pending });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * POST /api/split/pay/:id
 * Pays a specific split request (Debits the active user, credits the requester)
 */
router.post('/pay/:id', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const splitId = req.params.id;
        const { pin } = req.body;

        const payerForPin = await prisma.user.findUnique({ where: { id: req.userId! } });
        if (!payerForPin) return res.status(403).json({ error: 'Utilisateur introuvable.' });
        if (!pin) return res.status(400).json({ error: 'Code PIN requis.' });
        const pinCheck = await verifyUserPin(payerForPin, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const settings = await getSystemSettings();

        await prisma.$transaction(async (tx: any) => {
            const splitReq = await tx.splitRequest.findUnique({
                where: { id: splitId },
                include: { requester: { include: { wallet: true } } }
            });

            if (!splitReq || splitReq.status !== 'PENDING') {
                throw new Error('Demande introuvable ou déjà réglée.');
            }
            if (splitReq.targetId !== req.userId) {
                throw new Error('Vous n\'êtes pas le destinataire de cette demande.');
            }

            const payer = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true }
            });

            if (payer.wallet!.balance < splitReq.amount) {
                throw new Error('Fonds insuffisants pour rembourser cette part.');
            }

            // Anti-blanchiment : ce remboursement est un transfert P2P comme un autre (le
            // payeur débite son wallet vers celui d'un tiers) mais, contrairement à /transfer,
            // /pay/qr-scan, /remit/send et /wallet/push, ne passait par aucun contrôle de
            // plafond KYC — un utilisateur pouvait donc contourner entièrement ses limites de
            // transfert en faisant transiter l'argent par une demande de partage plutôt qu'un
            // transfert classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, payer.id, payer.wallet!.id, splitReq.amount, settings);

            // Transfer Funds — garde atomique `balance: gte` : sans elle, deux requêtes
            // concurrentes sur /pay/:id passent toutes les deux le contrôle de solde ci-dessus
            // avant qu'aucune n'ait décrémenté, permettant un double paiement du même montant.
            await tx.wallet.update({
                where: { id: payer.wallet!.id, balance: { gte: splitReq.amount } },
                data: { balance: { decrement: splitReq.amount } }
            });

            await tx.wallet.update({
                where: { id: splitReq.requester.wallet!.id },
                data: { balance: { increment: splitReq.amount } }
            });

            // Mark Paid
            await tx.splitRequest.update({
                where: { id: splitReq.id },
                data: { status: 'PAID' }
            });

            // Log Transaction
            await tx.transaction.create({
                data: {
                    type: 'SPLIT_REPAYMENT',
                    amount: splitReq.amount,
                    fee: 0,
                    status: 'COMPLETED',
                    senderWalletId: payer.wallet!.id,
                    receiverWalletId: splitReq.requester.wallet!.id,
                    reference: 'SPLIT-' + splitReq.id.substring(0, 8)
                }
            });

            logger.info(`[Mongain Split] User ${payer.phone} a remboursé ${splitReq.amount}XAF.`);
        });

        res.json({ message: 'Partage remboursé avec succès !' });
    } catch (e: any) {
        logger.error(`[Mongain Split Pay ERROR] ${e.message}`);
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
