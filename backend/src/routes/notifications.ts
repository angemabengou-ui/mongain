import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

// GET /api/notifications
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const notifs = await (prisma as any).notification.findMany({
            where: { userId: req.userId },
            orderBy: { createdAt: 'desc' },
            take: 30
        });
        res.json(notifs);
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau' });
    }
});

// GET /api/notifications/unread-count
router.get('/unread-count', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const count = await (prisma as any).notification.count({
            where: { userId: req.userId, isRead: false }
        });
        res.json({ count });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau' });
    }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', authMiddleware, async (req: AuthRequest, res) => {
    try {
        await (prisma as any).notification.updateMany({
            where: { id: req.params.id, userId: req.userId },
            data: { isRead: true }
        });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau' });
    }
});

// PUT /api/notifications/read-all
router.put('/read-all', authMiddleware, async (req: AuthRequest, res) => {
    try {
        await (prisma as any).notification.updateMany({
            where: { userId: req.userId, isRead: false },
            data: { isRead: true }
        });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur réseau' });
    }
});

export default router;
