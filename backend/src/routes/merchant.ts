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

        const todaySales = await prisma.transaction.aggregate({
            where: { receiverWalletId: user.wallet!.id, createdAt: { gte: today }, status: 'COMPLETED' },
            _sum: { amount: true },
            _count: { id: true }
        });

        const allTimeSales = await prisma.transaction.aggregate({
            where: { receiverWalletId: user.wallet!.id, status: 'COMPLETED' },
            _sum: { amount: true }
        });

        return res.json({
            balance: user.wallet!.balance,
            todaySalesAmount: todaySales._sum.amount || 0,
            todaySalesCount: todaySales._count.id || 0,
            allTimeSalesAmount: allTimeSales._sum.amount || 0
        });

    } catch (error: any) {
        return res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
    }
});

export default router;
