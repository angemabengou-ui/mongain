import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const refundRequests = await prisma.refundRequest.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(refundRequests);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/:id/execute', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const refund = await prisma.refundRequest.update({
            where: { id: req.params.id },
            data: { status: 'EXECUTED' }
        });
        res.json({ success: true, refund });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
