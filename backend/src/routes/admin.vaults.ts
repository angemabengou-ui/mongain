import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { applyRoleChangeGuards, executeVaultWithdraw } from '../services/vaultService';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

async function loadStaffWithPerm(userId: string | undefined, perm: Parameters<typeof hasPermission>[1]) {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
    if (!staff || !hasPermission(staff, perm)) return null;
    return staff;
}

// ==========================================
// CAISSE COMMUNE (VAULT) — LECTURE + INTERVENTION ADMIN
// ==========================================
// Jusqu'ici, une Caisse Commune bloquée ou contestée était un litige que personne côté
// équipe ne pouvait voir, encore moins arbitrer — le modèle Vault n'apparaissait dans
// aucun écran admin, et aucune action n'y était possible (voir ancien commentaire "aucune
// action d'intervention n'est exposée ici"). Ce fichier ajoute la lecture (perm_vault_view,
// remplace la réutilisation de perm_customer_360_basic) et un jeu d'actions d'intervention
// (perm_vault_manage) : geler/dégeler une caisse, forcer la résolution d'un retrait bloqué
// ou contesté, réassigner un rôle, annuler un bon. Chaque action écrit un AuditLog.

router.get('/vaults', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const vaults = await prisma.vault.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                admin: { select: { name: true, phone: true } },
                _count: { select: { members: true, transactions: { where: { status: 'PENDING' } } } }
            }
        });

        res.json({ vaults });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/vaults/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const vault = await prisma.vault.findUnique({
            where: { id: req.params.id as string },
            include: {
                admin: { select: { name: true, phone: true } },
                members: { include: { user: { select: { name: true, phone: true } } } },
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 100,
                    include: {
                        requestedBy: { select: { name: true, phone: true } },
                        approvals: { include: { user: { select: { name: true } } } }
                    }
                },
                vouchers: {
                    orderBy: { createdAt: 'desc' },
                    include: { president: { select: { name: true, phone: true } } }
                }
            }
        });
        if (!vault) return res.status(404).json({ error: 'Caisse introuvable.' });

        res.json({ vault, canManage: hasPermission(staff, 'perm_vault_manage') });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/vaults/:id/freeze', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { reason } = req.body;
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: "Indiquez le motif du gel (au moins 3 caractères)." });
    }
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const vault = await prisma.vault.update({
            where: { id: vaultId },
            data: { isFrozen: true, frozenReason: String(reason).trim(), frozenAt: new Date() },
            include: { members: { select: { userId: true, user: { select: { pushToken: true } } } } }
        });

        // Avant ce correctif, un gel était totalement silencieux pour les membres — ils ne le
        // découvraient qu'en essayant de déposer/retirer et en recevant une erreur, ou en
        // rouvrant par hasard l'écran de la caisse (qui affiche désormais une bannière, voir
        // vault-detail.tsx). Une notification proactive touche aussi ceux qui n'ouvrent pas
        // l'app entre-temps. Le push est en plus de l'enregistrement en base, jamais à sa
        // place : sendPush échoue silencieusement (token absent/invalide/désinstallation), et
        // seul l'enregistrement Notification garantit que l'alerte reste visible plus tard.
        if (vault.members.length > 0) {
            await prisma.notification.createMany({
                data: vault.members.map((m) => ({
                    userId: m.userId,
                    title: 'Caisse commune gelée',
                    body: `« ${vault.name} » a été gelée par l'administration (${reason}). Dépôts, retraits et bons sont bloqués jusqu'au dégel.`,
                    type: 'ALERT'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(vault.members.map((m) => sendPush(m.user.pushToken, 'Caisse commune gelée', `« ${vault.name} » a été gelée par l'administration.`)));
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'FREEZE_VAULT', details: `Caisse « ${vault.name} » (${vaultId}) gelée. Motif : ${reason}` }
        });

        res.json({ success: true, vault });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/vaults/:id/unfreeze', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const vault = await prisma.vault.update({
            where: { id: vaultId },
            data: { isFrozen: false, frozenReason: null, frozenAt: null },
            include: { members: { select: { userId: true, user: { select: { pushToken: true } } } } }
        });

        if (vault.members.length > 0) {
            await prisma.notification.createMany({
                data: vault.members.map((m) => ({
                    userId: m.userId,
                    title: 'Caisse commune dégelée',
                    body: `« ${vault.name} » est de nouveau active — dépôts, retraits et bons sont rétablis.`,
                    type: 'INFO'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(vault.members.map((m) => sendPush(m.user.pushToken, 'Caisse commune dégelée', `« ${vault.name} » est de nouveau active.`)));
        }

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'UNFREEZE_VAULT', details: `Caisse « ${vault.name} » (${vaultId}) dégelée.` }
        });

        res.json({ success: true, vault });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Débloque un retrait figé sous le quorum ou contesté — l'admin tranche, en dehors du
// circuit multisig normal. APPROVE réutilise la même logique d'exécution que le quorum
// self-service (executeVaultWithdraw, vaultService.ts) ; REJECT active le statut REJECTED
// déjà prévu au schéma mais jamais écrit par aucune route jusqu'ici.
router.post('/vaults/:id/withdraw-requests/:txId/force-resolve', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const txId = req.params.txId as string;
    const { decision, reason } = req.body;

    if (decision !== 'APPROVE' && decision !== 'REJECT') {
        return res.status(400).json({ error: "decision doit être 'APPROVE' ou 'REJECT'." });
    }
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ error: "Indiquez le motif de cette décision (au moins 3 caractères)." });
    }

    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const result = await prisma.$transaction(async (tx) => {
            const vaultTx = await tx.vaultTransaction.findUnique({
                where: { id: txId },
                include: { vault: true }
            });
            if (!vaultTx || vaultTx.vaultId !== vaultId) throw new Error("Demande de retrait introuvable.");
            if (vaultTx.status !== 'PENDING') throw new Error("Cette demande a déjà été traitée.");

            if (decision === 'REJECT') {
                const claim = await tx.vaultTransaction.updateMany({
                    where: { id: txId, status: 'PENDING' },
                    data: { status: 'REJECTED' }
                });
                if (claim.count === 0) throw new Error("Cette demande vient d'être traitée.");

                const rejectTitle = 'Retrait de caisse rejeté';
                const rejectBody = `Votre demande de ${vaultTx.amount.toLocaleString('fr-FR')} FCFA sur « ${vaultTx.vault.name} » a été rejetée par l'administration : ${reason}`;
                await tx.notification.create({
                    data: { userId: vaultTx.requestedById, title: rejectTitle, body: rejectBody, type: 'TRANSACTION' }
                });
                const requester = await tx.user.findUnique({ where: { id: vaultTx.requestedById }, select: { pushToken: true } });
                const { sendPush } = await import('./wallet');
                await sendPush(requester?.pushToken, rejectTitle, rejectBody);

                return { executed: false, status: 'REJECTED' as const };
            }

            const claim = await tx.vaultTransaction.updateMany({
                where: { id: txId, status: 'PENDING' },
                data: { status: 'COMPLETED' }
            });
            if (claim.count === 0) throw new Error("Cette demande vient d'être traitée.");

            await executeVaultWithdraw(tx, vaultTx);

            return { executed: true, status: 'COMPLETED' as const };
        });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: decision === 'APPROVE' ? 'FORCE_APPROVE_VAULT_WITHDRAWAL' : 'FORCE_REJECT_VAULT_WITHDRAWAL',
                details: `Retrait ${txId} (caisse ${vaultId}) résolu manuellement : ${decision}. Motif : ${reason}`
            }
        });

        res.json({ success: true, ...result });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

