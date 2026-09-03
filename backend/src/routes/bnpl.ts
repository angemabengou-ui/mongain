import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = Router();

// ==========================================
// V17: Buy Now Pay Later (BNPL & Micro-Credit)
// ==========================================

const MAX_BNPL_AMOUNT = 50000;
const DEFAULT_BNPL_INTEREST = 0.05; // 5% flat fee de repli si non configuré côté admin

router.post('/apply', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amountXaf, months, pin } = req.body;
        const requestedAmount = parseFloat(amountXaf);
        const duration = parseInt(months);

        if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > MAX_BNPL_AMOUNT) {
            return res.status(400).json({ error: `Montant BNPL invalide. Maximum autorisé: ${MAX_BNPL_AMOUNT} F.` });
        }
        if (isNaN(duration) || duration < 1 || duration > 4) {
            return res.status(400).json({ error: "Durée d'amortissement BNPL invalide (1 à 4 mois max)." });
        }
        if (!pin) return res.status(400).json({ error: "Code PIN requis" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE' || !user.wallet) return res.status(403).json({ error: "Impossible d'emprunter sur ce compte." });

        if (user.kycLevel < 1) {
            return res.status(403).json({ error: "Validation KYC Premium requise pour débloquer le crédit." });
        }

        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        // Check existing BNPL debt
        const existingDebt = await prisma.bnplContract.findFirst({
            where: { userId: user.id, status: 'ACTIVE' }
        });

        if (existingDebt) {
            return res.status(400).json({ error: "Vous devez rembourser votre dette BNPL en cours avant d'emprunter à nouveau." });
        }

        const settings = await getSystemSettings();
        const bnplInterest = settings.bnplInterest || DEFAULT_BNPL_INTEREST;
        const fee = requestedAmount * bnplInterest;
        const totalOwed = requestedAmount + fee;

        const nextPayment = new Date();
        nextPayment.setMonth(nextPayment.getMonth() + 1);

        await prisma.$transaction(async (tx) => {
            // Plafonds AML/KYC — l'octroi d'un crédit était le seul mouvement de fonds de ce
            // fichier à ne passer par aucun contrôle de plafond.
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, requestedAmount, settings);

            // Unify Treasury provider
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });
            if (!treasury) throw new Error("Les fonds de la trésorerie centrale sont inaccessibles.");
            if (treasury.wallet.balance < requestedAmount) throw new Error("Réserve système insuffisante.");

            // Create Debt Contract
            await tx.bnplContract.create({
                data: {
                    userId: user.id,
                    totalAmount: totalOwed,
                    remaining: totalOwed,
                    months: duration,
                    nextPaymentDate: nextPayment,
                    status: 'ACTIVE'
                }
            });

            // Disbursement
            await tx.wallet.update({
                where: { id: treasury.wallet.id, balance: { gte: requestedAmount } },
                data: { balance: { decrement: requestedAmount } }
            });

            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: requestedAmount } }
            });

            await tx.transaction.create({
                data: {
                    type: 'SYSTEM',
                    amount: requestedAmount,
                    status: 'COMPLETED',
                    reference: generateReference('BNPL_IN'),
                    fee: 0,
                    senderWalletId: treasury.wallet.id,
                    receiverWalletId: user.wallet!.id
                }
            });

            await tx.notification.create({
                data: {
                    userId: user.id,
                    title: 'Crédit BNPL Approuvé',
                    body: `Félicitations, votre avance de ${requestedAmount} FCFA a été virée. Reste à devoir: ${totalOwed} FCFA.`,
                    type: 'SYSTEM'
                }
            });
        });

        await sendPush(user.pushToken, 'Crédit BNPL Approuvé', `Félicitations, votre avance de ${requestedAmount} FCFA a été virée. Reste à devoir: ${totalOwed} FCFA.`);

        res.status(201).json({ success: true, message: "Micro-crédit BNPL débloqué !", amount: requestedAmount });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

// BNPL Repay
router.post('/repay', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amountXaf, pin } = req.body;
        const repayAmount = parseFloat(amountXaf);

        if (isNaN(repayAmount) || repayAmount <= 0) return res.status(400).json({ error: "Montant invalide" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || !user.wallet) return res.status(403).json({ error: "Validation échouée" });

        // Vérifié AVANT d'entrer dans la transaction : un `return res.status(...)` depuis
        // l'intérieur du callback `$transaction` ne l'interrompt pas (il ne fait que résoudre
        // la promesse interne avec l'objet Response) — le code après continuait de s'exécuter
        // et renvoyait une seconde réponse HTTP (`ERR_HTTP_HEADERS_SENT`) même après un PIN refusé.
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        // Atomic Repay
        await prisma.$transaction(async (tx) => {
            const debt = await tx.bnplContract.findFirst({
                where: { userId: user.id, status: 'ACTIVE' }
            });
            if (!debt) throw new Error("Aucune dette BNPL active.");

            const effectiveRepay = Math.min(repayAmount, debt.remaining);

            if (user.wallet!.balance < effectiveRepay) throw new Error("Solde insuffisant pour le remboursement.");

            // Pull to Treasury
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });

            await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: effectiveRepay } },
                data: { balance: { decrement: effectiveRepay } }
            });

            await tx.wallet.update({
                where: { id: treasury!.wallet.id },
                data: { balance: { increment: effectiveRepay } }
            });

            await tx.transaction.create({
                data: {
                    type: 'SYSTEM',
                    amount: effectiveRepay,
                    status: 'COMPLETED',
                    reference: generateReference('BNPL_OUT'),
                    fee: 0,
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: treasury!.wallet.id
                }
            });

            // Amortization tracking
            const newRemaining = debt.remaining - effectiveRepay;
            await tx.bnplContract.update({
                where: { id: debt.id },
                data: {
                    remaining: newRemaining,
                    status: newRemaining <= 0 ? 'CLOSED' : 'ACTIVE'
                }
            });
        });

        res.json({ success: true, message: "Remboursement enregistré." });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
