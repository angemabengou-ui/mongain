import { Router } from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

const router = Router();

// Mêmes champs que le masquage de GET / ci-dessous — ne jamais écrire leur valeur en clair
// ailleurs, y compris dans l'historique de configuration (SettingHistory), sous peine de
// contourner le masquage : GET /api/settings/history est lisible par les mêmes rôles
// (SUPER_ADMIN/RISK/COMPLIANCE_CHECKER) et affichait jusqu'ici oldValue/newValue en clair.
const SECRET_SETTING_FIELDS = new Set(['airtelApiKey', 'moovApiKey', 'pvitSecretKey', 'pvitWebhookSecret']);
const maskSecretForHistory = (key: string, value: any) => {
    if (!SECRET_SETTING_FIELDS.has(key) || value == null || value === '') return String(value);
    return '••••••••' + String(value).slice(-4);
};

// Cache en mémoire (TTL court) : cette ligne unique (SystemSettings n'a jamais qu'une
// seule row) était relue à chaque requête financière — parfois plusieurs fois pour une
// seule requête (circuitBreaker + handler + à l'intérieur même d'une transaction Prisma),
// chaque lecture étant un aller-retour réseau vers Neon. Invalidée immédiatement à chaque
// écriture (POST /approve/:id ci-dessous) : aucun délai de propagation pour un admin qui
// active le circuit breaker, seulement pour d'éventuelles lectures concurrentes entre deux
// écritures, ce qui n'a aucun effet pratique ici.
let settingsCache: Awaited<ReturnType<typeof prisma.systemSettings.findFirst>> | null = null;
let settingsCacheAt = 0;
const SETTINGS_CACHE_TTL_MS = 5000;

export const invalidateSettingsCache = () => {
    settingsCache = null;
    settingsCacheAt = 0;
};

export const getSystemSettings = async () => {
    const now = Date.now();
    if (settingsCache && now - settingsCacheAt < SETTINGS_CACHE_TTL_MS) return settingsCache;

    let settings = await prisma.systemSettings.findFirst();
    if (!settings) {
        settings = await prisma.systemSettings.create({
            data: {
                taxP2P: 0.01,
                taxCashIn: 0.015,
                taxWithdraw: 0.013,
                rewardMerchant: 0.003
            } as any
        });
    }
    settingsCache = settings;
    settingsCacheAt = now;
    return settings;
};