// Override admin des rôles — mêmes garde-fous que PUT /:id/roles côté self-service
// (vault.ts), via applyRoleChangeGuards (vaultService.ts) partagé entre les deux.
router.put('/vaults/:id/members/:userId/role', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const { isInitiator, isValidator, isTreasurer, isAdmin, isRequiredValidator } = req.body;

    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const targetMember = await prisma.vaultMember.findUnique({ where: { vaultId_userId: { vaultId, userId: targetUserId } } });
        if (!targetMember) return res.status(404).json({ error: "Cette personne n'est pas membre de la caisse." });

        await applyRoleChangeGuards(prisma, vaultId, targetUserId, { isAdmin, isValidator });

        const resolvedIsValidator = isValidator ?? targetMember.isValidator;
        const resolvedIsRequiredValidator = resolvedIsValidator ? (isRequiredValidator ?? targetMember.isRequiredValidator) : false;

        const updated = await prisma.vaultMember.update({
            where: { vaultId_userId: { vaultId, userId: targetUserId } },
            data: { isInitiator, isValidator, isTreasurer, isAdmin, isRequiredValidator: resolvedIsRequiredValidator }
        });

        const vaultForNotif = await prisma.vault.findUnique({ where: { id: vaultId }, select: { name: true } });
        const roleChangeTitle = 'Vos rôles ont été modifiés';
        const roleChangeBody = `L'administration a modifié vos rôles dans la caisse « ${vaultForNotif?.name ?? ''} » — vérifiez ce que vous pouvez désormais y faire.`;
        await prisma.notification.create({
            data: { userId: targetUserId, title: roleChangeTitle, body: roleChangeBody, type: 'INFO' }
        });
        const targetUser = await prisma.user.findUnique({ where: { id: targetUserId }, select: { pushToken: true } });
        const { sendPush } = await import('./wallet');
        await sendPush(targetUser?.pushToken, roleChangeTitle, roleChangeBody);

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'OVERRIDE_VAULT_MEMBER_ROLE', details: `Rôles du membre ${targetUserId} (caisse ${vaultId}) modifiés par l'admin : ${JSON.stringify({ isInitiator, isValidator, isTreasurer, isAdmin, isRequiredValidator: resolvedIsRequiredValidator })}` }
        });

        res.json({ success: true, member: updated });
    } catch (e: any) {
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

router.post('/vaults/:id/vouchers/:voucherId/void', authMiddleware, async (req: AuthRequest, res) => {
    const voucherId = req.params.voucherId as string;
    const { reason } = req.body;

    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_vault_manage');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const voucher = await prisma.vaultVoucher.findUnique({ where: { id: voucherId } });
        if (!voucher || voucher.vaultId !== (req.params.id as string)) return res.status(404).json({ error: 'Bon introuvable.' });

        const updated = await prisma.$transaction(async (tx) => {
            // Réclamation atomique : sans elle, une annulation et une dépense simultanées
            // (admin.vaults.ts vs vault.ts /vouchers/:id/spend) pouvaient toutes deux lire
            // ACTIVE avant qu'aucune n'écrive.
            const claim = await tx.vaultVoucher.updateMany({
                where: { id: voucherId, status: 'ACTIVE' },
                data: { status: 'VOID', voidReason: reason ? String(reason).trim() : null }
            });
            if (claim.count === 0) throw new Error('Ce bon est déjà utilisé ou déjà annulé.');

            // Le solde de la caisse a déjà été débité du montant du bon au moment de sa
            // création (executeVaultWithdraw, vaultService.ts) — tant qu'il n'est pas dépensé
            // chez un marchand, cet argent n'a jamais été crédité nulle part. Sans ce
            // remboursement, annuler un bon actif faisait purement et simplement disparaître
            // la somme : ni dans la caisse, ni chez un marchand, ni ailleurs.
            await tx.vault.update({
                where: { id: voucher.vaultId },
                data: { balance: { increment: voucher.amount } }
            });

            // Sans ça, le porteur du bon (le Président qui l'a émis) ne l'apprend qu'en essayant
            // de le dépenser chez un marchand et en se le voyant refuser, sans explication.
            const voidTitle = 'Bon de retrait annulé';
            const voidBody = `Votre bon de ${voucher.amount.toLocaleString('fr-FR')} FCFA a été annulé par l'administration et reversé au solde de la caisse.${reason ? ` Motif : ${reason}` : ''}`;
            await tx.notification.create({
                data: {
                    userId: voucher.presidentId,
                    title: voidTitle,
                    body: voidBody,
                    type: 'ALERT'
                }
            });

            return { ...voucher, status: 'VOID' as const, voidReason: reason ? String(reason).trim() : null };
        });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'VOID_VAULT_VOUCHER', details: `Bon ${voucherId} (${voucher.amount} FCFA) annulé par l'admin et reversé au solde de la caisse.${reason ? ` Motif : ${reason}` : ''}` }
        });

        const president = await prisma.user.findUnique({ where: { id: voucher.presidentId }, select: { pushToken: true } });
        const { sendPush } = await import('./wallet');
        await sendPush(president?.pushToken, 'Bon de retrait annulé', `Votre bon de ${voucher.amount.toLocaleString('fr-FR')} FCFA a été annulé par l'administration et reversé au solde de la caisse.${reason ? ` Motif : ${reason}` : ''}`);

        res.json({ success: true, voucher: updated });
    } catch (e: any) {
        // 400 (pas 500) : le cas le plus probable ici est la course avec /spend, réclamée
        // atomiquement ci-dessus — une erreur métier attendue, pas une panne serveur. Même
        // convention que force-resolve un peu plus haut dans ce fichier.
        res.status(400).json({ error: e.message || friendlyErrorMessage(e) });
    }
});

export default router;
