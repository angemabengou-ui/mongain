import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { getOrCreateCorporateWallet, sendPush } from './wallet';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

async function loadStaffWithPerm(userId: string | undefined, perm: Parameters<typeof hasPermission>[1]) {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
    if (!staff || !hasPermission(staff, perm)) return null;
    return staff;
}

// ==========================================
// MARCHANDS — LECTURE + SUPERVISION DES RETRAITS
// ==========================================
// Jusqu'ici, aucune vue de supervision n'existait pour les comptes marchands — le staff
// n'avait aucun moyen d'inspecter le solde ventes/commission d'un marchand ni de traiter
// une demande de retrait, puisque ce flux n'existait pas non plus. Ce fichier ajoute la
// lecture (perm_merchant_view) et le traitement des demandes de retrait (perm_merchant_manage) :
// approuver (exécute le mouvement de fonds) ou rejeter (motif obligatoire).

router.get('/merchants', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_merchant_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const merchants = await prisma.user.findMany({
            where: { role: 'MERCHANT' },
            select: {
                id: true, name: true, phone: true, createdAt: true,
                wallet: { select: { balance: true } },
                commissionWallet: { select: { balance: true } },
                _count: { select: { merchantPayoutRequests: { where: { status: 'PENDING' } } } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ merchants });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/merchants/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_merchant_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const merchant = await prisma.user.findUnique({
            where: { id: req.params.id as string },
            select: {
                id: true, name: true, phone: true, createdAt: true, role: true,
                wallet: { select: { id: true, balance: true } },
                commissionWallet: { select: { id: true, balance: true } },
                merchantPayoutRequests: {
                    orderBy: { createdAt: 'desc' },
                    include: { processedBy: { select: { name: true } } }
                }
            }
        });
        if (!merchant || merchant.role !== 'MERCHANT') return res.status(404).json({ error: 'Marchand introuvable.' });

        const walletIds = [merchant.wallet?.id, merchant.commissionWallet?.id].filter(Boolean) as string[];
        const transactions = await prisma.transaction.findMany({
            where: { OR: walletIds.flatMap(id => [{ receiverWalletId: id }, { senderWalletId: id }]) },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } } } }
            }
        });

        res.json({ merchant, transactions, canManage: hasPermission(staff, 'perm_merchant_manage') });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/merchants/:id/payouts/:payoutId/approve', authMiddleware, async (req: AuthRequest, res) => {
    const payoutId = req.params.payoutId as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_merchant_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const result = await prisma.$transaction(async (tx) => {
            const payout = await tx.merchantPayoutRequest.findUnique({ where: { id: payoutId } });
            if (!payout || payout.merchantId !== (req.params.id as string)) throw new Error('Demande introuvable.');
            if (payout.status !== 'PENDING') throw new Error('Cette demande a déjà été traitée.');

            // Réclamation atomique AVANT tout mouvement de fonds — même pattern que
            // admin.vaults.ts (force-resolve) et treasury.ts (approve).
            const claim = await tx.merchantPayoutRequest.updateMany({
                where: { id: payoutId, status: 'PENDING' },
                data: { status: 'EXECUTED', processedById: staff.id, executedAt: new Date() }
            });
            if (claim.count === 0) throw new Error('Cette demande vient d\'être traitée.');

            const merchant = await tx.user.findUnique({ where: { id: payout.merchantId }, include: { wallet: true, commissionWallet: true } });
            if (!merchant?.wallet) throw new Error('Portefeuille principal du marchand introuvable.');

            if (payout.sourceAccount === 'COMMISSION') {
                if (!merchant.commissionWallet) throw new Error('Ce marchand ne possède pas encore de solde commission.');
                const debited = await tx.wallet.updateMany({
                    where: { id: merchant.commissionWallet.id, balance: { gte: payout.amount } },
                    data: { balance: { decrement: payout.amount } }
                });
                if (debited.count === 0) throw new Error('Solde commission insuffisant pour ce retrait.');

                await tx.wallet.update({ where: { id: merchant.wallet.id }, data: { balance: { increment: payout.amount } } });

                await tx.transaction.create({
                    data: {
                        amount: payout.amount,
                        senderWalletId: merchant.commissionWallet.id,
                        receiverWalletId: merchant.wallet.id,
                        status: 'COMPLETED',
                        reference: `MPAYOUT-${payout.id}`
                    }
                });
            } else {
                // SALES : l'argent sort du grand livre électronique — le staff/l'agence
                // effectue le versement externe réel (même logique que TreasuryRequest
                // RETURN/ADJUSTMENT, qui ne déclenchent aucun appel de passerelle externe).
                // receiverWalletId est obligatoire sur Transaction (pas de sender-only) : le
                // wallet corporate sert de compte de compensation pour les sorties externes,
                // réellement crédité ici (pas qu'une ligne d'audit) pour que la comptabilité
                // reste équilibrée en partie double — sa balance représente alors le total des
                // fonds sortis du ledger électronique via ce circuit, en attente de
                // rapprochement physique, pas un gain réel de la plateforme.
                const debited = await tx.wallet.updateMany({
                    where: { id: merchant.wallet.id, balance: { gte: payout.amount } },
                    data: { balance: { decrement: payout.amount } }
                });
                if (debited.count === 0) throw new Error('Solde ventes insuffisant pour ce retrait.');

                const corporate = await getOrCreateCorporateWallet(tx);
                await tx.wallet.update({ where: { id: corporate.wallet.id }, data: { balance: { increment: payout.amount } } });

                await tx.transaction.create({
                    data: {
                        amount: payout.amount,
                        senderWalletId: merchant.wallet.id,
                        receiverWalletId: corporate.wallet.id,
                        status: 'COMPLETED',
                        reference: `MPAYOUT-${payout.id}`
                    }
                });
            }

            const notifTitle = 'Retrait marchand exécuté';
            const notifBody = `Votre demande de ${payout.amount.toLocaleString('fr-FR')} FCFA (${payout.sourceAccount === 'COMMISSION' ? 'commission' : 'ventes'}) a été traitée.`;
            await tx.notification.create({
                data: { userId: payout.merchantId, title: notifTitle, body: notifBody, type: 'TRANSACTION' }
            });

            return { ...payout, merchantPhone: merchant.phone, merchantPushToken: merchant.pushToken, notifTitle, notifBody };
        });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'APPROVE_MERCHANT_PAYOUT', details: `Retrait marchand ${payoutId} (${result.sourceAccount}, ${result.amount} FCFA) approuvé et exécuté.` }
        });

        // Le marchand attend souvent cette décision sans avoir l'app ouverte — la ligne en
        // base seule ne le prévenait qu'à sa prochaine visite de l'onglet Notifications.
        await sendPush(result.merchantPushToken, result.notifTitle, result.notifBody);
        const io = req.app.get('io');
        if (io) io.to(`user_${result.merchantPhone}`).emit('global_push', { title: result.notifTitle, body: result.notifBody });

        res.json({ success: true });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

