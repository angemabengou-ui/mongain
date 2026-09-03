import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { executeTontineCycle, retryFailedContributions } from '../services/tontineService';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

async function loadStaffWithPerm(userId: string | undefined, perm: Parameters<typeof hasPermission>[1]) {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
    if (!staff || !hasPermission(staff, perm)) return null;
    return staff;
}

// ==========================================
// TONTINES — LECTURE + INTERVENTION ADMIN
// ==========================================
// Même constat que pour les Caisses Communes : un litige sur une tontine (cagnotte non
// reçue, cotisation prélevée en double, ordre de versement contesté) était invisible pour
// toute l'équipe, et aucune action n'y était possible (voir ancien commentaire "lecture
// seule, aucune action d'intervention exposée ici"). Ce fichier ajoute la lecture
// (perm_tontine_view, remplace perm_customer_360_basic) — avec, depuis le passage au grand
// livre structuré TontineCycle/TontineContribution, un vrai historique de cycles au lieu
// d'un parsing de reference — et des actions d'intervention (perm_tontine_manage) : mettre
// en pause le groupe ou un participant, relancer les cotisations en échec d'un cycle.

router.get('/tontines', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const groups = await prisma.tontineGroup.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                creator: { select: { name: true, phone: true } },
                _count: { select: { participants: true } }
            }
        });

        res.json({ groups });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/tontines/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const group = await prisma.tontineGroup.findUnique({
            where: { id: req.params.id as string },
            include: {
                creator: { select: { name: true, phone: true } },
                participants: {
                    orderBy: { payoutOrder: 'asc' },
                    include: { user: { select: { name: true, phone: true } } }
                },
                cycles: {
                    orderBy: { cycleNumber: 'desc' },
                    take: 50,
                    include: {
                        contributions: { include: { participant: { include: { user: { select: { name: true, phone: true } } } } } }
                    }
                }
            }
        });
        if (!group) return res.status(404).json({ error: 'Tontine introuvable.' });

        // Repli sur le parsing de Transaction.reference pour les cycles exécutés avant
        // l'introduction du grand livre structuré (TontineCycle/TontineContribution) —
        // ces cycles-là n'ont pas de ligne TontineCycle correspondante.
        const transactions = await prisma.transaction.findMany({
            where: { reference: { contains: `_G${group.id}_` } },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } } } }
            }
        });

        res.json({ group, transactions, canManage: hasPermission(staff, 'perm_tontine_manage') });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/tontines/:id/pause', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: "Indiquez le motif de la mise en pause (au moins 3 caractères)." });
    }
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const group = await prisma.tontineGroup.update({
            where: { id: groupId },
            data: { isPaused: true, pausedReason: String(reason).trim() },
            include: { participants: { where: { status: 'ACTIVE' }, select: { userId: true, user: { select: { pushToken: true } } } } }
        });

        // Même constat que pour le gel d'une caisse (admin.vaults.ts) : sans notification
        // proactive, seuls les membres qui rouvrent l'app par hasard découvrent la pause
        // (via la bannière de tontine-detail.tsx) — les autres continuent de s'attendre à
        // être prélevés normalement.
        if (group.participants.length > 0) {
            await prisma.notification.createMany({
                data: group.participants.map((p) => ({
                    userId: p.userId,
                    title: 'Tontine en pause',
                    body: `« ${group.name} » a été mise en pause par l'administration (${reason}). Aucune cotisation ni versement n'aura lieu jusqu'à la reprise.`,
                    type: 'ALERT'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(group.participants.map((p) => sendPush(p.user.pushToken, 'Tontine en pause', `« ${group.name} » a été mise en pause par l'administration.`)));
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'PAUSE_TONTINE', details: `Tontine « ${group.name} » (${groupId}) mise en pause. Motif : ${reason}` }
        });

        res.json({ success: true, group });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/tontines/:id/resume', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const group = await prisma.tontineGroup.update({
            where: { id: groupId },
            data: { isPaused: false, pausedReason: null },
            include: { participants: { where: { status: 'ACTIVE' }, select: { userId: true, user: { select: { pushToken: true } } } } }
        });

        if (group.participants.length > 0) {
            await prisma.notification.createMany({
                data: group.participants.map((p) => ({
                    userId: p.userId,
                    title: 'Tontine reprise',
                    body: `« ${group.name} » est de nouveau active — les cotisations et versements reprennent normalement.`,
                    type: 'INFO'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(group.participants.map((p) => sendPush(p.user.pushToken, 'Tontine reprise', `« ${group.name} » est de nouveau active.`)));
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'RESUME_TONTINE', details: `Tontine « ${group.name} » (${groupId}) reprise.` }
        });

        res.json({ success: true, group });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/tontines/:id/participants/:userId/pause', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const participant = await prisma.tontineParticipant.findFirst({ where: { tontineGroupId: groupId, userId: targetUserId }, include: { group: { select: { name: true } } } });
        if (!participant) return res.status(404).json({ error: "Ce participant n'appartient pas à cette tontine." });

        const updated = await prisma.tontineParticipant.update({ where: { id: participant.id }, data: { status: 'PAUSED' } });

        // Sans notification, la personne mise en pause disparaît simplement de l'ordre de
        // passage de son propre club (voir la bannière ajoutée à tontine-detail.tsx) sans
        // jamais l'apprendre si elle ne rouvre pas l'app entre-temps.
        await prisma.notification.create({
            data: {
                userId: targetUserId,
                title: 'Vous avez été mis en pause',
                body: `L'administration vous a mis en pause dans « ${participant.group.name} » — vous ne serez plus prélevé ni sélectionné pour la cagnotte jusqu'à votre reprise.`,
                type: 'ALERT'
            }
        });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'PAUSE_TONTINE_PARTICIPANT', details: `Participant ${targetUserId} (tontine ${groupId}) mis en pause par l'admin — exclu des prochains cycles jusqu'à reprise.` }
        });

        res.json({ success: true, participant: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/tontines/:id/participants/:userId/resume', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const participant = await prisma.tontineParticipant.findFirst({ where: { tontineGroupId: groupId, userId: targetUserId }, include: { group: { select: { name: true } } } });
        if (!participant) return res.status(404).json({ error: "Ce participant n'appartient pas à cette tontine." });

        const updated = await prisma.tontineParticipant.update({ where: { id: participant.id }, data: { status: 'ACTIVE' } });

        const resumeTitle = 'Vous avez été repris';
        const resumeBody = `L'administration vous a repris dans « ${participant.group.name} » — vous êtes de nouveau inclus dans les prochains cycles.`;
        await prisma.notification.create({
            data: { userId: targetUserId, title: resumeTitle, body: resumeBody, type: 'INFO' }
        });
        const resumedUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { pushToken: true } });
        const { sendPush } = await import('./wallet');
        await sendPush(resumedUser?.pushToken, resumeTitle, resumeBody);

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'RESUME_TONTINE_PARTICIPANT', details: `Participant ${targetUserId} (tontine ${groupId}) repris par l'admin.` }
        });

        res.json({ success: true, participant: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Reporte le prochain prélèvement automatique de N jours — décale la date de référence
// utilisée par le CRON (cron.ts : referenceDate = lastPayoutDate || startDate, cycle dû dès
// que ${cycleDays} jours se sont écoulés depuis cette date). Repousser cette date suffit à
// repousser l'échéance sans toucher currentCycle ni aucune donnée financière : la prochaine
// exécution du cycle attendra simplement plus longtemps. Utile quand un ou plusieurs membres
// ont besoin de plus de temps pour compléter leur cotisation avant la date prévue.
router.post('/tontines/:id/postpone', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const { days, reason } = req.body;
    const daysNum = Number(days);
    if (!Number.isInteger(daysNum) || daysNum <= 0) {
        return res.status(400).json({ error: 'Indiquez un nombre de jours de report positif.' });
    }
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: 'Indiquez le motif du report (au moins 3 caractères).' });
    }
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const group = await prisma.tontineGroup.findUnique({
            where: { id: groupId },
            include: { participants: { where: { status: 'ACTIVE' }, select: { userId: true, user: { select: { pushToken: true } } } } }
        });
        if (!group) return res.status(404).json({ error: 'Tontine introuvable.' });
        if (group.status !== 'ACTIVE') return res.status(400).json({ error: "Ce club n'est pas actif (terminé, en sondage de relance, ou dissous)." });

        const referenceDate = group.lastPayoutDate || group.startDate;
        const newReferenceDate = new Date(referenceDate.getTime() + daysNum * 24 * 60 * 60 * 1000);

        const updated = await prisma.tontineGroup.update({
            where: { id: groupId },
            data: { lastPayoutDate: newReferenceDate }
        });

        if (group.participants.length > 0) {
            await prisma.notification.createMany({
                data: group.participants.map((p) => ({
                    userId: p.userId,
                    title: 'Prélèvement reporté',
                    body: `Le prochain prélèvement de « ${group.name} » a été reporté de ${daysNum} jour${daysNum > 1 ? 's' : ''} par l'administration. Motif : ${reason}`,
                    type: 'INFO'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(group.participants.map((p) => sendPush(p.user.pushToken, 'Prélèvement reporté', `Le prochain prélèvement de « ${group.name} » a été reporté de ${daysNum} jour${daysNum > 1 ? 's' : ''}.`)));
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'POSTPONE_TONTINE_CYCLE', details: `Prélèvement de la tontine « ${group.name} » (${groupId}) reporté de ${daysNum} jours. Motif : ${reason}` }
        });

        res.json({ success: true, group: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Paiement d'urgence hors tour : un membre en difficulté a demandé à l'administration de
// recevoir sa cagnotte tout de suite plutôt que d'attendre son tour normal. On échange son
// payoutOrder avec celui du bénéficiaire actuellement prévu pour ce cycle (personne ne perd
// définitivement son tour, il est juste décalé), puis on déclenche le cycle immédiatement —
// même mécanique de collecte/versement que le CRON, avec le même garde-fou de réclamation
// atomique sur lastPayoutDate pour éviter un double déclenchement si le CRON tourne au même
// instant. Comme pour tout versement, hasReceivedPayout empêche cette personne de recevoir
// une seconde cagnotte avant la fin de la boucle en cours (voir tontineService.ts).
router.post('/tontines/:id/participants/:userId/emergency-payout', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: "Indiquez le motif de ce paiement d'urgence (au moins 3 caractères)." });
    }
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const group: any = await prisma.tontineGroup.findUnique({
            where: { id: groupId },
            include: { participants: { include: { user: { select: { pushToken: true } } } } }
        });
        if (!group) return res.status(404).json({ error: 'Tontine introuvable.' });
        if (group.status !== 'ACTIVE') return res.status(400).json({ error: "Ce club n'est pas actif (terminé, en sondage de relance, ou dissous)." });
        if (group.isPaused) return res.status(400).json({ error: 'Ce club est en pause administrative.' });

        const target = group.participants.find((p: any) => p.userId === targetUserId);
        if (!target || target.status !== 'ACTIVE') return res.status(404).json({ error: "Cette personne n'est pas membre actif de ce club." });
        if (target.hasReceivedPayout) return res.status(400).json({ error: 'Cette personne a déjà reçu sa cagnotte pour cette boucle.' });
        if (target.payoutOrder < group.currentCycle) return res.status(400).json({ error: "Anomalie d'ordre de passage pour ce membre — intervention manuelle en base nécessaire." });

        const currentBeneficiary = group.participants.find((p: any) => p.payoutOrder === group.currentCycle && p.status === 'ACTIVE' && !p.hasReceivedPayout);

        if (!currentBeneficiary) {
            if (target.payoutOrder !== group.currentCycle) {
                await prisma.tontineParticipant.update({ where: { id: target.id }, data: { payoutOrder: group.currentCycle } });
            }
        } else if (currentBeneficiary.userId !== targetUserId) {
            await prisma.$transaction([
                prisma.tontineParticipant.update({ where: { id: target.id }, data: { payoutOrder: currentBeneficiary.payoutOrder } }),
                prisma.tontineParticipant.update({ where: { id: currentBeneficiary.id }, data: { payoutOrder: target.payoutOrder } }),
            ]);
            await prisma.notification.create({
                data: {
                    userId: currentBeneficiary.userId,
                    title: 'Votre tour a été décalé',
                    body: `L'administration a avancé le tour d'un autre membre de « ${group.name} » pour une urgence. Vous recevrez votre cagnotte à un tour ultérieur.`,
                    type: 'ALERT'
                }
            });
            const { sendPush } = await import('./wallet');
            await sendPush(currentBeneficiary.user?.pushToken, 'Votre tour a été décalé', `Un tour a été avancé dans « ${group.name} » — vous serez payé à un tour ultérieur.`);
        }

        // Réclamation atomique AVANT exécution — même garde-fou que le CRON (cron.ts) pour
        // éviter un double déclenchement si le CRON s'exécute au même instant.
        const claim = await prisma.tontineGroup.updateMany({
            where: { id: groupId, lastPayoutDate: group.lastPayoutDate },
            data: { lastPayoutDate: new Date() }
        });
        if (claim.count === 0) return res.status(409).json({ error: 'Un cycle est déjà en cours de traitement pour ce club, réessayez dans un instant.' });

        const result = await executeTontineCycle(groupId);
        // Même garde que POST /tontine/debit/:groupId : `result.success` est la seule source
        // de vérité (executeTontineCycle peut renvoyer `{ success: false, ... }` sans jamais
        // lever d'exception — ex. groupe introuvable). `{ success: true, ...result }` aurait
        // laissé `result.success` écraser silencieusement le `true` explicite (TS le signale
        // d'ailleurs : clé dupliquée), donc une vraie erreur ici répondait quand même 200 avec
        // `success: false` dans le corps au lieu d'un statut d'erreur explicite.
        if (!result || !result.success) {
            return res.status(404).json({ error: 'Tontine introuvable au moment de l\'exécution du cycle.' });
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'TONTINE_EMERGENCY_PAYOUT', details: `Paiement d'urgence hors tour pour ${targetUserId} (tontine « ${group.name} », ${groupId}). Motif : ${reason}` }
        });

        // `result.success` est déjà garanti `true` par le contrôle ci-dessus — pas besoin de
        // le redéclarer explicitement (ce qui redéclencherait la même clé dupliquée).
        res.json(result);
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

// Relance les cotisations en échec d'un cycle déjà exécuté (retryFailedContributions,
// tontineService.ts) plutôt que de rejouer tout le cycle.
router.post('/tontines/:id/cycles/:cycleId/retry', authMiddleware, async (req: AuthRequest, res) => {
    const groupId = req.params.id as string;
    const cycleId = req.params.cycleId as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_tontine_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const result = await retryFailedContributions(groupId, cycleId);

        await prisma.auditLog.create({
            data: {
                adminId: staff.id, action: 'RETRY_TONTINE_CYCLE',
                details: `Cycle ${cycleId} (tontine ${groupId}) relancé : ${result.retriedCount} cotisation(s) récupérée(s), ${result.stillFailedCount} toujours en échec, ${result.recovered} FCFA récupérés.${result.payoutResolved ? ' Versement de la cagnotte, bloqué depuis l\'exécution du cycle, a été résolu.' : ''}`
            }
        });

        res.json({ success: true, ...result });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

export default router;
