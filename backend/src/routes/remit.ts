import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import logger from '../utils/logger';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const router = Router();

const remitSchema = z.object({
    destinationCountry: z.string().min(2),
    destinationCurrency: z.string().min(3),
    recipientPhone: z.string().min(8),
    amountXaf: z.number().min(100)
});

/**
 * FX Mock Rates for MVP
 */
const FX_RATES: Record<string, number> = {
    'XOF': 1.0, // CFA BEAC -> CFA BCEAO (1:1 parité mais commissions FX)
    'EUR': 0.001524, // 1 XAF = 0.001524 EUR
    'USD': 0.0017
};

router.post('/send', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = remitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { destinationCountry, destinationCurrency, recipientPhone, amountXaf } = parsed.data;
        const rate = FX_RATES[destinationCurrency];

        if (!rate) return res.status(400).json({ error: 'Devise de destination non supportée par notre corridor.' });

        // Retrieve settings for Forex Markup
        const settings = await getSystemSettings();
        const fxMarkup = settings.forexMarkup || 0.025; // default 2.5%

        const fee = amountXaf * fxMarkup;
        const netSourceAmount = amountXaf - fee;
        const destinationAmount = netSourceAmount * rate;

        const sender = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!sender || sender.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte restreint pour l\'international.' });
        }

        if (sender.wallet!.balance < amountXaf) {
            return res.status(400).json({ error: 'Fonds insuffisants pour cet envoi (Frais inclus).' });
        }

        // Atomically lock and transfer
        const result = await prisma.$transaction(async (tx) => {

            // Debit Sender
            await tx.wallet.update({
                where: { id: sender.wallet!.id, balance: { gte: amountXaf } },
                data: { balance: { decrement: amountXaf } }
            });

            // Credit Corporate Treasury for the FX Markup Commission
            const treasury = await tx.systemAccount.findUnique({ where: { kind: 'FEE_COLLECTION' }, include: { wallet: true } });
            if (treasury) {
                await tx.wallet.update({
                    where: { id: treasury.wallet!.id },
                    data: { balance: { increment: fee } }
                });
            }

            // Create Remittance Trace
            const remittance = await tx.remittanceTransaction.create({
                data: {
                    senderId: sender.id,
                    recipientPhone,
                    destinationCountry,
                    sourceAmountXaf: amountXaf,
                    exchangeRate: rate,
                    destinationAmount: destinationAmount,
                    destinationCurrency,
                    fee
                }
            });

            // Standard Transaction Log for Statement
            await tx.transaction.create({
                data: {
                    amount: amountXaf,
                    fee,
                    status: 'COMPLETED',
                    reference: generateReference('REMIT'),
                    senderWalletId: sender.wallet!.id,
                }
            });

            // Notify
            await tx.notification.create({
                data: {
                    userId: sender.id,
                    title: 'Envoi International Réussi',
                    body: `${destinationAmount.toFixed(2)} ${destinationCurrency} expédié vers ${recipientPhone} (${destinationCountry}).`,
                    type: 'TRANSACTION'
                }
            });

            return remittance;
        });

        return res.json({ message: 'L\'envoi Cross-Border a été exécuté avec succès.', data: result });

    } catch (error: any) {
        logger.error(`[Remittance Engine] ${error.message}`);
        return res.status(500).json({ error: 'Erreur réseau internationale.' });
    }
});

export default router;