router.post('/merchants/:id/payouts/:payoutId/reject', authMiddleware, async (req: AuthRequest, res) => {
    const payoutId = req.params.payoutId as string;
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: 'Indiquez le motif du rejet (au moins 3 caractères).' });
    }

    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_merchant_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const payout = await prisma.merchantPayoutRequest.findUnique({ where: { id: payoutId } });
        if (!payout || payout.merchantId !== (req.params.id as string)) return res.status(404).json({ error: 'Demande introuvable.' });
        if (payout.status !== 'PENDING') return res.status(400).json({ error: 'Cette demande a déjà été traitée.' });

        const claim = await prisma.merchantPayoutRequest.updateMany({
            where: { id: payoutId, status: 'PENDING' },
            data: { status: 'REJECTED', rejectionReason: String(reason).trim(), processedById: staff.id, executedAt: new Date() }
        });
        if (claim.count === 0) return res.status(400).json({ error: 'Cette demande vient d\'être traitée.' });

        const notifTitle = 'Retrait marchand rejeté';
        const notifBody = `Votre demande de ${payout.amount.toLocaleString('fr-FR')} FCFA a été rejetée : ${reason}`;
        await prisma.notification.create({
            data: { userId: payout.merchantId, title: notifTitle, body: notifBody, type: 'TRANSACTION' }
        });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'REJECT_MERCHANT_PAYOUT', details: `Retrait marchand ${payoutId} rejeté. Motif : ${reason}` }
        });

        const merchant = await prisma.user.findUnique({ where: { id: payout.merchantId }, select: { phone: true, pushToken: true } });
        await sendPush(merchant?.pushToken, notifTitle, notifBody);
        const io = req.app.get('io');
        if (io && merchant) io.to(`user_${merchant.phone}`).emit('global_push', { title: notifTitle, body: notifBody });

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
