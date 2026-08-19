import express from 'express';
import { prisma } from '../prisma';

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

    if (!process.env.PVIT_WEBHOOK_SECRET || req.query.key !== process.env.PVIT_WEBHOOK_SECRET) {
        return res.status(403).json({ error: 'Clé de webhook invalide.' });
    }

    const { merchantReferenceId, status, code, amountCredited } = req.body || {};

    try {
        if (!merchantReferenceId) return ack(code);

        const transaction = await prisma.transaction.findUnique({ where: { reference: merchantReferenceId } });
        // Référence inconnue ou déjà traitée (retry PVit sur une notification déjà reçue) —
        // accuser réception quand même pour ne pas déclencher de nouvelles tentatives.
        if (!transaction || transaction.status !== 'PENDING') return ack(code);

        if (status === 'SUCCESS') {
            await prisma.$transaction(async (tx) => {
                // Réclamation atomique : si un retry concurrent a déjà traité cette même
                // notification entre le findUnique ci-dessus et maintenant, count === 0.
                const claim = await tx.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'COMPLETED' } });
                if (claim.count === 0) return;

                const wallet = await tx.wallet.update({
                    where: { id: transaction.receiverWalletId },
                    data: { balance: { increment: amountCredited ?? transaction.amount } },
                    include: { user: true }
                });
                if (wallet.user) {
                    await tx.notification.create({
                        data: {
                            userId: wallet.user.id,
                            title: 'Dépôt reçu',
                            body: `Votre dépôt Mobile Money de ${(amountCredited ?? transaction.amount).toLocaleString('fr-FR')} FCFA a été crédité.`,
                            type: 'TRANSACTION'
                        }
                    });
                }
            });
        } else {
            const claim = await prisma.transaction.updateMany({ where: { id: transaction.id, status: 'PENDING' }, data: { status: 'FAILED' } });
            if (claim.count > 0) {
                const wallet = await prisma.wallet.findUnique({ where: { id: transaction.receiverWalletId }, include: { user: true } });
                if (wallet?.user) {
                    await prisma.notification.create({
                        data: {
                            userId: wallet.user.id,
                            title: 'Dépôt échoué',
                            body: `Votre dépôt Mobile Money de ${transaction.amount.toLocaleString('fr-FR')} FCFA a échoué. Réessayez ou contactez le support.`,
                            type: 'TRANSACTION'
                        }
                    });
                }
            }
        }

        return ack(code);
    } catch (e) {
        console.error('Erreur webhook PVit:', e);
        // Toujours accuser réception même en cas d'erreur interne : sans cet écho, PVit
        // marque l'intégration comme cassée et bloque la validation du compte sandbox.
        return ack(code);
    }
});

export default router;
