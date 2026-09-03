import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = Router();

// ==========================================
// V17: UTILITY BILLERS (Facturiers SEEG/CANAL)
// ==========================================

router.post('/pay', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { provider, reference, amountXaf, pin } = req.body;
        const amount = parseFloat(amountXaf);

        if (!provider || !['SEEG', 'CANAL'].includes(provider)) {
            return res.status(400).json({ error: "Fournisseur invalide" });
        }
        if (!reference || reference.length < 5) return res.status(400).json({ error: "Numéro abonné invalide" });
        if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: "Montant invalide" });
        if (!pin) return res.status(400).json({ error: "Code PIN requis" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE' || !user.wallet) {
            return res.status(403).json({ error: "Compte restreint" });
        }

        // Contrôle centralisé (verrouillage 3 échecs) — un bcrypt.compare nu ici n'avait
        // aucune limite de tentatives, rendant l'espace à 4 chiffres du PIN brute-forçable.
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });
        if (user.wallet.balance < amount) return res.status(400).json({ error: "Solde insuffisant" });

        const settings = await getSystemSettings();

        await prisma.$transaction(async (tx) => {
            // Limits Verification
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, amount, settings);

            // Partner Corporate System Account Binding
            const partnerSystem = await getSystemAccount(`SERVICE_PARTNER_${provider}` as any, tx);

            // Double-Entry Debit
            await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Reconcile on Partner System
            await tx.wallet.update({
                where: { id: partnerSystem.wallet.id },
                data: { balance: { increment: amount } }
            });

            const ref = generateReference('BILL');

            await tx.transaction.create({
                data: {
                    reference: ref,
                    type: 'BILL_PAYMENT',
                    amount,
                    status: 'COMPLETED',
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: partnerSystem.wallet.id,
                    fee: 0
                }
            });

            // Store Biller explicit traces
            await tx.billerTransaction.create({
                data: {
                    userId: user.id,
                    provider,
                    reference,
                    amount,
                    status: 'COMPLETED'
                }
            });

            await tx.notification.create({
                data: {
                    userId: user.id,
                    title: 'Facture Payée',
                    body: `Rechargement ${provider} de ${amount} FCFA validé.`,
                    type: 'SYSTEM'
                }
            });
        });

        await sendPush(user.pushToken, 'Facture Payée', `Rechargement ${provider} de ${amount} FCFA validé.`);

        res.json({ success: true, message: `Rechargement ${provider} effectué.` });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
