import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

router.post('/', authMiddleware, async (req: AuthRequest, res) => {
    const { title, description } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Titre et description requis.' });

    try {
        const rec = await prisma.reclamation.create({
            data: {
                userId: req.userId as string,
                title,
                description,
            }
        });
        res.json({ success: true, reclamation: rec });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let reclamations;
        // Si l'utilisateur est ADMIN, il voit tout. Sinon, que les siennes.
        if (user.role === 'ADMIN') {
            reclamations = await prisma.reclamation.findMany({
                orderBy: { createdAt: 'desc' },
                include: { user: { select: { phone: true, name: true } } }
            });
        } else {
            reclamations = await prisma.reclamation.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: 'desc' }
            });
        }
        res.json(reclamations);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

router.patch('/:id/close', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (!user || user.role !== 'ADMIN') return res.status(403).json({ error: 'Accès refusé' });

        const rec = await prisma.reclamation.update({
            where: { id: req.params.id as string },
            data: { status: 'CLOSED' }
        });
        res.json({ success: true, reclamation: rec });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

export default router;
