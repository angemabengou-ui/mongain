import express, { Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { executeTontineCycle, getTontineVaultWallet } from '../services/tontineService';
import { friendlyErrorMessage } from '../utils/errors';

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
                        // Filtré sur ACTIVE (comme tontine-detail.tsx, qui compte lui aussi les
                        // seuls participants actifs) — sans ce filtre, le nombre affiché ici
                        // incluait aussi les LEFT, divergeant de l'écran de détail du même groupe
                        // (ex: "3 sur 5" ici, "Ordre de passage (3)" dans le détail).
                        _count: { select: { participants: { where: { status: 'ACTIVE' } } } }
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

// Quitter un club de tontine — chaque participant doit pouvoir se retirer de
// lui-même. On ne supprime pas la ligne (elle garde la trace des cotisations et
// cagnottes déjà versées) : on la marque LEFT, un statut déjà ignoré par le CRON
// de prélèvement (executeTontineCycle ne traite que status === 'ACTIVE').
router.post('/leave', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        const participant = await prisma.tontineParticipant.findFirst({ where: { userId, tontineGroupId: groupId } });
        if (!participant) return res.status(404).json({ success: false, message: "Vous ne faites pas partie de ce club." });

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group) return res.status(404).json({ success: false, message: "Club introuvable." });

        if (group.creatorId === userId) {
            const otherActive = await prisma.tontineParticipant.count({
                where: { tontineGroupId: groupId, status: 'ACTIVE', userId: { not: userId } }
            });
            if (otherActive > 0) {
                return res.status(400).json({ success: false, message: "En tant que créateur, vous ne pouvez pas quitter tant que d'autres membres sont actifs dans le club." });
            }
        }

        // Les prélèvements de cotisation d'un cycle ne sont jamais forcés : le CRON
        // (executeTontineCycle) tente un débit et abandonne silencieusement en cas de
        // solde insuffisant, sans jamais revenir à la charge. Quitter est donc le seul
        // moment où l'on peut vraiment faire valoir une dette — une fois LEFT, le CRON
        // n'essaiera plus jamais de prélever cette personne. Si son tour est déjà passé
        // (elle a déjà touché la cagnotte), elle doit encore aux cycles restants des
        // autres membres qui, eux, n'ont pas encore été payés.
        const alreadyPaidOut = participant.payoutOrder < group.currentCycle;
        let debt = 0;

        if (alreadyPaidOut) {
            const remainingBeneficiaries = await prisma.tontineParticipant.count({
                where: { tontineGroupId: groupId, status: 'ACTIVE', payoutOrder: { gte: group.currentCycle }, userId: { not: userId } }
            });
            debt = remainingBeneficiaries * group.contribution;
        }

        const myWallet = await prisma.wallet.findUnique({ where: { userId } });
        if (debt > 0 && (!myWallet || myWallet.balance < debt)) {
            const manque = debt - (myWallet?.balance || 0);
            return res.status(400).json({
                success: false,
                message: `Vous avez déjà reçu la cagnotte de ce club. Il vous reste ${debt.toLocaleString('fr-FR')} FCFA à cotiser envers les membres qui n'ont pas encore eu leur tour. Rechargez votre compte d'au moins ${manque.toLocaleString('fr-FR')} FCFA puis réessayez de quitter — le montant dû sera prélevé automatiquement.`
            });
        }

        // Récupéré hors transaction, comme le fait déjà executeTontineCycle
        // (tontineService.ts) : cette fonction utilise le client Prisma global, pas
        // `tx` — l'appeler depuis l'intérieur d'un $transaction() peut épuiser le
        // pool de connexions (le client global attend une connexion que la
        // transaction interactive retient) et fait expirer/fermer la transaction.
        const vaultWallet = debt > 0 ? await getTontineVaultWallet() : null;

        await prisma.$transaction(async (tx) => {
            if (debt > 0 && vaultWallet) {
                const debited = await tx.wallet.updateMany({
                    where: { userId, balance: { gte: debt } },
                    data: { balance: { decrement: debt } }
                });
                if (debited.count === 0) throw new Error('Solde insuffisant pour régler ce que vous devez au club.');

                await tx.wallet.update({ where: { id: vaultWallet.id }, data: { balance: { increment: debt } } });
                await tx.transaction.create({
                    data: {
                        amount: debt,
                        senderWalletId: myWallet!.id,
                        receiverWalletId: vaultWallet.id,
                        status: 'COMPLETED',
                        reference: `TONT_EXIT_G${groupId}_U${userId}`.slice(0, 40)
                    }
                });
            }

            await tx.tontineParticipant.update({
                where: { id: participant.id },
                data: { status: 'LEFT' }
            });

            // S'il partait avant son tour, son numéro de passage devient un
            // cycle "mort" : plus personne n'a ce payoutOrder, donc ce
            // cycle-là collecterait des cotisations sans jamais les reverser
            // (executeTontineCycle ne trouve pas de bénéficiaire et passe son
            // tour). On resserre l'ordre des suivants pour combler le trou.
            // (Non applicable si son tour est déjà passé — sa dette vient
            // d'être réglée ci-dessus, pas de trou à combler dans ce cas.)
            if (!alreadyPaidOut) {
                await tx.tontineParticipant.updateMany({
                    where: { tontineGroupId: groupId, status: 'ACTIVE', payoutOrder: { gt: participant.payoutOrder } },
                    data: { payoutOrder: { decrement: 1 } }
                });
            }

            await tx.notification.create({
                data: {
                    userId,
                    title: debt > 0 ? 'Dette de tontine réglée' : 'Tontine quittée',
                    body: debt > 0
                        ? `${debt.toLocaleString('fr-FR')} FCFA prélevés pour solder votre dû envers « ${group.name} ». Vous avez quitté le club.`
                        : `Vous avez quitté « ${group.name} ». Vous ne serez plus prélevé aux prochains cycles.`,
                    type: 'TRANSACTION'
                }
            });
        });

        res.json({ success: true, message: debt > 0 ? `Dette de ${debt.toLocaleString('fr-FR')} FCFA réglée. Vous avez quitté le club.` : "Vous avez quitté le club de tontine. Vous ne serez plus prélevé aux prochains cycles." });
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

        // Défense en profondeur (en plus de `hasReceivedPayout` dans tontineService.ts, qui
        // ferme réellement l'exploit) : un `newOrder` doit être un entier positif, et deux
        // participants ne peuvent pas revendiquer le même tour dans une seule requête.
        const newOrders = orderMap.map((item: any) => Number(item.newOrder));
        if (newOrders.some((n: number) => !Number.isInteger(n) || n < 1)) {
            return res.status(400).json({ success: false, message: "Chaque tour (newOrder) doit être un entier positif." });
        }
        if (new Set(newOrders).size !== newOrders.length) {
            return res.status(400).json({ success: false, message: "Deux participants ne peuvent pas avoir le même tour." });
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
        const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, role: true, isActive: true, permissions: true, permissionsCustomized: true } });

        if (!staff || !staff.isActive || !hasPermission(staff, 'perm_system_settings_edit')) {
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
