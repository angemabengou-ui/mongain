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

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        branch: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
        wallet: { create: jest.fn() },
        cashSession: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
        transaction: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), aggregate: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const BRANCH_MANAGER = { id: 'test_staff_id', role: 'BRANCH_MANAGER', branchId: 'branch_1' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin Branches (Agency Ops) Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/branches', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/branches');
            expect(res.status).toBe(403);
        });

        it('devrait limiter un BRANCH_MANAGER à sa propre agence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(BRANCH_MANAGER);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre' });

            const res = await request(app).get('/admin/branches');

            expect(res.status).toBe(200);
            expect(res.body).toEqual([{ id: 'branch_1', name: 'Agence Centre' }]);
        });

        it('devrait retourner la liste paginée pour un SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findMany as jest.Mock).mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
            (prisma.branch.count as jest.Mock).mockResolvedValue(2);

            const res = await request(app).get('/admin/branches');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(2);
            expect(res.body.branches).toHaveLength(2);
        });
    });

    describe('POST /admin/branches', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/branches').send({ name: 'X', code: 'X1' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si nom ou code manque', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/branches').send({ name: 'Agence Test' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 409 si le code existe déjà', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'existing', code: 'AG1' });

            const res = await request(app).post('/admin/branches').send({ name: 'Agence Test', code: 'AG1' });

            expect(res.status).toBe(409);
        });

        it('devrait créer une agence avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.wallet.create as jest.Mock).mockResolvedValue({ id: 'wallet_1' });
            (prisma.branch.create as jest.Mock).mockResolvedValue({ id: 'branch_new', name: 'Agence Test', code: 'AG1' });

            const res = await request(app).post('/admin/branches').send({ name: 'Agence Test', code: 'AG1', city: 'Libreville' });

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.branch.id).toBe('branch_new');
            expect(prisma.auditLog.create).toHaveBeenCalled();
        });
    });

    describe('PATCH /admin/branches/:id', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).patch('/admin/branches/branch_1').send({ status: 'ACTIVE' });
            expect(res.status).toBe(403);
        });

        it('devrait bloquer le changement de code si des transactions existent', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', code: 'OLD' });
            (prisma.transaction.count as jest.Mock).mockResolvedValue(5);

            const res = await request(app).patch('/admin/branches/branch_1').send({ code: 'NEW' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('immuable');
        });

        it('devrait mettre à jour l\'agence avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.update as jest.Mock).mockResolvedValue({ id: 'branch_1', code: 'AG1', status: 'ACTIVE' });

            const res = await request(app).patch('/admin/branches/branch_1').send({ status: 'ACTIVE' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /admin/branches/:id (Agency 360)', () => {
        it('devrait retourner 403 si accès restreint (BM sur une autre agence)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(BRANCH_MANAGER);
            const res = await request(app).get('/admin/branches/other_branch');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si l\'agence est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/branches/branch_x');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le détail complet de l\'agence avec stats', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre' });
            (prisma.transaction.aggregate as jest.Mock)
                .mockResolvedValueOnce({ _sum: { amount: 1000 }, _count: { id: 2 } })
                .mockResolvedValueOnce({ _sum: { amount: 500 }, _count: { id: 1 } });
            (prisma.cashSession.count as jest.Mock)
                .mockResolvedValueOnce(1) // activeSessions
                .mockResolvedValueOnce(0); // discrepancies

            const res = await request(app).get('/admin/branches/branch_1');

            expect(res.status).toBe(200);
            expect(res.body.stats.cashInToday).toBe(1000);
            expect(res.body.stats.cashOutToday).toBe(500);
            expect(res.body.stats.volumeToday).toBe(1500);
        });
    });

    describe('GET /admin/branches/:id/staff', () => {
        it('devrait retourner la liste du staff de l\'agence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Jean' }]);

            const res = await request(app).get('/admin/branches/branch_1/staff');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    describe('POST /admin/branches/:id/staff/:staffId/assign', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/branches/branch_1/staff/s1/assign');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le staff cible est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN) // admin lookup
                .mockResolvedValueOnce(null); // target lookup

            const res = await request(app).post('/admin/branches/branch_1/staff/s1/assign');

            expect(res.status).toBe(404);
        });

        it('devrait assigner le staff à l\'agence avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', name: 'Jean', role: 'TELLER' });
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', branchId: 'branch_1' });

            const res = await request(app).post('/admin/branches/branch_1/staff/s1/assign');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('DELETE /admin/branches/:id/staff/:staffId/unassign', () => {
        it('devrait retourner 400 si le staff n\'est pas assigné à cette agence', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', branchId: 'other_branch' });

            const res = await request(app).delete('/admin/branches/branch_1/staff/s1/unassign');

            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si le caissier a une session ouverte', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', branchId: 'branch_1' });
            (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue({ id: 'sess_1', status: 'OPEN' });

            const res = await request(app).delete('/admin/branches/branch_1/staff/s1/unassign');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('session ouverte');
        });

        it('devrait désassigner le staff avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', branchId: 'branch_1' });
            (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', branchId: null });

            const res = await request(app).delete('/admin/branches/branch_1/staff/s1/unassign');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /admin/branches/:id/tellers', () => {
        it('devrait retourner les tellers avec leur session active', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.findMany as jest.Mock).mockResolvedValue([
                { id: 't1', name: 'Teller 1', cashSessions: [{ id: 'sess1' }] },
                { id: 't2', name: 'Teller 2', cashSessions: [] },
            ]);

            const res = await request(app).get('/admin/branches/branch_1/tellers');

            expect(res.status).toBe(200);
            expect(res.body[0].activeSession).toEqual({ id: 'sess1' });
            expect(res.body[1].activeSession).toBeNull();
        });
    });

    describe('GET /admin/branches/:id/sessions', () => {
        it('devrait retourner les sessions paginées', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.cashSession.findMany as jest.Mock).mockResolvedValue([{ id: 'sess1' }]);
            (prisma.cashSession.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/branches/branch_1/sessions');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
        });
    });

    describe('GET /admin/branches/:id/cash-operations', () => {
        it('devrait retourner les opérations paginées avec filtres', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 'tx1' }]);
            (prisma.transaction.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/branches/branch_1/cash-operations?type=CASH_IN');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
            expect(res.body.operations).toHaveLength(1);
        });
    });

    describe('GET /admin/branches/:id/cash-operations/:txId', () => {
        it('devrait retourner 404 si la transaction n\'appartient pas à l\'agence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', branchId: 'other_branch' });

            const res = await request(app).get('/admin/branches/branch_1/cash-operations/tx1');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le détail de l\'opération', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', branchId: 'branch_1' });

            const res = await request(app).get('/admin/branches/branch_1/cash-operations/tx1');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('tx1');
        });
    });

    describe('GET /admin/branches/:id/vault', () => {
        it('devrait retourner 404 si l\'agence est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/branches/branch_x/vault');

            expect(res.status).toBe(404);
        });

        it('devrait retourner l\'état du coffre', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre', code: 'AG1', balance: 100000, status: 'ACTIVE', wallet: { balance: 50000 } });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/branches/branch_1/vault');

            expect(res.status).toBe(200);
            expect(res.body.physicalCash).toBe(100000);
            expect(res.body.electronicBalance).toBe(50000);
        });
    });

    describe('GET /admin/branches/:id/reconciliation', () => {
        it('devrait retourner 404 si l\'agence est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/branches/branch_x/reconciliation');

            expect(res.status).toBe(404);
        });

        it('devrait calculer le rapprochement quotidien', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre', balance: 1000, wallet: { balance: 1000 } });
            (prisma.cashSession.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/branches/branch_1/reconciliation');

            expect(res.status).toBe(200);
            expect(res.body.varianceStatus).toBe('OK');
        });
    });

    describe('GET /admin/branches/:id/alerts', () => {
        it('devrait retourner 404 si l\'agence est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/branches/branch_x/alerts');

            expect(res.status).toBe(404);
        });

        it('devrait générer des alertes pour une agence suspendue et faible liquidité', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ agencyWithdrawThreshold: 500000 });
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre', status: 'SUSPENDED', balance: 0, wallet: { balance: 0 } });
            (prisma.cashSession.count as jest.Mock).mockResolvedValue(0);

            const res = await request(app).get('/admin/branches/branch_1/alerts');

            expect(res.status).toBe(200);
            expect(res.body.alerts.some((a: any) => a.type === 'SUSPENDED')).toBe(true);
            expect(res.body.alerts.some((a: any) => a.type === 'LOW_LIQUIDITY')).toBe(true);
        });
    });

    describe('GET /admin/staff/unassigned', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/staff/unassigned');
            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste du staff non assigné', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.findMany as jest.Mock).mockResolvedValue([{ id: 's1', name: 'Jean' }]);

            const res = await request(app).get('/admin/staff/unassigned');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    describe('POST /admin/branches/:id/fund', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: 1000 });
            expect(res.status).toBe(403);
        });

        it('devrait bloquer si le Circuit Breaker est activé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: true });

            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: 1000 });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Circuit Breaker');
        });

        it('devrait retourner 400 pour un montant invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });

            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: -5 });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si la succursale est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: 1000 });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si les fonds HQ sont insuffisants', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre' });
            (prisma.branch.findFirst as jest.Mock).mockResolvedValue({ id: 'hq_1', balance: 500 });

            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: 1000 });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Fonds insuffisants');
        });

        it('devrait transférer la liquidité avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centre' });
            (prisma.branch.findFirst as jest.Mock).mockResolvedValue({ id: 'hq_1', balance: 10000 });
            (prisma.branch.update as jest.Mock)
                .mockResolvedValueOnce({ id: 'hq_1', balance: 9000 })
                .mockResolvedValueOnce({ id: 'branch_1', balance: 1000 });

            const res = await request(app).post('/admin/branches/branch_1/fund').send({ amount: 1000 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.auditLog.create).toHaveBeenCalled();
        });
    });
});
