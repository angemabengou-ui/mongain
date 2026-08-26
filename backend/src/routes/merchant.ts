import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import { startOfDayInTimezone } from '../utils/timezone';
import { getSystemSettings } from './settings';

const router = express.Router();

async function loadMerchant(userId: string | undefined) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true, commissionWallet: true } });
    if (!user || user.role !== 'MERCHANT') return null;
    return user;
}

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        // Minuit dans le fuseau configuré (Africa/Libreville par défaut, UTC+1), pas minuit
        // heure serveur (UTC sur Render) — sinon une vente entre 00h00 et 00h59 heure locale
        // gabonaise disparaissait de "todaySales" jusqu'au lendemain (comptée sur J-1 côté UTC).
        const settings = await getSystemSettings();
        const today = startOfDayInTimezone(settings?.timezone || 'Africa/Libreville');

        const salesFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { not: { startsWith: 'REWARD-' } } };

        // La commission part désormais sur commissionWallet (voir wallet.ts /client-initiated-withdraw
        // et merchantService.ts). Repli sur l'ancien filtre REWARD- (wallet principal) pour les
        // commissions historiques créditées avant cette séparation, sinon elles disparaîtraient
        // des totaux "all-time" du jour au lendemain.
        const legacyRewardFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { startsWith: 'REWARD-' } };
        const commissionFilter = user.commissionWallet ? { receiverWalletId: user.commissionWallet.id, status: 'COMPLETED' } : null;

        const [todaySales, allTimeSales, todayLegacyRewards, allTimeLegacyRewards, todayCommission, allTimeCommission] = await Promise.all([
            prisma.transaction.aggregate({ where: { ...salesFilter, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.transaction.aggregate({ where: salesFilter, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: { ...legacyRewardFilter, createdAt: { gte: today } }, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: legacyRewardFilter, _sum: { amount: true } }),
            commissionFilter ? prisma.transaction.aggregate({ where: { ...commissionFilter, createdAt: { gte: today } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: 0 } }),
            commissionFilter ? prisma.transaction.aggregate({ where: commissionFilter, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: 0 } })
        ]);

        return res.json({
            balance: user.wallet!.balance,
            commissionBalance: user.commissionWallet?.balance || 0,
            todaySalesAmount: todaySales._sum.amount || 0,
            todaySalesCount: todaySales._count.id || 0,
            allTimeSalesAmount: allTimeSales._sum.amount || 0,
            todayCommission: (todayLegacyRewards._sum.amount || 0) + (todayCommission._sum.amount || 0),
            allTimeCommission: (allTimeLegacyRewards._sum.amount || 0) + (allTimeCommission._sum.amount || 0)
        });

    } catch (error: any) {
        return res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.get('/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const category = (req.query.category as string) || undefined;
        const walletIds = category === 'COMMISSION'
            ? [user.commissionWallet?.id].filter(Boolean) as string[]
            : category === 'SALES'
                ? [user.wallet!.id]
                : [user.wallet!.id, user.commissionWallet?.id].filter(Boolean) as string[];

        const txs = await prisma.transaction.findMany({
            where: {
                OR: walletIds.flatMap(id => [{ receiverWalletId: id }, { senderWalletId: id }])
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } } } }
            }
        });

        res.json(txs);
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// Nouveau flux de retrait dédié — le marchand demande à sortir de l'argent de l'un de ses
// deux soldes ; le débit réel n'a lieu qu'à l'exécution côté staff (admin.merchants.ts),
// pas ici (ce contrôle est purement informatif, pour éviter une demande manifestement
// impossible dès la saisie).
router.post('/payouts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const { sourceAccount, amount, note } = req.body;
        if (sourceAccount !== 'SALES' && sourceAccount !== 'COMMISSION') {
            return res.status(400).json({ error: "sourceAccount doit être 'SALES' ou 'COMMISSION'." });
        }
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }

        const available = sourceAccount === 'SALES' ? (user.wallet?.balance || 0) : (user.commissionWallet?.balance || 0);
        if (parsedAmount > available) {
            return res.status(400).json({ error: 'Solde insuffisant sur le compte sélectionné.' });
        }

        const payout = await prisma.merchantPayoutRequest.create({
            data: {
                merchantId: user.id,
                sourceAccount,
                amount: parsedAmount,
                note: note ? String(note).trim() : null
            }
        });

        res.json({ success: true, data: payout });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.get('/payouts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const payouts = await prisma.merchantPayoutRequest.findMany({
            where: { merchantId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(payouts);
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

export default router;
