import { friendlyErrorMessage } from '../utils/errors';
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
        res.status(400).json({ error: friendlyErrorMessage(err) });
    }
});
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const reclamations = await prisma.reclamation.findMany({
            where: { userId: req.userId as string },
            orderBy: { createdAt: 'desc' },
            include: { notes: { where: { isInternal: false }, orderBy: { createdAt: 'asc' } } }
        });
        res.json(reclamations);
    } catch (err: any) {
        res.status(400).json({ error: friendlyErrorMessage(err) });
    }
});

export default router;
