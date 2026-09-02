import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

// Get Admin System Accounts (Corporate, Fee, Treasury, Escrow)
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'ADMIN', 'TREASURER'].includes(admin.role)) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const accounts = await prisma.systemAccount.findMany({
            include: { wallet: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json(accounts);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
