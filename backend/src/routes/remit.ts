import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { notifyParentOfChildSpend, sendPush } from './wallet';

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

        // fxMarkup inclus : le client (remit.tsx) affichait jusqu'ici un pourcentage codé en
        // dur ("Frais (1.5%)") qui ne correspondait déjà pas au défaut réel (2,5%), et
        // divergeait plus encore dès qu'un admin ajustait forexMarkup depuis Settings — le
        // montant `fee` en XAF restait, lui, toujours correct (calculé ici), seul le
        // libellé de pourcentage affiché était faux.
        res.json({ convertedAmount, targetCurrency: destinationCurrency, rate, fee, fxMarkup, totalToDebit: amountXaf });
    } catch (e: any) {
        logger.error(`[Remittance Quote] ${e.message}`);
        res.status(500).json({ error: 'Erreur de cotation.' });
    }
});

// Aucun partenaire de transfert/paiement à l'étranger n'est connecté (FX_RATES ci-dessus est
// un "Mock... for MVP") : envoyer débite réellement le client, mais rien ne part jamais vers
// la destination annoncée — l'écran mobile affiche pourtant "Transféré ! Fonds expédiés..."
// Désactivé tant qu'un partenaire réel n'est pas intégré (voir aussi les contraintes BEAC/
// CEMAC sur les transferts internationaux par un acteur non-bancaire, docs/AUTO_CRITIQUE_PROJET.md).
router.post('/send', authMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_REMIT !== 'true') {
        return res.status(501).json({
            error: 'La remise internationale nécessite une intégration réelle avec un partenaire de transfert. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const parsed = remitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const { destinationCountry, destinationCurrency, recipientPhone, amountXaf, pin } = parsed.data;
        const rate = FX_RATES[destinationCurrency];

        if (!rate) return res.status(400).json({ error: 'Devise de destination non supportée par notre corridor.' });

        // Retrieve settings for Forex Markup
        const settings = await getSystemSettings();
        const fxMarkup = settings.forexMarkup || 0.025; // default 2.5%

        // Même formule que /quote ci-dessus (Math.round(amountXaf * fxMarkup)) — les deux
        // divergeaient auparavant (/quote arrondissait, /send non), ce qui pouvait faire
        // débiter un frais différent de celui annoncé au client avant confirmation.
        const fee = Math.round(amountXaf * fxMarkup);
        const netSourceAmount = amountXaf - fee;
        const destinationAmount = netSourceAmount * rate;

        const sender = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!sender || sender.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ error: 'Compte restreint pour l\'international.' });
        }

        // Restriction Comptes Enfant : l'envoi d'argent à l'international ne fait pas partie
        // des fonctionnalités approuvées pour un compte enfant. Garde SÉPARÉE du flag
        // ENABLE_UNVERIFIED_REMIT ci-dessus, pour qu'un compte enfant reste bloqué même une fois
        // cette fonctionnalité activée pour de vrais utilisateurs. Le mobile masque déjà le
        // bouton correspondant, mais un masquage d'UI seul n'est jamais une garantie de sécurité.
        if (sender.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });

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
        await notifyParentOfChildSpend(sender.id, amountXaf, `envoi international vers ${destinationCountry}`);

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
