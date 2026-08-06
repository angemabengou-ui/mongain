import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

// Cache setting to prevent heavy DB hits (Optional, but we'll fetch from DB for simplicity)
export const getSystemSettings = async () => {
    let settings = await prisma.systemSettings.findFirst();
    if (!settings) {
        settings = await prisma.systemSettings.create({
            data: {
                taxP2P: 0.01,
                taxWithdraw: 0.013,
                rewardMerchant: 0.003,
                dailyLimitTier0: 50000,
                dailyLimitTier1: 2000000
            } as any
        });
    }
    return settings;
};

// GET /api/settings (Public or Protected, used by app to get fees)
router.get('/', async (req, res) => {
    try {
        const settings = await getSystemSettings();
        return res.json(settings);
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

const settingsSchema = z.object({
    taxP2P: z.number().min(0).max(1),
    taxWithdraw: z.number().min(0).max(1),
    rewardMerchant: z.number().min(0).max(1),
    dailyLimitTier0: z.number().min(100),
    dailyLimitTier1: z.number().min(100),
});

// PUT /api/admin/settings (SuperAdmin only)
router.put('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId } });
        // Assume SuperAdmin or Admin
        if (!admin || (admin.role !== 'ADMIN' && admin.role !== 'SUPERADMIN')) {
            return res.status(403).json({ error: 'Accès non autorisé.' });
        }

        const parsed = settingsSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const settings = await getSystemSettings();

        const updated = await prisma.systemSettings.update({
            where: { id: settings.id },
            data: parsed.data
        });

        // Audit Log
        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'UPDATE_SETTINGS',
                details: `Settings updated to: ${JSON.stringify(parsed.data)}`
            }
        });

        return res.json({ message: 'Paramètres mis à jour.', settings: updated });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur mise à jour.' });
    }
});

export default router;
