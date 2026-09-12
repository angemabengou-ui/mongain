import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import settingsRoutes, { invalidateSettingsCache } from '../settings';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'staff_1';
        next();
    }
}));

const BASE_SETTINGS = {
    id: 1, taxP2P: 0.01, adminIpAllowlistEnabled: false, adminIpAllowlist: [] as string[],
};

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        systemSettings: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        settingsApproval: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        settingHistory: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn((ops) => Promise.all(Array.isArray(ops) ? ops : [ops])),
    },
}));

const app = express();
app.use(express.json());
app.use('/settings', settingsRoutes);

const CHECKER = { id: 'staff_1', role: 'COMPLIANCE_CHECKER', permissionsCustomized: false, permissions: [] };

describe('POST /settings/approve/:id — garde anti-auto-verrouillage (restriction IP)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        // Le cache mémoire de getSystemSettings (TTL 5s, voir settings.ts) survit entre les
        // tests de ce fichier — sans l'invalider ici, un describe pourrait lire les settings
        // mockées par le describe précédent au lieu de celles fraîchement mockées ci-dessous.
        invalidateSettingsCache();
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(BASE_SETTINGS);
    });

    // Découvre l'IP que l'environnement de test (supertest, connexion HTTP réelle en local)
    // reporte réellement, pour construire des payloads cohérents avec la vraie valeur de
    // req.ip observée par le middleware — plutôt que de deviner une forme (v4 vs v4-mappée-v6).
    const discoverTestIp = async (): Promise<string> => {
        const res = await request(app).get('/settings/my-ip');
        return res.body.ip;
    };

    it("refuse d'approuver une activation avec une liste vide", async () => {
        (prisma.settingsApproval.findUnique as jest.Mock).mockResolvedValue({
            id: 'req_1', status: 'PENDING', makerId: 'staff_2', action: 'UPDATE_PARAMETERS',
            payload: JSON.stringify({ adminIpAllowlistEnabled: true, adminIpAllowlist: [] }),
        });

        const res = await request(app).post('/settings/approve/req_1');

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/liste vide/);
        expect(prisma.settingsApproval.update).not.toHaveBeenCalled();
    });

    it("refuse d'approuver si l'IP du Checker qui approuve n'est pas dans la liste proposée", async () => {
        (prisma.settingsApproval.findUnique as jest.Mock).mockResolvedValue({
            id: 'req_1', status: 'PENDING', makerId: 'staff_2', action: 'UPDATE_PARAMETERS',
            payload: JSON.stringify({ adminIpAllowlistEnabled: true, adminIpAllowlist: ['198.51.100.1'] }),
        });

        const res = await request(app).post('/settings/approve/req_1');

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/n'est pas dans la liste/);
        expect(prisma.settingsApproval.update).not.toHaveBeenCalled();
    });

    it("approuve normalement quand l'IP du Checker figure dans la liste proposée", async () => {
        const myIp = await discoverTestIp();
        (prisma.settingsApproval.findUnique as jest.Mock).mockResolvedValue({
            id: 'req_1', status: 'PENDING', makerId: 'staff_2', action: 'UPDATE_PARAMETERS',
            payload: JSON.stringify({ adminIpAllowlistEnabled: true, adminIpAllowlist: [myIp] }),
        });

        const res = await request(app).post('/settings/approve/req_1');

        expect(res.status).toBe(200);
        expect(prisma.settingsApproval.update).toHaveBeenCalled();
    });

    it("n'applique aucune vérification IP quand le payload ne touche pas à la restriction (paramètres sans rapport)", async () => {
        (prisma.settingsApproval.findUnique as jest.Mock).mockResolvedValue({
            id: 'req_1', status: 'PENDING', makerId: 'staff_2', action: 'UPDATE_PARAMETERS',
            payload: JSON.stringify({ taxP2P: 0.02 }),
        });

        const res = await request(app).post('/settings/approve/req_1');

        expect(res.status).toBe(200);
        expect(prisma.settingsApproval.update).toHaveBeenCalled();
    });

    it("n'exige pas la présence de l'IP du Checker quand la restriction reste désactivée", async () => {
        (prisma.settingsApproval.findUnique as jest.Mock).mockResolvedValue({
            id: 'req_1', status: 'PENDING', makerId: 'staff_2', action: 'UPDATE_PARAMETERS',
            payload: JSON.stringify({ adminIpAllowlistEnabled: false, adminIpAllowlist: ['198.51.100.1'] }),
        });

        const res = await request(app).post('/settings/approve/req_1');

        expect(res.status).toBe(200);
        expect(prisma.settingsApproval.update).toHaveBeenCalled();
    });
});

