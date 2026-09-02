import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

// Créer une réclamation (Mobile client)
router.post('/reclamation', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { title, description } = req.body;
        if (!title || !description) return res.status(400).json({ error: "Titre et description requis." });

        const reclamation = await prisma.reclamation.create({
            data: {
                userId: req.userId!,
                title,
                description,
                status: 'OPEN'
            }
        });

        res.status(201).json({ success: true, reclamation });
    } catch (e: any) {
        res.status(500).json({ error: e.message || 'Erreur interne' });
    }
});

// Liste des réclamations de l'utilisateur
router.get('/my', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const reclamations = await prisma.reclamation.findMany({
            where: { userId: req.userId },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, reclamations });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
