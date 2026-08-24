import { NextFunction, Request, Response } from 'express';
import { getEffectivePermissions, Permission } from '../services/RBAC';

/**
 * Middleware Express — protège une route en vérifiant qu'un membre du personnel
 * possède la permission requise (soit via son rôle par défaut, soit via ses droits
 * personnalisés enregistrés en base).
 *
 * Usage dans une route :
 *   router.post('/kyc', authStaff, requirePermission('perm_customer_kyc_validate'), handler)
 *
 * Pré-requis : le middleware `authStaff` doit avoir été appelé avant et avoir attaché
 *   `req.staff` avec au minimum les champs { role, permissions, permissionsCustomized }.
 */
export function requirePermission(permission: Permission) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const staff = (req as any).staff;

        if (!staff) {
            res.status(401).json({ error: 'Non authentifié.' });
            return;
        }

        const perms = getEffectivePermissions(staff);

        if (!perms.has(permission)) {
            res.status(403).json({
                error: 'Permission refusée.',
                required: permission,
                yourRole: staff.role,
                tip: 'Contactez un SUPER_ADMIN pour obtenir cette autorisation.',
            });
            return;
        }

        next();
    };
}
