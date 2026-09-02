import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const fraudCases = await prisma.fraudCase.findMany({
            include: { user: { select: { phone: true, name: true } }, assignee: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(fraudCases);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.put('/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { status, decision } = req.body;
        const fraudCase = await prisma.fraudCase.update({
            where: { id: req.params.id },
            data: {
                status,
                decision,
                closedAt: status === 'CLOSED' ? new Date() : null
            }
        });
        res.json({ success: true, fraudCase });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
