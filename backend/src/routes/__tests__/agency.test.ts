import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import agencyRoutes from '../agency';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'teller_1';
        next();
    }
}));

const TELLER = { id: 'teller_1', name: 'Teller', role: 'TELLER', isActive: true, branchId: 'branch_1', permissionsCustomized: false, permissions: [] };

jest.mock('../../prisma', () => ({
    prisma: {
        staff: {
            findUnique: jest.fn()
        },
        cashSession: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            findMany: jest.fn()
        },
        branch: {
            findUnique: jest.fn()
        },
        reconciliationCase: {
            create: jest.fn()
        },
        auditLog: {
            create: jest.fn()
        },
        $executeRaw: jest.fn(),
        $transaction: jest.fn((callback) => callback(prisma))
    },
}));

const app = express();
app.use(express.json());
app.use('/agency', agencyRoutes);

describe('Agency Routes - POST /sessions/open', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
        (prisma.$executeRaw as jest.Mock).mockResolvedValue(undefined);
        (prisma.$transaction as jest.Mock).mockImplementation((callback: any) => callback(prisma));
    });

    it("refuse une deuxième session si une session OPEN existe déjà pour ce teller (verrou advisory)", async () => {
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue({ id: 'sess_1', status: 'OPEN' });

        const res = await request(app).post('/agency/sessions/open').send({ initialCash: 5000 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/déjà une session/);
        expect(prisma.cashSession.create).not.toHaveBeenCalled();
        // Le verrou advisory doit être acquis AVANT la lecture de l'état existant, sinon la
        // course entre deux ouvertures concurrentes reste possible.
        expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('ouvre une session quand aucune session OPEN n\'existe pour ce teller', async () => {
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue(null);
        (prisma.cashSession.create as jest.Mock).mockResolvedValue({ id: 'sess_2', status: 'OPEN', tellerId: 'teller_1', branchId: 'branch_1', initialCash: 5000 });

        const res = await request(app).post('/agency/sessions/open').send({ initialCash: 5000 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(prisma.cashSession.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ tellerId: 'teller_1', branchId: 'branch_1', status: 'OPEN' })
        }));
        expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('refuse un rôle sans perm_cash_session_open', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...TELLER, role: 'COMPLIANCE_CHECKER' });

        const res = await request(app).post('/agency/sessions/open').send({ initialCash: 5000 });

        expect(res.status).toBe(403);
        expect(prisma.cashSession.create).not.toHaveBeenCalled();
    });
});

describe('Agency Routes - POST /sessions/close', () => {
    const OPEN_SESSION = { id: 'sess_1', tellerId: 'teller_1', branchId: 'branch_1', status: 'OPEN', initialCash: 1000, totalCashInValue: 500, totalCashOutValue: 200 };

    beforeEach(() => {
        jest.resetAllMocks();
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
    });

    it("refuse une deuxième clôture concurrente (réclamation atomique déjà prise)", async () => {
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue(OPEN_SESSION);
        (prisma.cashSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

        const res = await request(app).post('/agency/sessions/close').send({ finalCash: 1300 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/vient d'être clôturée/);
        expect(prisma.reconciliationCase.create).not.toHaveBeenCalled();
    });

    it('clôture avec succès et crée un ReconciliationCase en cas d\'écart', async () => {
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue(OPEN_SESSION);
        (prisma.cashSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (prisma.cashSession.findUnique as jest.Mock).mockResolvedValue({ ...OPEN_SESSION, status: 'CLOSED', finalCash: 1400, discrepancy: 100 });

        const res = await request(app).post('/agency/sessions/close').send({ finalCash: 1400 });

        expect(res.status).toBe(200);
        expect(res.body.session.discrepancy).toBe(100);
        expect(prisma.reconciliationCase.create).toHaveBeenCalledTimes(1);
    });
});

describe('Agency Routes - GET /info', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
    });

    it("renvoie ma session active même si elle n'est pas dans les 10 sessions les plus récentes de l'agence (agence à forte activité)", async () => {
        // Simule une agence où 10 AUTRES tellers ont ouvert une session plus récemment que
        // la mienne — `sessions` (limité à 10, toute l'agence) ne la contient donc plus,
        // mais la recherche dédiée `myActiveSession` doit la trouver quand même.
        (prisma.branch.findUnique as jest.Mock).mockResolvedValue({
            id: 'branch_1', name: 'Agence Centrale', balance: 100000,
            sessions: Array.from({ length: 10 }, (_, i) => ({ id: `other_sess_${i}`, tellerId: `other_teller_${i}`, status: 'OPEN' })),
        });
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue({ id: 'my_sess', tellerId: 'teller_1', status: 'OPEN', teller: { id: 'teller_1', name: 'Teller' } });

        const res = await request(app).get('/agency/info');

        expect(res.status).toBe(200);
        expect(res.body.myActiveSession).toEqual(expect.objectContaining({ id: 'my_sess', status: 'OPEN' }));
        expect(prisma.cashSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { tellerId: 'teller_1', status: 'OPEN' },
        }));
    });

    it("renvoie myActiveSession: null quand ce teller n'a aucune session ouverte", async () => {
        (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'branch_1', name: 'Agence Centrale', balance: 100000, sessions: [] });
        (prisma.cashSession.findFirst as jest.Mock).mockResolvedValue(null);

        const res = await request(app).get('/agency/info');

        expect(res.status).toBe(200);
        expect(res.body.myActiveSession).toBeNull();
    });
});
