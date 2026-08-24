import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma';
import { getEffectivePermissions, Permission } from '../services/RBAC';

/**
 * Middleware Express — protège une route en vérifiant qu'un membre du personnel
 * possède la permission requise.
 */
export function requirePermission(permission: Permission) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).userId;

        if (!userId) {
            res.status(401).json({ error: 'Non authentifié.' });
            return;
        }

        try {
            const staff = await prisma.staff.findUnique({
                where: { id: userId },
                select: { role: true, permissions: true, permissionsCustomized: true }
            });

            if (!staff) {
                res.status(403).json({ error: 'Utilisateur staff introuvable.' });
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
        } catch (e) {
            res.status(500).json({ error: 'Erreur lors de la vérification des permissions.' });
        }
    };
}
