import express, { Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

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

        const { groupId } = req.params;
        const group = await prisma.tontineGroup.findUnique({ where: { id: groupId }, include: { participants: true } });

        if (!group) {
            return res.status(404).json({ success: false, message: "Groupe introuvable" });
        }

        let debitedCount = 0;
        let failedCount = 0;

        // Boucle sur chaque participant pour prélever
        for (const p of group.participants) {
            if (p.status !== 'ACTIVE') continue;

            const wallet = await prisma.wallet.findUnique({ where: { userId: p.userId } });

            // Si le solde est suffisant
            if (wallet && wallet.balance >= group.contribution) {
                await prisma.$transaction(async (tx) => {
                    // Retrait de la contribution
                    await tx.wallet.update({
                        where: { id: wallet.id },
                        data: { balance: { decrement: group.contribution } }
                    });

                    // Option logic : Transfert vers le pot commun, ou log de transaction
                    await tx.transaction.create({
                        data: {
                            amount: group.contribution,
                            receiverWalletId: "VAULT_TONTINE_" + group.id, // Utilisé virtuellement ou stocké sur central
                            status: "COMPLETED",
                            reference: `TONTINE_DEBIT_${p.id}_${Date.now()}`
                        }
                    });

                    // Notifier le succès
                    await tx.notification.create({
                        data: {
                            userId: p.userId,
                            title: "Cotisation Tontine prélevée 💸",
                            body: `Votre cotisation de ${group.contribution} FCFA pour ${group.name} a été débitée.`,
                            type: "INFO"
                        }
                    });
                });
                debitedCount++;
            } else {
                // Solde insuffisant : Avertissement rouge
                await prisma.notification.create({
                    data: {
                        userId: p.userId,
                        title: "Échec Cotisation Tontine ⚠️",
                        body: `Solde insuffisant pour le prélèvement de ${group.contribution} FCFA. Veuillez recharger votre portefeuille.`,
                        type: "ALERT"
                    }
                });
                failedCount++;
            }
        }

        res.json({
            success: true,
            message: `Cycle de prélèvement exécuté. ${debitedCount} réussis, ${failedCount} échoués.`
        });
    } catch (error: any) {
        console.error("Erreur Tontine debit:", error);
        res.status(500).json({ success: false, message: error.message || "Erreur serveur" });
    }
});

export default router;
