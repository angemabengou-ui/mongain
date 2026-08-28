import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import settingsRoutes from '../settings';

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
