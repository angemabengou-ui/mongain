import { friendlyErrorMessage } from '../utils/errors';
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

        const contributionAmount = parseFloat(contribution);
        if (isNaN(contributionAmount) || contributionAmount <= 0) {
            return res.status(400).json({ success: false, message: "Montant de cotisation invalide." });
        }

        const group = await prisma.tontineGroup.create({
            data: {
                creatorId: userId,
                name,
                contribution: contributionAmount,
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
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Récupérer uniquement les tontines de l'utilisateur (Publique -> Privée)
router.get('/groups', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;

        // Participations de l'utilisateur
        const myParticipations = await prisma.tontineParticipant.findMany({
            where: { userId },
            include: {
                group: {
                    include: {
                        _count: { select: { participants: true } }
                    }
                }
            },
            orderBy: { joinedAt: 'desc' }
        });

        res.json({
            success: true,
            data: {
                groups: [], // Vide pour compatibilité ou supprimer du front plus tard
                myParticipations
            }
        });
    } catch (error: any) {
        console.error("Erreur récupération Tontine:", error);
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Détails complets d'un groupe (pour le créateur/participants)
router.get('/details/:groupId', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.params;

        const group = await prisma.tontineGroup.findUnique({
            where: { id: String(groupId) },
            include: {
                creator: { select: { name: true, phone: true } },
                participants: {
                    include: { user: { select: { name: true, phone: true } } },
                    orderBy: { payoutOrder: 'asc' }
                }
            }
        });

        if (!group) return res.status(404).json({ success: false, message: "Club introuvable" });

        // Seuls les membres peuvent voir
        const isMember = group.participants.some(p => p.userId === userId);
        if (!isMember) return res.status(403).json({ success: false, message: "Accès refusé" });

        res.json({ success: true, data: group });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Inviter un membre par téléphone
router.post('/invite', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId, phone } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group || group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: "Seul le créateur peut inviter." });
        }

        const invitee = await prisma.user.findUnique({ where: { phone } });
        if (!invitee) {
            return res.status(404).json({ success: false, message: "Numéro non trouvé sur Mongain." });
        }

        const existing = await prisma.tontineParticipant.findFirst({
            where: { userId: invitee.id, tontineGroupId: groupId }
        });
        if (existing) {
            return res.status(400).json({ success: false, message: "Ce membre y est déjà." });
        }

        const count = await prisma.tontineParticipant.count({ where: { tontineGroupId: groupId } });
        const participant = await prisma.tontineParticipant.create({
            data: { userId: invitee.id, tontineGroupId: groupId, payoutOrder: count + 1 }
        });

        await prisma.notification.create({
            data: {
                userId: invitee.id,
                title: "Invitation Tontine 🤝",
                body: `Vous avez été ajouté au club ${group.name}.`,
                type: "INFO"
            }
        });

        res.json({ success: true, message: "Membre ajouté avec succès.", data: participant });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Modifier l'ordre de passage d'un membre manuellement
router.post('/reorder', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        // orderMap: [ { participantId: "...1", newOrder: 1 }, { participantId: "...2", newOrder: 2 } ]
        const { groupId, orderMap } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group || group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: "Seul le créateur peut modifier l'ordre." });
        }

        if (!Array.isArray(orderMap) || orderMap.length === 0) {
            return res.status(400).json({ success: false, message: "orderMap invalide." });
        }

        // IDOR guard : chaque participantId ciblé doit appartenir à CE groupe — sans ce
        // contrôle, le créateur d'un groupe A pouvait réordonner (et donc s'attribuer)
        // un tour de paiement dans un groupe B dont il n'est que simple membre.
        const participantIds = orderMap.map((item: any) => String(item.participantId));
        const validParticipants = await prisma.tontineParticipant.findMany({
            where: { id: { in: participantIds }, tontineGroupId: group.id },
            select: { id: true }
        });
        if (validParticipants.length !== participantIds.length) {
            return res.status(403).json({ success: false, message: "Un ou plusieurs participants n'appartiennent pas à ce groupe." });
        }

        await prisma.$transaction(
            orderMap.map((item: any) =>
                prisma.tontineParticipant.update({
                    where: { id: String(item.participantId) },
                    data: { payoutOrder: item.newOrder }
                })
            )
        );

        res.json({ success: true, message: "L'ordre a été mis à jour." });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Rejoindre un club n'est théoriquement plus utilisé publiquement, mais on garde pour compatibilité ou avec un code d'invit
router.post('/join', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        if (!groupId) {
            return res.status(400).json({ success: false, message: "ID de la tontine requis." });
        }

        // Vérifier si le groupe existe
        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
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
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Déclenchement manuel d'un cycle (le CRON automatique appelle executeTontineCycle
// directement en interne — voir backend/src/cron.ts — sans jamais passer par cette route
// HTTP). Réservé au personnel habilité (compte Staff, pas le rôle legacy User.ADMIN).
router.post('/debit/:groupId', authMiddleware, async (req: Request, res: Response) => {
    try {
        const staffId = (req as AuthRequest).userId!;
        const staff = await prisma.staff.findUnique({ where: { id: staffId } });

        if (!staff || !staff.isActive || !['SUPER_ADMIN', 'RISK'].includes(staff.role)) {
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
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

export default router;
