import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

router.get('/reclamations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!admin || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        const reclamations = await prisma.reclamation.findMany({
            include: { user: { select: { phone: true, name: true } }, assignee: true },
            orderBy: { createdAt: 'desc' },
            take: 100
        });

        res.json(reclamations);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/reclamations/:id/resolve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const reclamation = await prisma.reclamation.update({
            where: { id: req.params.id },
            data: { status: 'CLOSED', closedAt: new Date() }
        });
        res.json({ success: true, reclamation });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
