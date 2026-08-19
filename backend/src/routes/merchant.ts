import { friendlyErrorMessage } from '../utils/errors';
import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'MERCHANT') return res.status(403).json({ error: 'Accès refusé.' });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Les ventes réelles ont une `reference` normale ; REWARD-xxx est l'enregistrement
        // de la commission elle-même (voir wallet.ts /client-initiated-withdraw) et ne doit
        // pas être compté deux fois comme une vente.
        const salesFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { not: { startsWith: 'REWARD-' } } };
        const rewardFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { startsWith: 'REWARD-' } };

        const [todaySales, allTimeSales, todayRewards, allTimeRewards] = await Promise.all([
            prisma.transaction.aggregate({ where: { ...salesFilter, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.transaction.aggregate({ where: salesFilter, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: { ...rewardFilter, createdAt: { gte: today } }, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: rewardFilter, _sum: { amount: true } })
        ]);

        return res.json({
            balance: user.wallet!.balance,
            todaySalesAmount: todaySales._sum.amount || 0,
            todaySalesCount: todaySales._count.id || 0,
            allTimeSalesAmount: allTimeSales._sum.amount || 0,
            todayCommission: todayRewards._sum.amount || 0,
            allTimeCommission: allTimeRewards._sum.amount || 0
        });

    } catch (error: any) {
        return res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.get('/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || user.role !== 'MERCHANT') return res.status(403).json({ error: 'Accès refusé.' });

        const txs = await prisma.transaction.findMany({
            where: {
                OR: [
                    { receiverWalletId: user.wallet!.id },
                    { senderWalletId: user.wallet!.id }
                ]
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

export default router;
