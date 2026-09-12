import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { notifyParentOfChildSpend, sendPush } from './wallet';

const router = Router();

// ==========================================
// V17: UTILITY BILLERS (Facturiers SEEG/CANAL)
// ==========================================

// Anti-abus sur ce rail de paiement (même raisonnement que wallet.ts moneyMovementLimiter) :
// keyGenerator PAR COMPTE, pas par IP par défaut, pour ne pas pénaliser collectivement les
// nombreux comptes distincts partageant la même IP publique (CGNAT des opérateurs mobiles
// gabonais). 30 requêtes/15 min couvre largement l'usage réel d'un client payant ses factures.
const moneyMovementLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => (req as AuthRequest).userId || 'anonymous',
    message: { error: 'Trop de paiements de factures en peu de temps. Veuillez réessayer plus tard.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Aucune intégration réelle avec SEEG/Canal+ n'existe : cette route ne fait que débiter le
// client et créditer un compte interne factice ("service partenaire") tout en affichant un
// faux succès — l'argent quitte vraiment le solde du client sans que rien ne se passe
// réellement côté SEEG/Canal+. Même garde que services.ts (/pay-bill, /topup) — CE
// GARDE-FOU MANQUAIT ICI, ce qui débitait déjà réellement les clients pour un service jamais
// livré, contrairement à la route sœur qui reste désactivée pour la même raison.
router.post('/pay', authMiddleware, moneyMovementLimiter, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES !== 'true') {
        return res.status(501).json({
            error: 'Le paiement de factures nécessite une intégration réelle avec le fournisseur (SEEG/Canal+). Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { provider, reference, amountXaf, pin, idempotencyKey } = req.body;
        // Le FCFA n'a aucune sous-unité (voir docs/AUTO_CRITIQUE_PROJET.md) — arrondi ici,
        // sinon l'écriture Prisma échoue sur un montant décimal soumis par le client.
        const amount = Math.round(parseFloat(amountXaf));

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

        const isNew = await prisma.$transaction(async (tx) => {
            // Idempotence : un double-tap ou un retry réseau avec la même idempotencyKey ne
            // doit JAMAIS re-débiter le client pour une seule facture payée — sans ce garde,
            // un simple problème réseau côté mobile pouvait lui faire payer la même facture
            // deux fois. Vérifié avant toute lecture/écriture (même convention que
            // CashOperationService.executeCashIn).
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return false;
            }

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
                    fee: 0,
                    idempotencyKey
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
            return true;
        });

        // Notifications sautées pour un rejeu idempotent (isNew === false) : déjà envoyées
        // lors du tout premier passage de cette idempotencyKey.
        if (isNew) {
            await sendPush(user.pushToken, 'Facture Payée', `Rechargement ${provider} de ${amount} FCFA validé.`);
            await notifyParentOfChildSpend(user.id, amount, `facture ${provider}`);
        }

        res.json({ success: true, message: `Rechargement ${provider} effectué.` });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
