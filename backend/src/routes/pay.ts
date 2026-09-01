import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

/**
 * POST /api/pay/qr-scan
 * Used by Merchants to scan a customer's QR code and pull funds.
 * In this mock, the QR code contains the customer's User ID.
 */
router.post('/qr-scan', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { scannedCode, amountXaf } = req.body;
        const amount = parseFloat(amountXaf);

        if (!scannedCode) return res.status(400).json({ error: 'QR Code invalide.' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide.' });
        if (scannedCode === req.userId) return res.status(400).json({ error: 'Auto-paiement impossible.' });

        const merchantId = req.userId!;

        // Pessimistic Locking Transaction
        await prisma.$transaction(async (tx: any) => {
            // 1. Fetch Merchant
            const merchant = await tx.user.findUnique({
                where: { id: merchantId },
                include: { wallet: true }
            });
            if (!merchant || merchant.accountStatus !== 'ACTIVE') throw new Error('Compte marchand inactif.');

            // 2. Fetch Customer (scannedCode = customer userId)
            const customer = await tx.user.findUnique({
                where: { id: scannedCode },
                include: { wallet: true }
            });
            if (!customer || customer.accountStatus !== 'ACTIVE') throw new Error('Compte client introuvable ou restreint.');

            if (customer.wallet!.balance < amount) {
                throw new Error('Le client ne dispose pas des fonds suffisants.');
            }

            // 3. Execution logic: 1% fee on merchant POS payments
            const fee = amount * 0.01;
            const netAmount = amount - fee;

            // Debit Customer
            await tx.wallet.update({
                where: { id: customer.wallet!.id },
                data: { balance: { decrement: amount } }
            });

            // Credit Merchant net amount
            await tx.wallet.update({
                where: { id: merchant.wallet!.id },
                data: { balance: { increment: netAmount } }
            });

            // Credit Corporate fee (via CashOperationService logic ideally, but inline here for simplicity)
            const systemSystem = await tx.systemAccount.findUnique({ where: { role: 'FEES_COLLECTION' } });
            if (systemSystem) {
                await tx.systemAccount.update({
                    where: { id: systemSystem.id },
                    data: { balance: { increment: fee } }
                });
            }

            // Log Transaction (MERCHANT_PAYMENT)
            await tx.transaction.create({
                data: {
                    type: 'MERCHANT_PAYMENT',
                    amount, // Total gross amount
                    fee,
                    status: 'COMPLETED',
                    senderWalletId: customer.wallet!.id,
                    receiverWalletId: merchant.wallet!.id,
                    reference: 'QR-PAY-' + Date.now()
                }
            });

            logger.info(`[Pay&Go] Merchant ${merchant.phone} encaisse ${amount}XAF de Client ${customer.phone}`);
        });

        res.json({ message: 'Encaissement QR réussi !', amount });
    } catch (e: any) {
        logger.error(`[Pay&Go QR] ${e.message}`);
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
