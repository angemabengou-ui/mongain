import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

// Mock FX Rates (Base: XAF)
const MULTIPLIERS: Record<string, number> = {
    EUR: 0.001524,
    USD: 0.00161,
    XOF: 1.0,
    NGN: 1.25
};

/**
 * POST /api/remit/quote
 * Calcul du taux de change en direct et simulation d'envoi
 */
router.post('/quote', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { targetCurrency, amountXaf } = req.body;
        const amount = parseFloat(amountXaf);

        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide.' });
        if (!MULTIPLIERS[targetCurrency]) return res.status(400).json({ error: 'Devise non supportée.' });

        const rate = MULTIPLIERS[targetCurrency];
        const converted = amount * rate;

        // Mongain takes a 1.5% cross-border fee
        const fee = amount * 0.015;
        const totalToDebit = amount + fee;

        res.json({
            rate,
            convertedAmount: converted.toFixed(2),
            fee: fee.toFixed(2),
            totalToDebit: totalToDebit.toFixed(2),
            targetCurrency
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * POST /api/remit/send
 * Exécute formellement un envoi international depuis le wallet d'origine
 */
router.post('/send', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { targetCurrency, amountXaf, targetAccount } = req.body;
        const amount = parseFloat(amountXaf);

        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide.' });
        if (!targetAccount) return res.status(400).json({ error: 'Un compte destinataire international est requis (IBAN/Téléphone).' });

        const rate = MULTIPLIERS[targetCurrency];
        if (!rate) throw new Error('Devise inconnue');

        await prisma.$transaction(async (tx: any) => {
            const payer = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true }
            });

            if (!payer) throw new Error('Expéditeur introuvable.');

            const fee = amount * 0.015;
            const totalToDebit = amount + fee;

            if (payer.wallet!.balance < totalToDebit) {
                throw new Error(`Solde insuffisant. Coût total (avec 1.5% frais) : ${totalToDebit} XAF`);
            }

            // Débit de l'utilisateur
            await tx.wallet.update({
                where: { id: payer.wallet!.id },
                data: { balance: { decrement: totalToDebit } }
            });

            // Envoi des frais au Corporate
            const feesAcc = await tx.systemAccount.findUnique({ where: { role: 'FEES_COLLECTION' } });
            if (feesAcc) {
                await tx.wallet.update({
                    where: { id: feesAcc.walletId! },
                    data: { balance: { increment: fee } }
                });
            }

            // Historisation (Départ vers l'international)
            await tx.transaction.create({
                data: {
                    type: 'CASH_OUT', // External remittance is technically a structural cash-out
                    amount: amount,
                    fee: fee,
                    status: 'COMPLETED',
                    senderWalletId: payer.wallet!.id,
                    reference: 'REMIT-' + Date.now() + '-' + targetCurrency
                }
            });

            logger.info(`[Mongain Remit] ${payer.phone} a envoyé ${amount} XAF vers la devise ${targetCurrency} (${targetAccount}). Frais: ${fee} XAF.`);
        });

        res.json({ message: 'Le transfert international a été initié et est en cours d\'acheminement vers la passerelle SWIFT/SEPA locale.' });
    } catch (e: any) {
        logger.error(`[Mongain Remit ERROR] ${e.message}`);
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
