import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { sendPush } from './wallet';

const router = express.Router();

async function loadStaffWithPerm(userId: string | undefined, perm: Parameters<typeof hasPermission>[1]) {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true } });
    if (!staff || !hasPermission(staff, perm)) return null;
    return staff;
}

// ==========================================
// MARKETPLACE C2C — SUPERVISION DES SÉQUESTRES
// ==========================================
// market.ts (POST /buy/:id, POST /escrow/:id/release) ne donne QUE à l'acheteur le pouvoir de
// libérer les fonds vers le vendeur — aucune route, ni côté acheteur ni côté vendeur, ne permet
// jamais de les rendre à l'acheteur. Si l'acheteur ne confirme jamais (litige, objet jamais
// expédié, oubli), les fonds restaient bloqués en séquestre indéfiniment, sans issue pour
// personne : ni le vendeur (jamais payé) ni l'acheteur (jamais remboursé). Ce fichier ajoute la
// lecture (perm_market_view) et une décision manuelle de dernier recours (perm_market_manage),
// même schéma Maker/Checker qu'admin.vaults.ts (force-resolve des retraits de caisse).

router.get('/market/escrow', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_market_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const statusFilter = req.query.status === 'LOCKED' ? 'LOCKED' : undefined;

        const escrows = await prisma.escrowTransaction.findMany({
            where: statusFilter ? { status: statusFilter } : undefined,
            include: {
                listing: { select: { title: true, price: true } },
                buyer: { select: { id: true, name: true, phone: true } },
                seller: { select: { id: true, name: true, phone: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        });

        res.json({ success: true, escrows });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/market/escrow/:id/resolve', authMiddleware, async (req: AuthRequest, res) => {
    const escrowId = req.params.id as string;
    const { decision, reason } = req.body;

    if (decision !== 'RELEASE_TO_SELLER' && decision !== 'REFUND_BUYER') {
        return res.status(400).json({ error: "decision doit être 'RELEASE_TO_SELLER' ou 'REFUND_BUYER'." });
    }
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: 'Indiquez le motif de cette décision (au moins 3 caractères).' });
    }

    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_market_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const result = await prisma.$transaction(async (tx) => {
            const escrow = await tx.escrowTransaction.findUnique({ where: { id: escrowId } });
            if (!escrow) throw new Error('Séquestre introuvable.');
            if (escrow.status !== 'LOCKED') throw new Error('Ce séquestre a déjà été traité.');

            // Réclamation atomique AVANT tout mouvement de fonds — même pattern que
            // admin.vaults.ts force-resolve / treasury.ts approve.
            const claim = await tx.escrowTransaction.updateMany({
                where: { id: escrowId, status: 'LOCKED' },
                data: { status: decision === 'RELEASE_TO_SELLER' ? 'RELEASED' : 'REFUNDED', releasedAt: new Date() }
            });
            if (claim.count === 0) throw new Error('Ce séquestre vient d\'être traité.');

            const escrowWallet = await getSystemAccount('MARKET_ESCROW', tx);

            const beneficiaryId = decision === 'RELEASE_TO_SELLER' ? escrow.sellerId : escrow.buyerId;
            const beneficiary = await tx.user.findUnique({ where: { id: beneficiaryId }, include: { wallet: true } });
            if (!beneficiary?.wallet) throw new Error('Portefeuille du bénéficiaire introuvable.');

            const debited = await tx.wallet.updateMany({
                where: { id: escrowWallet.wallet!.id, balance: { gte: escrow.amount } },
                data: { balance: { decrement: escrow.amount } }
            });
            if (debited.count === 0) throw new Error('Fonds de séquestre introuvables pour ce montant — contactez la Trésorerie.');

            await tx.wallet.update({
                where: { id: beneficiary.wallet.id },
                data: { balance: { increment: escrow.amount } }
            });

            await tx.transaction.create({
                data: {
                    reference: `ESCROW_RESOLVE_${escrow.id.substring(0, 8).toUpperCase()}`,
                    amount: escrow.amount,
                    status: 'COMPLETED',
                    senderWalletId: escrowWallet.wallet!.id,
                    receiverWalletId: beneficiary.wallet.id,
                    fee: 0
                }
            });

            const title = decision === 'RELEASE_TO_SELLER' ? 'Séquestre débloqué en votre faveur' : 'Achat remboursé';
            const body = decision === 'RELEASE_TO_SELLER'
                ? `L'équipe support a tranché en votre faveur : ${escrow.amount.toLocaleString('fr-FR')} FCFA ont été crédités sur votre solde. Motif : ${reason}`
                : `L'équipe support a annulé cette transaction et vous a remboursé ${escrow.amount.toLocaleString('fr-FR')} FCFA. Motif : ${reason}`;
            await tx.notification.create({
                data: { userId: beneficiaryId, title, body, type: 'TRANSACTION' }
            });

            return { title, body, beneficiaryPhone: beneficiary.phone, beneficiaryPushToken: beneficiary.pushToken };
        });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: decision === 'RELEASE_TO_SELLER' ? 'RESOLVE_ESCROW_RELEASE' : 'RESOLVE_ESCROW_REFUND',
                details: `Séquestre ${escrowId} tranché manuellement : ${decision}. Motif : ${reason}`
            }
        });

        await sendPush(result.beneficiaryPushToken, result.title, result.body);
        const io = req.app.get('io');
        if (io) io.to(`user_${result.beneficiaryPhone}`).emit('global_push', { title: result.title, body: result.body });

        res.json({ success: true });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

export default router;