describe('GET /settings/ (public) — ne renvoie plus que l\'allowlist minimale', () => {
    // Réplique une ligne SystemSettings réaliste : les seuils anti-fraude, les plafonds par
    // palier et l'allowlist IP admin étaient jusqu'ici renvoyés en clair à n'importe quel
    // appelant non authentifié — voir docs/AUTO_CRITIQUE_PROJET.md section 8.4.
    const FULL_SETTINGS = {
        id: 1,
        airtelEnabled: true, moovEnabled: false, seegEnabled: true, tontineEnabled: true,
        taxP2P: 0.01, taxWithdraw: 0.013, bnplInterest: 0.05, forexMarkup: 0.02,
        antiFractioningMaxAmount: 100000, antiFractioningMaxCount: 5, antiFractioningWindowHours: 24,
        kycReqAmount: 2000000, dailyLimitTier0: 50000, monthlyLimitTier0: 1000000,
        adminIpAllowlistEnabled: true, adminIpAllowlist: ['203.0.113.5'],
        globalMaintenance: false, circuitBreaker: false,
        airtelApiKey: 'sk_live_abcdef123456', pvitWebhookSecret: 'whsec_super_secret_value',
    };

    beforeEach(() => {
        jest.resetAllMocks();
        // Le cache mémoire de getSystemSettings (TTL 5s, voir settings.ts) survit entre les
        // tests de ce fichier — sans l'invalider ici, un describe pourrait lire les settings
        // mockées par le describe précédent au lieu de celles fraîchement mockées ci-dessous.
        invalidateSettingsCache();
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(FULL_SETTINGS);
    });

    it('ne renvoie que les champs publics (tarifs affichés, bascules de fonctionnalité)', async () => {
        const res = await request(app).get('/settings/');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            airtelEnabled: true, moovEnabled: false, seegEnabled: true, tontineEnabled: true,
            taxP2P: 0.01, taxWithdraw: 0.013, bnplInterest: 0.05, forexMarkup: 0.02,
        });
    });

    it('ne fuit jamais les seuils anti-fraude, les plafonds ou l\'allowlist IP admin', async () => {
        const res = await request(app).get('/settings/');

        expect(res.body.antiFractioningMaxAmount).toBeUndefined();
        expect(res.body.kycReqAmount).toBeUndefined();
        expect(res.body.dailyLimitTier0).toBeUndefined();
        expect(res.body.adminIpAllowlist).toBeUndefined();
        expect(res.body.adminIpAllowlistEnabled).toBeUndefined();
        expect(res.body.circuitBreaker).toBeUndefined();
        expect(res.body.airtelApiKey).toBeUndefined();
    });
});

describe('GET /settings/full — configuration complète, réservée au staff habilité', () => {
    // adminIpAllowlistEnabled: false — ce test vérifie le contrôle de PERMISSION de /full, pas
    // adminIpAllowlistMiddleware (couvert par le describe tout en haut de ce fichier) : à true,
    // l'IP locale de supertest ne matcherait jamais '203.0.113.5' et bloquerait en 403 pour une
    // raison sans rapport avec ce qui est testé ici.
    const FULL_SETTINGS = {
        id: 1, taxP2P: 0.01, adminIpAllowlistEnabled: false, adminIpAllowlist: ['203.0.113.5'],
        airtelApiKey: 'sk_live_abcdef123456',
    };

    beforeEach(() => {
        jest.resetAllMocks();
        // Le cache mémoire de getSystemSettings (TTL 5s, voir settings.ts) survit entre les
        // tests de ce fichier — sans l'invalider ici, un describe pourrait lire les settings
        // mockées par le describe précédent au lieu de celles fraîchement mockées ci-dessous.
        invalidateSettingsCache();
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(FULL_SETTINGS);
    });

    it('refuse un staff sans perm_system_settings_view', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
            id: 'staff_1', role: 'SUPPORT_MAKER', permissionsCustomized: false, permissions: [],
        });

        const res = await request(app).get('/settings/full');

        expect(res.status).toBe(403);
    });

    it('renvoie la configuration complète (secrets masqués) pour un staff habilité', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
            id: 'staff_1', role: 'SUPER_ADMIN', permissionsCustomized: false, permissions: [],
        });

        const res = await request(app).get('/settings/full');

        expect(res.status).toBe(200);
        expect(res.body.adminIpAllowlist).toEqual(['203.0.113.5']);
        expect(res.body.adminIpAllowlistEnabled).toBe(false);
        expect(res.body.airtelApiKey).toBe('••••••••3456');
    });
});
