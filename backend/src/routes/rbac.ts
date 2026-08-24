/**
 * Routes RBAC → gestion des droits granulaires du personnel.
 * Accessible uniquement par SUPER_ADMIN.
 *
 * GET  /api/admin/staff/:staffId/permissions  → lire les permissions effectives d'un employé
 * PUT  /api/admin/staff/:staffId/permissions  → définir les permissions personnalisées
 * DEL  /api/admin/staff/:staffId/permissions  → remettre aux défauts du rôle
 * GET  /api/admin/rbac/me                     → permissions de l'employé connecté (pour le frontend)
 */
import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { ALL_PERMISSIONS, getEffectivePermissions, PERMISSION_GROUPS, ROLE_DEFAULT_PERMISSIONS } from '../services/RBAC';

const router = Router();
const prisma = new PrismaClient();

// ── Middleware: SUPER_ADMIN uniquement pour certaines routes ──────────────
function superAdminOnly(req: any, res: any, next: any) {
    if (req.staff?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Réservé aux SUPER_ADMIN.' });
    }
    next();
}

// ── Charge le profil staff depuis req.userId (positionné par authMiddleware) ──
async function loadStaffMiddleware(req: any, _res: any, next: any) {
    try {
        const staff = await prisma.staff.findUnique({
            where: { id: req.userId },
            select: { id: true, role: true, permissions: true, permissionsCustomized: true }
        });
        req.staff = staff;
        next();
    } catch (e) {
        next(e);
    }
}

/**
 * GET /api/admin/rbac/me
 * Retourne les permissions de l'employé connecté (utilisé par le frontend pour adapter l'UI).
 */
router.get('/rbac/me', authMiddleware, loadStaffMiddleware, async (req: any, res: any) => {
    try {
        if (!req.staff) return res.status(404).json({ error: 'Profil introuvable.' });
        const effective = Array.from(getEffectivePermissions(req.staff));
        res.json({ role: req.staff.role, permissions: effective, customized: req.staff.permissionsCustomized ?? false });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /api/admin/staff/:staffId/permissions
 * Retourne les permissions effectives d'un employé + la liste des groupes pour affichage UI.
 */
router.get('/staff/:staffId/permissions', authMiddleware, loadStaffMiddleware, superAdminOnly, async (req: any, res: any) => {
    try {
        const staff = await prisma.staff.findUnique({
            where: { id: req.params.staffId },
            select: { id: true, name: true, role: true, permissions: true, permissionsCustomized: true }
        });
        if (!staff) return res.status(404).json({ error: 'Employé introuvable.' });

        const effective = Array.from(getEffectivePermissions(staff as any));
        const defaults = ROLE_DEFAULT_PERMISSIONS[staff.role] ?? [];

        res.json({
            staffId: staff.id,
            name: staff.name,
            role: staff.role,
            permissionsCustomized: (staff as any).permissionsCustomized ?? false,
            effectivePermissions: effective,
            defaultPermissions: defaults,
            allPermissions: ALL_PERMISSIONS,
            groups: PERMISSION_GROUPS,
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * PUT /api/admin/staff/:staffId/permissions
 * Définit des permissions personnalisées pour un employé.
 * Body: { permissions: string[] }
 */
router.put('/staff/:staffId/permissions', authMiddleware, loadStaffMiddleware, superAdminOnly, async (req: any, res: any) => {
    try {
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) return res.status(400).json({ error: '`permissions` doit être un tableau.' });

        const invalid = permissions.filter((p: string) => !(ALL_PERMISSIONS as readonly string[]).includes(p));
        if (invalid.length > 0) return res.status(400).json({ error: `Permissions inconnues : ${invalid.join(', ')}` });

        const updated = await (prisma.staff as any).update({
            where: { id: req.params.staffId },
            data: { permissions, permissionsCustomized: true },
            select: { id: true, name: true, role: true, permissions: true, permissionsCustomized: true }
        });

        res.json({ success: true, staff: updated, effectivePermissions: permissions });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /api/admin/staff/:staffId/permissions
 * Réinitialise les permissions aux défauts du rôle.
 */
router.delete('/staff/:staffId/permissions', authMiddleware, loadStaffMiddleware, superAdminOnly, async (req: any, res: any) => {
    try {
        const staff = await (prisma.staff as any).update({
            where: { id: req.params.staffId },
            data: { permissions: null, permissionsCustomized: false },
            select: { id: true, name: true, role: true }
        });

        const defaults = ROLE_DEFAULT_PERMISSIONS[staff.role] ?? [];
        res.json({ success: true, staff, effectivePermissions: defaults, message: 'Remis aux droits par défaut du rôle.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
