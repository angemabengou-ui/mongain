import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { retryFailedContributions } from '../services/tontineService';
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
            data: { isPaused: true, pausedReason: String(reason).trim() }
        });

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
            data: { isPaused: false, pausedReason: null }
        });

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

        const participant = await prisma.tontineParticipant.findFirst({ where: { tontineGroupId: groupId, userId: targetUserId } });
        if (!participant) return res.status(404).json({ error: "Ce participant n'appartient pas à cette tontine." });

        const updated = await prisma.tontineParticipant.update({ where: { id: participant.id }, data: { status: 'PAUSED' } });

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

        const participant = await prisma.tontineParticipant.findFirst({ where: { tontineGroupId: groupId, userId: targetUserId } });
        if (!participant) return res.status(404).json({ error: "Ce participant n'appartient pas à cette tontine." });

        const updated = await prisma.tontineParticipant.update({ where: { id: participant.id }, data: { status: 'ACTIVE' } });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'RESUME_TONTINE_PARTICIPANT', details: `Participant ${targetUserId} (tontine ${groupId}) repris par l'admin.` }
        });

        res.json({ success: true, participant: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
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
            data: { adminId: staff.id, action: 'RETRY_TONTINE_CYCLE', details: `Cycle ${cycleId} (tontine ${groupId}) relancé : ${result.retriedCount} cotisation(s) récupérée(s), ${result.stillFailedCount} toujours en échec, ${result.recovered} FCFA récupérés.` }
        });

        res.json({ success: true, ...result });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

export default router;
