import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const riskFlags = await prisma.riskFlag.findMany({
            include: { user: { select: { phone: true, name: true, kycStatus: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, riskFlags });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
