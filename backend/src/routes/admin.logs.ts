import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

router.get('/errors', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const logs = await prisma.errorLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });

        res.json(logs);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
