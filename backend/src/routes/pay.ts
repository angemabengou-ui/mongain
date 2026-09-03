import express from 'express';
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

const router = express.Router();

/**
 * POST /api/pay/qr-scan
 * Used by Merchants to scan a customer's QR code and pull funds.
 * In this mock, the QR code contains the customer's User ID.
 */
router.post('/qr-scan', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { scannedCode, amountXaf, pin } = req.body;
        const amount = parseFloat(amountXaf);

        if (!scannedCode) return res.status(400).json({ error: 'QR Code invalide.' });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Montant invalide.' });
        if (scannedCode === req.userId) return res.status(400).json({ error: 'Auto-paiement impossible.' });
        if (!pin || typeof pin !== 'string') return res.status(400).json({ error: 'Code PIN du client requis pour autoriser le paiement.' });

        const merchantId = req.userId!;

        // Le PIN appartient au CLIENT débité, pas au marchand qui scanne — sans ce contrôle,
        // n'importe quel compte authentifié pouvait prélever n'importe quel montant sur
        // n'importe quel wallet dont il connaissait juste l'ID (transmis en clair dans le QR),
        // sans aucune autorisation du titulaire. Vérifié hors transaction (comme /transfer) :
        // un rollback effacerait aussi l'enregistrement de la tentative échouée.
        const customerPreCheck = await prisma.user.findUnique({ where: { id: scannedCode } });
        if (!customerPreCheck || customerPreCheck.accountStatus !== 'ACTIVE') {
            return res.status(400).json({ error: 'Compte client introuvable ou restreint.' });
        }
        const pinCheck = await verifyUserPin(customerPreCheck, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const settings = await getSystemSettings();

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
            if (!customer || !customer.wallet || customer.accountStatus !== 'ACTIVE') throw new Error('Compte client introuvable ou restreint.');

            if (customer.wallet.balance < amount) {
                throw new Error('Le client ne dispose pas des fonds suffisants.');
            }

            // Anti-blanchiment : mêmes paliers KYC/plafonds que /transfer, /push et
            // /client-initiated-withdraw — absents ici jusqu'à présent, ce qui permettait de
            // contourner entièrement les limites KYC en payant par QR marchand plutôt que par
            // un transfert classique.
            await LimitEngine.verifyAndIncrementConsumption(tx, customer.id, customer.wallet.id, amount, settings);

            // 3. Frais configurables (taxP2P), à la place du taux fixe à 1% qui ignorait tout
            // changement de taux décidé depuis l'admin (Settings.tsx > Politique de Frais).
            const fee = Math.round(amount * (settings?.taxP2P ?? 0.01));
            const netAmount = amount - fee;

            // Debit Customer — garde atomique (balance: gte) : le contrôle ci-dessus lit une
            // balance non verrouillée, donc deux scans concurrents du même QR client
            // passeraient tous deux ce contrôle et pourraient faire passer le solde en négatif
            // (même classe de bug déjà corrigée sur /transfer, /push, executeCashOut...).
            await tx.wallet.update({
                where: { id: customer.wallet.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Credit Merchant net amount
            await tx.wallet.update({
                where: { id: merchant.wallet!.id },
                data: { balance: { increment: netAmount } }
            });

            // Credit Corporate fee — remplace la recherche par `role: 'FEES_COLLECTION'`, un
            // champ qui n'existe pas sur SystemAccount (seul `kind` est la clé unique, et aucun
            // kind "FEES_COLLECTION" n'est défini dans systemAccounts.ts) : cette requête levait
            // une erreur Prisma ("Unknown argument `role`") qui faisait échouer TOUT paiement
            // marchand QR — la fonctionnalité était entièrement cassée, pas seulement privée
            // de revenu.
            if (fee > 0) {
                const corporate = await getSystemAccount('CORPORATE', tx);
                await tx.wallet.update({ where: { id: corporate.wallet.id }, data: { balance: { increment: fee } } });
            }

            // Log Transaction (MERCHANT_PAYMENT)
            await tx.transaction.create({
                data: {
                    type: 'MERCHANT_PAYMENT',
                    amount, // Total gross amount
                    fee,
                    status: 'COMPLETED',
                    senderWalletId: customer.wallet.id,
                    receiverWalletId: merchant.wallet!.id,
                    reference: generateReference('QRPAY'),
                }
            });

            // Notifications — même raisonnement que /transfer : sans elles, ni le client ni le
            // marchand n'ont de trace de ce paiement dans leur onglet Notifications.
            await tx.notification.create({
                data: { userId: customer.id, title: 'Paiement effectué', body: `Vous avez payé ${amount.toLocaleString('fr-FR')} FCFA chez ${merchant.name}.`, type: 'TRANSACTION' }
            });
            await tx.notification.create({
                data: { userId: merchant.id, title: 'Paiement reçu', body: `Vous avez reçu ${netAmount.toLocaleString('fr-FR')} FCFA (frais retenus : ${fee.toLocaleString('fr-FR')} FCFA).`, type: 'TRANSACTION' }
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
