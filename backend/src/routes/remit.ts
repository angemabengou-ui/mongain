import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = Router();

const remitSchema = z.object({
    destinationCountry: z.string().min(2),
    destinationCurrency: z.string().min(3),
    recipientPhone: z.string().min(8),
    amountXaf: z.number().min(100),
    pin: z.string().min(4)
});

/**
 * FX Mock Rates for MVP
 */
const FX_RATES: Record<string, number> = {
    'XOF': 1.0, // CFA BEAC -> CFA BCEAO (1:1 parité mais commissions FX)
    'EUR': 0.001524, // 1 XAF = 0.001524 EUR
    'USD': 0.0017
};

const quoteSchema = z.object({
    destinationCurrency: z.string().min(3),
    amountXaf: z.coerce.number().min(100)
});

// POST /api/remit/quote — cotation sans mouvement de fonds, calculée avec la même formule
// (fxMarkup, FX_RATES) que /send, pour que le montant affiché à l'écran ne diverge jamais
// de celui réellement débité.
router.post('/quote', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = quoteSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { destinationCurrency, amountXaf } = parsed.data;
        const rate = FX_RATES[destinationCurrency];
        if (!rate) return res.status(400).json({ error: 'Devise de destination non supportée par notre corridor.' });

        const settings = await getSystemSettings();
        const fxMarkup = settings.forexMarkup || 0.025;
        const fee = Math.round(amountXaf * fxMarkup);
        const netSourceAmount = amountXaf - fee;
        const convertedAmount = Number((netSourceAmount * rate).toFixed(2));

        res.json({ convertedAmount, targetCurrency: destinationCurrency, rate, fee, totalToDebit: amountXaf });
    } catch (e: any) {
        logger.error(`[Remittance Quote] ${e.message}`);
        res.status(500).json({ error: 'Erreur de cotation.' });
    }
});

router.post('/send', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = remitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { destinationCountry, destinationCurrency, recipientPhone, amountXaf, pin } = parsed.data;
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

        const pinCheck = await verifyUserPin(sender, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        if (sender.wallet!.balance < amountXaf) {
            return res.status(400).json({ error: 'Fonds insuffisants pour cet envoi (Frais inclus).' });
        }

        // Atomically lock and transfer
        const result = await prisma.$transaction(async (tx) => {
            // Plafonds AML/KYC — le corridor le plus sensible en blanchiment transfrontalier
            // ne peut pas être le seul rail financier à ne pas y passer.
            await LimitEngine.verifyAndIncrementConsumption(tx, sender.id, sender.wallet!.id, amountXaf, settings);

            // Debit Sender
            await tx.wallet.update({
                where: { id: sender.wallet!.id, balance: { gte: amountXaf } },
                data: { balance: { decrement: amountXaf } }
            });

            // Credit Corporate (compte de revenus — même compte que les autres commissions
            // de la plateforme, cf. bnpl.ts/credit.ts) pour la commission de change.
            const treasury = await getSystemAccount('CORPORATE', tx);
            await tx.wallet.update({
                where: { id: treasury.wallet!.id },
                data: { balance: { increment: fee } }
            });

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
                    receiverWalletId: treasury.wallet!.id
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

        await sendPush(sender.pushToken, 'Envoi International Réussi', `${destinationAmount.toFixed(2)} ${destinationCurrency} expédié vers ${recipientPhone} (${destinationCountry}).`);

        return res.json({ message: 'L\'envoi Cross-Border a été exécuté avec succès.', data: result });

    } catch (error: any) {
        logger.error(`[Remittance Engine] ${error.message}`);
        // Le message réel (plafond AML dépassé, solde insuffisant détecté dans la transaction,
        // course perdue sur la garde atomique...) était toujours remplacé par un "Erreur réseau
        // internationale." générique en 500 — l'utilisateur n'avait aucune indication de la
        // vraie cause d'un rejet métier, présenté à tort comme une panne serveur.
        return res.status(400).json({ error: friendlyErrorMessage(error, 'Erreur réseau internationale.') });
    }
});

export default router;
