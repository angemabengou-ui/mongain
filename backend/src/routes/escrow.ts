import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import logger from '../utils/logger';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const router = Router();

const createSchema = z.object({
    sellerPhone: z.string().min(8),
    amount: z.number().min(500),
    description: z.string().min(5).max(255)
});

// Create Escrow (Buyer initiates)
router.post('/create', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { sellerPhone, amount, description } = parsed.data;

        if (amount < 1000) return res.status(400).json({ error: 'Montant minimum 1000 CFA pour sécuriser un paiement.' });

        const buyer = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        const seller = await prisma.user.findFirst({ where: { phone: sellerPhone }, include: { wallet: true } });

        if (!buyer || !buyer.wallet) return res.status(401).json({ error: 'Compte invalide.' });
        if (!seller || !seller.wallet) return res.status(404).json({ error: 'Le vendeur spécifié est introuvable.' });
        if (buyer.id === seller.id) return res.status(400).json({ error: 'Vous ne pouvez pas sécuriser un paiement envers vous-même.' });

        const settings = await getSystemSettings();
        // Frais d'escrow: 2% au lieu du 1% classique
        const fee = amount * 0.02;
        const totalDebit = amount + fee;

        if (buyer.wallet.balance < totalDebit) return res.status(400).json({ error: `Fonds insuffisants. Total requis: ${totalDebit} FCFA.` });

        // Limit Engine Check 
        await LimitEngine.verifyAndIncrementConsumption(null, buyer.id, buyer.wallet.id, amount, settings);

        const releaseCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits

        const escrow = await prisma.$transaction(async (tx) => {
            // Debit Buyer
            await tx.wallet.update({
                where: { id: buyer.wallet!.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });

            // Credit Corporate (Fee)
            const treasury = await tx.systemAccount.findUnique({ where: { kind: 'FEE_COLLECTION' }, include: { wallet: true } });
            let corpId = treasury?.wallet?.id || seller.wallet!.id;
            if (treasury) {
                await tx.wallet.update({ where: { id: treasury.walletId }, data: { balance: { increment: fee } } });
            }

            // Create Escrow
            const record = await tx.escrowContract.create({
                data: {
                    buyerId: buyer.id,
                    sellerId: seller.id,
                    amount,
                    fee,
                    itemDescription: description,
                    releaseCode,
                    status: 'LOCKED'
                }
            });

            // Log Transaction (Deduct from wallet, technically goes into Escrow Custody)
            await tx.transaction.create({
                data: {
                    amount,
                    fee,
                    status: 'COMPLETED', // Transaction to escrow is complete
                    reference: generateReference('ESCROW_LOCK'),
                    senderWalletId: buyer.wallet!.id,
                    receiverWalletId: corpId,
                }
            });

            await tx.notification.createMany({
                data: [
                    { userId: buyer.id, title: 'Séquestre Créé', body: `Paiement protégé de ${amount} CFA créé. Communiquez le code ${releaseCode} au livreur uniquement à réception.`, type: 'TRANSACTION' },
                    { userId: seller.id, title: 'Fonds Bloqués', body: `Un paiement sécurisé de ${amount} CFA a été bloqué pour vous. Livrez l'article pour réclamer vos fonds.`, type: 'TRANSACTION' }
                ]
            });

            return record;
        });

        res.status(201).json({ success: true, escrow, releaseCode });
    } catch (e: any) {
        logger.error(`[Escrow Create] ${e.message}`);
        res.status(500).json({ error: e.message || 'Erreur lors de la sécurisation des fonds.' });
    }
});

// Release Escrow (Seller inputs the code or Buyer releases manually)
router.post('/release/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { releaseCode } = req.body;
        const escrowRefId = req.params.id as string;

        const escrow: any = await prisma.escrowContract.findUnique({
            where: { id: escrowRefId },
            include: { buyer: { include: { wallet: true } }, seller: { include: { wallet: true } } }
        });

        if (!escrow) return res.status(404).json({ error: 'Contrat séquestre introuvable.' });
        if (escrow.status !== 'LOCKED') return res.status(400).json({ error: `Ce paiement est déjà au statut ${escrow.status}.` });

        // If Caller is Seller, he must provide correct code. Next to that, Buyer can just force release without code.
        const isBuyerEnforcing = escrow.buyer.id === req.userId;
        const isSellerClaiming = escrow.seller.id === req.userId;

        if (!isBuyerEnforcing && !isSellerClaiming) return res.status(403).json({ error: 'Vous ne participez pas à cette transaction.' });
        if (isSellerClaiming && escrow.releaseCode !== releaseCode) {
            return res.status(401).json({ error: 'Code de déblocage invalide.' });
        }

        await prisma.$transaction(async (tx) => {
            // Give Money to Seller
            await tx.wallet.update({
                where: { id: escrow.seller.wallet!.id },
                data: { balance: { increment: escrow.amount } }
            });

            // Update State
            await tx.escrowContract.update({
                where: { id: escrow.id },
                data: { status: 'RELEASED' }
            });

            // Log Delivery Tx
            await tx.transaction.create({
                data: {
                    amount: escrow.amount,
                    fee: 0,
                    status: 'COMPLETED',
                    reference: generateReference('ESCROW_REL'),
                    receiverWalletId: escrow.seller.wallet!.id
                }
            });

            await tx.notification.create({
                data: { userId: escrow.seller.id, title: 'Paiement Escrow Débloqué', body: `Votre paiement protégé de ${escrow.amount} CFA vient d'être crédité !`, type: 'TRANSACTION' }
            });
        });

        res.json({ success: true, message: 'Fonds débloqués vers le marchand avec succès.' });
    } catch (e: any) {
        logger.error(`[Escrow Release] ${e.message}`);
        res.status(500).json({ error: 'Erreur lors du déblocage.' });
    }
});

// Fetch my Escrows
router.get('/my', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const bought = await prisma.escrowContract.findMany({ where: { buyerId: req.userId }, include: { seller: { select: { phone: true, name: true } } }, orderBy: { createdAt: 'desc' } });
        const sold = await prisma.escrowContract.findMany({ where: { sellerId: req.userId }, include: { buyer: { select: { phone: true, name: true } } }, orderBy: { createdAt: 'desc' } });
        res.json({ bought, sold });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur.' });
    }
});

export default router;
