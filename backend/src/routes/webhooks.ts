import crypto from 'crypto';
import express from 'express';
import { prisma } from '../prisma';
import { logError } from '../utils/errorLog';
import { getSystemSettings } from './settings';

const router = express.Router();

// PVit (agrégateur de paiement Mobile Money) nous notifie ici du résultat FINAL d'un dépôt
// initié via POST /api/wallet/pull — la réponse immédiate de /pull n'est qu'un accusé
// d'initiation, jamais une confirmation. Cette route est appelée directement par les
// serveurs PVit (pas par nos utilisateurs) : pas de session, protégée par une clé partagée
// dans l'URL puisque PVit ne documente pas de signature de requête.
//
// Règle stricte de leur doc : notre réponse doit échoir dynamiquement transactionId/code —
// jamais une valeur codée en dur — sous peine que PVit considère l'intégration cassée.
router.post('/pvit-status', async (req, res) => {
    const ack = (code: any) => res.status(200).json({ transactionId: req.body?.transactionId, responseCode: code });

    const settings = await getSystemSettings();
    const providedKey = typeof req.query.key === 'string' ? req.query.key : '';
    const expectedKey = settings.pvitWebhookSecret || '';
    // Comparaison à temps constant : une égalité `!==` ordinaire sort dès le premier octet
    // différent, ce qui fuit un signal (marginal mais mesurable) sur la position du premier
    // caractère incorrect. `timingSafeEqual` exige des buffers de même longueur, d'où la
    // vérification de longueur avant l'appel (sinon il lève une exception).
    const keyValid = expectedKey.length > 0
        && providedKey.length === expectedKey.length
        && crypto.timingSafeEqual(Buffer.from(providedKey), Buffer.from(expectedKey));
    if (!keyValid) {
        return res.status(403).json({ error: 'Clé de webhook invalide.' });
    }

    const { merchantReferenceId, status, code } = req.body || {};

    try {
        if (!merchantReferenceId) return ack(code);

        const transaction = await prisma.transaction.findUnique({ where: { reference: merchantReferenceId } });
        // Référence inconnue ou déjà traitée (retry PVit sur une notification déjà reçue) —
        // accuser réception quand même pour ne pas déclencher de nouvelles tentatives.
        if (!transaction || transaction.status !== 'PENDING') return ack(code);

        if (status === 'SUCCESS') {
            await prisma.$transaction(async (tx) => {
                const claim = await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'COMPLETED' } });
                if (claim.count === 0) return;

                if (transaction.type === 'CASH_IN') {
                    // Dépôt : on crédite le destinataire du montant réellement enregistré en
                    // base à l'initiation (/wallet/pull) — jamais un montant fourni par le
                    // payload du webhook externe, qui n'est ni borné ni comparé à ce montant
                    // et permettait de créditer n'importe quelle somme pour un dépôt réel minime.
                    const wallet = await tx.wallet.update({
                        where: { id: transaction.receiverWalletId },
                        data: { balance: { increment: transaction.amount } },
                        include: { user: true }
                    });
                    if (wallet.user) {
                        await tx.notification.create({
                            data: {
                                userId: wallet.user.id,
                                title: 'Dépôt reçu',
                                body: `Votre dépôt Mobile Money de ${transaction.amount.toLocaleString('fr-FR')} FCFA a été crédité.`,
                                type: 'TRANSACTION'
                            }
                        });
                    }
                } else if (transaction.type === 'CASH_OUT') {
                    // Retrait : Déjà débité en PENDING. Si succès, on notifie juste.
                    const wallet = await tx.wallet.findUnique({ where: { id: transaction.senderWalletId! }, include: { user: true } });
                    if (wallet?.user) {
                        await tx.notification.create({
                            data: {
                                userId: wallet.user.id,
                                title: 'Retrait réussi',
                                body: `Votre compte Mobile Money a bien été crédité de ${transaction.amount.toLocaleString('fr-FR')} FCFA.`,
                                type: 'TRANSACTION'
                            }
                        });
                    }
                }
            });
        } else {
            // FAILED
            await prisma.$transaction(async (tx) => {
                const claim = await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'FAILED' } });
                if (claim.count > 0) {
                    if (transaction.type === 'CASH_IN') {
                        const wallet = await tx.wallet.findUnique({ where: { id: transaction.receiverWalletId }, include: { user: true } });
                        if (wallet?.user) {
                            await tx.notification.create({
                                data: {
                                    userId: wallet.user.id,
                                    title: 'Dépôt échoué',
                                    body: `Votre dépôt Mobile Money de ${transaction.amount.toLocaleString('fr-FR')} FCFA a échoué. Réessayez ou contactez le support.`,
                                    type: 'TRANSACTION'
                                }
                            });
                        }
                    } else if (transaction.type === 'CASH_OUT') {
                        // Remboursement de l'argent car le retrait a échoué. La Passerelle avait
                        // été créditée de `amount` à l'initiation (wallet.ts, POST /push) en
                        // contrepartie du débit client — sans cette reprise symétrique, l'échec
                        // remboursait le client SANS jamais reprendre ce crédit passerelle : le
                        // montant existait alors deux fois (chez le client ET dans la Passerelle),
                        // de l'argent électronique créé à partir de rien à chaque retrait Mobile
                        // Money échoué.
                        const gatewayDebit = await tx.wallet.updateMany({
                            where: { id: transaction.receiverWalletId, balance: { gte: transaction.amount } },
                            data: { balance: { decrement: transaction.amount } }
                        });
                        if (gatewayDebit.count === 0) {
                            throw new Error(`Reprise du crédit Passerelle impossible pour ${transaction.reference} (solde insuffisant) — remboursement client annulé, à réessayer.`);
                        }

                        const wallet = await tx.wallet.update({
                            where: { id: transaction.senderWalletId! },
                            data: { balance: { increment: transaction.amount } },
                            include: { user: true }
                        });
                        // Remarques de fraude/sécurité : les frais ne sont pas remboursés
                        // pour l'instant (complexité).
                        if (wallet.user) {
                            await tx.notification.create({
                                data: {
                                    userId: wallet.user.id,
                                    title: 'Retrait échoué',
                                    body: `Le retrait vers votre Mobile Money a échoué. Le montant de ${transaction.amount.toLocaleString('fr-FR')} FCFA a été recrédité sur votre solde.`,
                                    type: 'TRANSACTION'
                                }
                            });
                        }
                    }
                }
            });
        }

        return ack(code);
    } catch (e: any) {
        console.error('Erreur webhook PVit:', e);
        await logError('PVIT_WEBHOOK', e?.message || String(e), { stack: e?.stack, body: req.body }, { path: '/api/webhooks/pvit-status' });
        // Toujours accuser réception même en cas d'erreur interne : sans cet écho, PVit
        // marque l'intégration comme cassée et bloque la validation du compte sandbox.
        return ack(code);
    }
});

export default router;
