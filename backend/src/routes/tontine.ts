import express, { Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { executeTontineCycle } from '../services/tontineService';

const router = express.Router();

// Créer un groupe de Tontine
router.post('/create', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { name, contribution, frequency } = req.body;

        if (!name || !contribution) {
            return res.status(400).json({ success: false, message: "Nom et contribution requis." });
        }

        const group = await prisma.tontineGroup.create({
            data: {
                name,
                contribution: parseFloat(contribution),
                frequency: frequency || 'MONTHLY',
                status: 'ACTIVE'
            }
        });

        // Le créateur rejoint automatiquement le groupe
        await prisma.tontineParticipant.create({
            data: {
                userId,
                tontineGroupId: group.id,
                payoutOrder: 1
            }
        });

        res.json({ success: true, message: "Club créé avec succès.", data: group });
    } catch (error: any) {
        console.error("Erreur création Tontine:", error);
        res.status(500).json({ success: false, message: error.message || "Erreur serveur" });
    }
});

// Récupérer toutes les tontines disponibles et celles rejointes par l'utilisateur
router.get('/groups', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;

        // Groupes existants
        const groups = await prisma.tontineGroup.findMany({
            where: { status: 'ACTIVE' },
            include: {
                _count: {
                    select: { participants: true }
                }
            }
        });

        // Participations de l'utilisateur
        const myParticipations = await prisma.tontineParticipant.findMany({
            where: { userId },
            include: { group: true }
        });

        res.json({
            success: true,
            data: {
                groups,
                myParticipations
            }
        });
    } catch (error: any) {
        console.error("Erreur récupération Tontine:", error);
        res.status(500).json({ success: false, message: error.message || "Erreur serveur" });
    }
});

// Rejoindre un club de Tontine
router.post('/join', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        if (!groupId) {
            return res.status(400).json({ success: false, message: "ID de la tontine requis." });
        }

        // Vérifier si le groupe existe
        const group = await prisma.tontineGroup.findUnique({ where: { id: groupId } });
        if (!group || group.status !== 'ACTIVE') {
            return res.status(404).json({ success: false, message: "Groupe introuvable ou inactif." });
        }

        // Vérifier si l'utilisateur y est déjà
        const existing = await prisma.tontineParticipant.findFirst({
            where: { userId, tontineGroupId: groupId }
        });
        if (existing) {
            return res.status(400).json({ success: false, message: "Vous participez déjà à cette Tontine." });
        }

        // Rejoindre
        const count = await prisma.tontineParticipant.count({ where: { tontineGroupId: groupId } });
        const participant = await prisma.tontineParticipant.create({
            data: {
                userId,
                tontineGroupId: groupId,
                payoutOrder: count + 1 // Ordre de passage
            }
        });

        // Notifier l'utilisateur
        await prisma.notification.create({
            data: {
                userId,
                title: "Tontine rejointe 🤝",
                body: `Vous avez rejoint le club ${group.name}. Votre cotisation est de ${group.contribution} FCFA par cycle.`,
                type: "INFO"
            }
        });

        res.json({ success: true, message: "Vous avez rejoint la tontine avec succès.", data: participant });
    } catch (error: any) {
        console.error("Erreur Tontine join:", error);
        res.status(500).json({ success: false, message: error.message || "Erreur serveur" });
    }
});

// Simuler le prélèvement d'un cycle (Appelé par une Tâche CRON ou un Admin)
router.post('/debit/:groupId', authMiddleware, async (req: Request, res: Response) => {
    try {
        const adminId = (req as AuthRequest).userId!;
        const adminUser = await prisma.user.findUnique({ where: { id: adminId } });

        if (!adminUser || adminUser.role !== 'ADMIN') {
            return res.status(403).json({ success: false, message: "Accès refusé" });
        }

        const groupId = req.params.groupId as string;
        const result = await executeTontineCycle(groupId);

        if (!result || !result.success) {
            return res.status(404).json({ success: false, message: "Groupe introuvable" });
        }

        res.json({
            success: true,
            message: `Cycle ${result.currentCycle} exécuté. ${result.debitedCount} réussis, ${result.failedCount} échoués. Payout total: ${result.totalPot} FCFA.`
        });
    } catch (error: any) {
        console.error("Erreur Tontine debit:", error);
        res.status(500).json({ success: false, message: error.message || "Erreur serveur" });
    }
});

export default router;