// GET /api/settings (Public or Protected, used by app to get fees)
router.get('/', async (req, res) => {
    try {
        const settings = await getSystemSettings();

        // Sécurité : Masquage strict des clés secrètes d'API
        const maskedSettings = {
            ...settings,
            airtelApiKey: settings.airtelApiKey ? '••••••••' + settings.airtelApiKey.slice(-4) : null,
            moovApiKey: settings.moovApiKey ? '••••••••' + settings.moovApiKey.slice(-4) : null,
            pvitSecretKey: settings.pvitSecretKey ? '••••••••' + settings.pvitSecretKey.slice(-4) : null,
            pvitWebhookSecret: settings.pvitWebhookSecret ? '••••••••' + settings.pvitWebhookSecret.slice(-4) : null,
        };

        return res.json(maskedSettings);
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

const settingsSchema = z.object({
    // Général
    platformName: z.string().optional(),
    currency: z.string().optional(),
    timezone: z.string().optional(),
    supportEmail: z.string().optional(),
    supportPhone: z.string().optional(),

    // Frais
    taxP2P: z.number().min(0).max(1).optional(),
    taxCashIn: z.number().min(0).max(1).optional(),
    taxWithdraw: z.number().min(0).max(1).optional(),
    rewardMerchant: z.number().min(0).max(1).optional(),
    agencyWithdrawThreshold: z.number().min(0).optional(),
    agencyTaxWithdraw: z.number().min(0).max(1).optional(),

    // Limites KYC & Transactions
    dailyLimitTier0: z.number().min(100).optional(),
    dailyLimitTier1: z.number().min(100).optional(),
    dailyLimitTier2: z.number().min(100).optional(),
    monthlyLimitTier0: z.number().min(100).optional(),
    monthlyLimitTier1: z.number().min(100).optional(),
    monthlyLimitTier2: z.number().min(100).optional(),
    perTxLimitTier0: z.number().min(100).optional(),
    perTxLimitTier1: z.number().min(100).optional(),
    perTxLimitTier2: z.number().min(100).optional(),

    // Fonctionnalités (Toggles)
    airtelEnabled: z.boolean().optional(),
    moovEnabled: z.boolean().optional(),
    seegEnabled: z.boolean().optional(),
    tontineEnabled: z.boolean().optional(),

    // API
    airtelFee: z.number().min(0).max(1).optional(),
    moovFee: z.number().min(0).max(1).optional(),
    airtelApiKey: z.string().nullable().optional(),
    moovApiKey: z.string().nullable().optional(),

    // PVit (dépôt Mobile Money — backend/src/services/pvit.ts)
    pvitSecretKey: z.string().nullable().optional(),
    pvitCodeUrlPayment: z.string().nullable().optional(),
    pvitMerchantOperationAccountCode: z.string().nullable().optional(),
    pvitCallbackUrlCode: z.string().nullable().optional(),
    pvitWebhookSecret: z.string().nullable().optional(),

    // Webhooks
    webhookUrl: z.string().nullable().optional(),
    webhookActive: z.boolean().optional(),
    webhookRetry: z.number().int().min(0).optional(),

    // Maintenance
    globalMaintenance: z.boolean().optional(),
    circuitBreaker: z.boolean().optional(),

    // Anti-Fraud & Cash Operations
    antiFractioningWindowHours: z.number().int().min(1).optional(),
    antiFractioningMaxAmount: z.number().min(100).optional(),
    antiFractioningMaxCount: z.number().int().min(1).optional(),
    antiFractioningAction: z.enum(["ALLOW", "APPLY_FEE", "BLOCK", "ALERT"]).optional(),
});

// POST /api/settings/request (Maker System)
router.post('/request', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !staff.isActive) {
            return res.status(403).json({ error: 'Accès non autorisé.' });
        }

        const { payload, reason, action } = req.body;

        if (!reason || reason.trim().length < 5) {
            return res.status(400).json({ error: 'Une raison descriptive est obligatoire pour toute modification des paramètres.' });
        }

        // Validation Zod
        const parsed = settingsSchema.safeParse(payload);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        // Ne pas stocker un masque de clé comme nouvelle clé
        if (parsed.data.airtelApiKey?.startsWith('••••••••')) delete parsed.data.airtelApiKey;
        if (parsed.data.moovApiKey?.startsWith('••••••••')) delete parsed.data.moovApiKey;
        if (parsed.data.pvitSecretKey?.startsWith('••••••••')) delete parsed.data.pvitSecretKey;
        if (parsed.data.pvitWebhookSecret?.startsWith('••••••••')) delete parsed.data.pvitWebhookSecret;

        const approvalRequest = await prisma.settingsApproval.create({
            data: {
                makerId: staff.id,
                action: action || 'UPDATE_PARAMETERS',
                payload: JSON.stringify(parsed.data),
                reason: reason
            }
        });

        return res.json({ message: 'Requête soumise. Un second agent habilité doit l\'approuver (règle Maker/Checker : l\'auteur ne peut pas approuver sa propre demande).', requestId: approvalRequest.id });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

// POST /api/settings/approve/:id (Checker System)
router.post('/approve/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(staff.role)) {
            return res.status(403).json({ error: 'Seule la Haute Direction (Checker) peut approuver ces règles.' });
        }

        const approval = await prisma.settingsApproval.findUnique({ where: { id: req.params.id as string } });
        if (!approval) return res.status(404).json({ error: 'Requête introuvable.' });
        if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Cette requête a déjà été traitée.' });

        // Anti-auto-approbation (Maker/Checker) — le SUPER_ADMIN, autorité ultime de la
        // plateforme, en est exempté : sans cette exception, une instance ne comptant
        // qu'un seul compte staff actif ne pourrait plus jamais rien approuver.
        if (approval.makerId === staff.id && staff.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Un Checker ne peut pas approuver sa propre requête.' });
        }

        const payload = JSON.parse(approval.payload);
        const settings = await getSystemSettings();

        if (approval.action === 'CUSTOMER_LIMIT_INCREASE') {
            await prisma.$transaction([
                prisma.settingsApproval.update({
                    where: { id: approval.id },
                    data: { status: 'APPROVED', checkerId: staff.id }
                }),
                prisma.user.update({
                    where: { id: payload.customerId },
                    data: {
                        [payload.limitType]: payload.requestedValue,
                        customLimitExpiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null
                    }
                }),
                prisma.auditLog.create({
                    data: {
                        adminId: staff.id,
                        action: 'CUSTOMER_LIMIT_INCREASE',
                        details: `[MAKER/CHECKER] Limite ${payload.limitType} changée à ${payload.requestedValue} pour le client ${payload.customerId} par ${approval.makerId}, Validé par ${staff.id}. Raison: ${approval.reason}.`
                    }
                })
            ]);
        } else {
            // Comportement standard pour les SystemSettings
            await prisma.$transaction([
                prisma.settingsApproval.update({
                    where: { id: approval.id },
                    data: { status: 'APPROVED', checkerId: staff.id }
                }),
                prisma.systemSettings.update({
                    where: { id: settings.id },
                    data: payload
                }),
                // Configuration Tracker V2 (Prompt 07)
                ...Object.keys(payload).map(key => {
                    const oldV = (settings as any)[key];
                    const newV = payload[key];
                    if (oldV !== newV && newV !== undefined) {
                        return prisma.settingHistory.create({
                            data: {
                                category: 'SYSTEM',
                                parameter: key,
                                oldValue: maskSecretForHistory(key, oldV),
                                newValue: maskSecretForHistory(key, newV),
                                authorId: approval.makerId,
                                checkerId: staff.id,
                                reason: approval.reason,
                                status: 'APPLIED'
                            }
                        });
                    }
                    return null;
                }).filter((p): p is any => p !== null),
                prisma.auditLog.create({
                    data: {
                        adminId: staff.id,
                        action: approval.action,
                        details: `[MAKER/CHECKER] Modification Système par ${approval.makerId}, Validé par ${staff.id}. Raison: ${approval.reason}. Diff: ${approval.payload}`
                    }
                })
            ]);
            invalidateSettingsCache();
        }

        return res.json({ message: 'Modifications appliquées de façon sécurisée.' });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

// GET /api/settings/requests
router.get('/requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(staff.role)) {
            return res.status(403).json({ error: 'Accès non autorisé.' });
        }

        const requests = await prisma.settingsApproval.findMany({
            orderBy: { createdAt: 'desc' },
            include: { maker: { select: { name: true, role: true } }, checker: { select: { name: true, role: true } } }
        });
        return res.json(requests);
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

// DELETE /api/settings/requests/:id
router.delete('/requests/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(staff.role)) {
            return res.status(403).json({ error: 'Seule la Haute Direction peut rejeter une requête.' });
        }

        const approval = await prisma.settingsApproval.findUnique({ where: { id: req.params.id as string } });
        if (!approval) return res.status(404).json({ error: 'Introuvable' });
        if (approval.status !== 'PENDING') return res.status(400).json({ error: 'Cette requête a déjà été traitée.' });

        await prisma.settingsApproval.update({
            where: { id: req.params.id as string },
            data: { status: 'REJECTED' }
        });
        return res.json({ message: 'Requête rejetée.' });
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur' });
    }
});

// GET /api/settings/history (Prompt 07)
router.get('/history', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!staff || !['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(staff.role)) {
            return res.status(403).json({ error: 'Accès non autorisé.' });
        }

        const history = await prisma.settingHistory.findMany({
            orderBy: { createdAt: 'desc' },
            include: { author: { select: { name: true, role: true } }, checker: { select: { name: true, role: true } } }
        });
        return res.json(history);
    } catch (e: any) {
        return res.status(500).json({ error: 'Erreur Serveur.' });
    }
});

export default router;

