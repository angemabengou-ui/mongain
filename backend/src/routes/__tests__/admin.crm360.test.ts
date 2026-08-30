import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminRoutes from '../admin';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: {
        getApplicableLimits: jest.fn().mockResolvedValue({
            baseDaily: 50000, baseMonthly: 1000000, basePerTx: 50000,
            isCustomActive: false, effectiveDaily: 50000, effectiveMonthly: 1000000, effectivePerTx: 50000
        })
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findUnique: jest.fn(), update: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn() },
        auditLog: { findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
        riskFlag: { create: jest.fn(), count: jest.fn() },
        reclamation: { count: jest.fn(), findMany: jest.fn() },
        tontineContribution: { count: jest.fn() },
        notification: { create: jest.fn() },
        settingsApproval: { findFirst: jest.fn(), create: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
        $transaction: jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', name: 'Admin', role: 'SUPER_ADMIN' };
const RISK = { id: 'test_staff_id', name: 'Risk', role: 'RISK' };
const SUPPORT_MAKER = { id: 'test_staff_id', name: 'Support', role: 'SUPPORT_MAKER' };
const TELLER = { id: 'test_staff_id', name: 'Teller', role: 'TELLER' };
const UNKNOWN_ROLE = { id: 'test_staff_id', role: 'RANDOM_ROLE' };

describe('Admin CRM360 Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // attachAuditActors calls staff.findMany / user.findMany internally
        (prisma.staff as any).findMany = jest.fn().mockResolvedValue([]);
        (prisma.user as any).findMany = jest.fn().mockResolvedValue([]);
        (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(0);
    });

    describe('GET /admin/users/:id/360', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(UNKNOWN_ROLE);
            const res = await request(app).get('/admin/users/u1/360');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/users/u1/360');

            expect(res.status).toBe(404);
        });

        it('devrait retourner la vue 360 complète pour un accès sensible', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', name: 'Jean', wallet: { id: 'w1', balance: 5000 }, riskFlags: [], reclamations: []
            });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 'tx1' }]);
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.riskFlag.count as jest.Mock).mockResolvedValue(2);
            (prisma.reclamation.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/users/u1/360');

            expect(res.status).toBe(200);
            expect(res.body.recentTx).toHaveLength(1);
            expect(res.body.openRiskFlagsCount).toBe(2);
            expect(res.body.reclamationsCount).toBe(1);
        });

        it('devrait masquer les champs sensibles pour BRANCH_MANAGER/TELLER', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', name: 'Jean', riskFlags: [], reclamations: []
            });
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.riskFlag.count as jest.Mock).mockResolvedValue(0);
            (prisma.reclamation.count as jest.Mock).mockResolvedValue(0);

            const res = await request(app).get('/admin/users/u1/360');

            expect(res.status).toBe(200);
            expect(res.body.recentTx).toEqual([]);
            // TELLER n'a pas perm_tontine_view (voir admin.search.test.ts) — le score interne,
            // usage RISK/gestion tontine, ne doit pas fuiter vers un rôle guichet.
            expect(res.body.tontineReliability).toBeNull();
            expect(prisma.tontineContribution.count).not.toHaveBeenCalled();
        });

        it('devrait calculer le score de fiabilité tontine pour un rôle avec perm_tontine_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', name: 'Jean', riskFlags: [], reclamations: []
            });
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.riskFlag.count as jest.Mock).mockResolvedValue(0);
            (prisma.reclamation.count as jest.Mock).mockResolvedValue(0);
            // 10 cycles dus au total, 7 payés intégralement (status PAID), 2 pénalisés pour retard.
            (prisma.tontineContribution.count as jest.Mock)
                .mockResolvedValueOnce(10) // total
                .mockResolvedValueOnce(7)  // PAID
                .mockResolvedValueOnce(2); // pénalités

            const res = await request(app).get('/admin/users/u1/360');

            expect(res.status).toBe(200);
            expect(res.body.tontineReliability).toEqual({
                totalCycles: 10, paidCycles: 7, partialOrMissedCycles: 3, penaltiesCount: 2, scorePercent: 70,
            });
        });

        it("devrait renvoyer scorePercent=null (pas 0%) quand le client n'a jamais participé à une tontine", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', name: 'Jean', riskFlags: [], reclamations: []
            });
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.riskFlag.count as jest.Mock).mockResolvedValue(0);
            (prisma.reclamation.count as jest.Mock).mockResolvedValue(0);
            (prisma.tontineContribution.count as jest.Mock).mockResolvedValue(0);

            const res = await request(app).get('/admin/users/u1/360');

            expect(res.status).toBe(200);
            expect(res.body.tontineReliability.totalCycles).toBe(0);
            expect(res.body.tontineReliability.scorePercent).toBeNull();
        });
    });

    describe('POST /admin/users/:id/block', () => {
        it('devrait retourner 403 pour un rôle non RISK/SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/users/u1/block').send({ reason: 'Fraude suspectée' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le motif est trop court', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/users/u1/block').send({ reason: 'ab' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/users/u1/block').send({ reason: 'Fraude suspectée' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si déjà suspendu', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', accountStatus: 'SUSPENDED' });

            const res = await request(app).post('/admin/users/u1/block').send({ reason: 'Fraude suspectée' });

            expect(res.status).toBe(400);
        });

        it('devrait bloquer le compte avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', phone: '+241X', accountStatus: 'ACTIVE' });

            const res = await request(app).post('/admin/users/u1/block').send({ reason: 'Fraude suspectée' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/users/:id/unblock', () => {
        it('devrait retourner 400 si le motif est trop court', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/users/u1/unblock').send({ reason: 'ab' });
            expect(res.status).toBe(400);
        });

        it('devrait débloquer le compte avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', phone: '+241X' });

            const res = await request(app).post('/admin/users/u1/unblock').send({ reason: 'Enquête close, RAS' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/users/:id/flag', () => {
        it('devrait retourner 400 si la description manque', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/users/u1/flag').send({});
            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 pour un type invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/users/u1/flag').send({ type: 'INVALID_TYPE', description: 'Test' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/users/u1/flag').send({ description: 'Suspicion' });

            expect(res.status).toBe(404);
        });

        it('devrait créer un flag avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241X' });
            (prisma.riskFlag.create as jest.Mock).mockResolvedValue({ id: 'flag1', type: 'SUSPICIOUS_ACTIVITY' });

            const res = await request(app).post('/admin/users/u1/flag').send({ description: 'Suspicion' });

            expect(res.status).toBe(200);
            expect(res.body.flag.id).toBe('flag1');
        });
    });

    describe('GET /admin/users/:id/transactions', () => {
        it('devrait retourner 404 si le client ou wallet est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/users/u1/transactions');

            expect(res.status).toBe(404);
        });

        it('devrait retourner les transactions paginées', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', wallet: { id: 'w1' } });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 'tx1' }]);
            (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/users/u1/transactions');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
        });

        it("devrait inclure l'id de l'utilisateur du sender/receiverWallet (Customer360.tsx en a besoin pour déterminer le sens entrant/sortant de chaque transaction)", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', wallet: { id: 'w1' } });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
            (prisma.transaction.count as jest.Mock).mockResolvedValue(0);

            await request(app).get('/admin/users/u1/transactions');

            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                include: expect.objectContaining({
                    senderWallet: expect.objectContaining({ include: expect.objectContaining({ user: expect.objectContaining({ select: expect.objectContaining({ id: true }) }) }) }),
                    receiverWallet: expect.objectContaining({ include: expect.objectContaining({ user: expect.objectContaining({ select: expect.objectContaining({ id: true }) }) }) }),
                }),
            }));
        });
    });

    describe('GET /admin/users/:id/cash-ops', () => {
        it('devrait retourner 404 si le wallet est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/users/u1/cash-ops');

            expect(res.status).toBe(404);
        });

        it('devrait retourner les métriques anti-fractionnement', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', wallet: { id: 'w1' } });
            (prisma.transaction.findMany as jest.Mock)
                .mockResolvedValueOnce([]) // cashIns
                .mockResolvedValueOnce([]); // cashOuts

            const res = await request(app).get('/admin/users/u1/cash-ops');

            expect(res.status).toBe(200);
            expect(res.body.antiFractioning.flagged).toBe(false);
        });
    });

    describe('GET /admin/users/:id/security', () => {
        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/users/u1/security');

            expect(res.status).toBe(404);
        });

        it('devrait retourner les infos de sécurité du client', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241X', lockedUntil: null, failedPinAttempts: 0 });
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/users/u1/security');

            expect(res.status).toBe(200);
            expect(res.body.isLocked).toBe(false);
        });
    });

    describe('POST /admin/users/:id/unlock-account', () => {
        it('devrait retourner 400 si le motif est manquant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/users/u1/unlock-account').send({});
            expect(res.status).toBe(400);
        });

        it('devrait déverrouiller le compte avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', phone: '+241X' });

            const res = await request(app).post('/admin/users/u1/unlock-account').send({ reason: 'Client vérifié par téléphone' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/users/:id/revoke-sessions', () => {
        it('devrait retourner 403 pour un rôle non RISK/SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/users/u1/revoke-sessions').send({ reason: 'Compromission' });
            expect(res.status).toBe(403);
        });

        it('devrait révoquer les sessions avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', phone: '+241X' });

            const res = await request(app).post('/admin/users/u1/revoke-sessions').send({ reason: 'Compromission suspectée' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /admin/users/:id/audit', () => {
        it('devrait retourner les logs paginés du client', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([{ id: 'l1', adminId: 'test_staff_id' }]);
            (prisma.auditLog.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/users/u1/audit');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
        });
    });

    describe('GET /admin/users/:id/reclamations', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(UNKNOWN_ROLE);
            const res = await request(app).get('/admin/users/u1/reclamations');
            expect(res.status).toBe(403);
        });

        it('devrait retourner les réclamations du client', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            (prisma.reclamation.findMany as jest.Mock).mockResolvedValue([{ id: 'rec1' }]);

            const res = await request(app).get('/admin/users/u1/reclamations');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    describe('GET /admin/users/:id/limits-view', () => {
        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/users/u1/limits-view');

            expect(res.status).toBe(404);
        });

        it('devrait retourner les limites calculées du client', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', kycLevel: 1, kycStatus: 'APPROVED' });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({});

            const res = await request(app).get('/admin/users/u1/limits-view');

            expect(res.status).toBe(200);
            expect(res.body.tierName).toContain('TIER 1');
            expect(res.body.effectiveDaily).toBe(50000);
        });
    });

    describe('POST /admin/users/:id/limit-request', () => {
        it('devrait retourner 400 pour un type de limite invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/users/u1/limit-request').send({ limitType: 'bogus', requestedValue: 100, reason: 'x' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 au-dessus du plafond réglementaire', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/users/u1/limit-request').send({ limitType: 'customDailyLimit', requestedValue: 20000000, reason: 'x' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si une demande est déjà en attente', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.settingsApproval.findFirst as jest.Mock).mockResolvedValue({ id: 'existing_req' });

            const res = await request(app).post('/admin/users/u1/limit-request').send({ limitType: 'customDailyLimit', requestedValue: 100000, reason: 'VIP client' });

            expect(res.status).toBe(400);
        });

        it('devrait soumettre la demande avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.settingsApproval.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.settingsApproval.create as jest.Mock).mockResolvedValue({ id: 'appr1' });

            const res = await request(app).post('/admin/users/u1/limit-request').send({ limitType: 'customDailyLimit', requestedValue: 100000, reason: 'VIP client' });

            expect(res.status).toBe(200);
            expect(res.body.approvalId).toBe('appr1');
        });
    });
});
