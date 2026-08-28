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
        staff: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const RISK = { id: 'test_staff_id', role: 'RISK' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin Staff Management Routes', () => {
    beforeEach(() => {
        // resetAllMocks (pas clearAllMocks) : plusieurs tests ci-dessous enchaînent des
        // mockResolvedValueOnce (ex. admin lookup + target staff lookup) — clearAllMocks
        // n'efface que l'historique d'appels, jamais ces valeurs mises en file, qui fuitaient
        // donc vers le test suivant dès qu'un test n'en consommait pas exactement autant
        // qu'il en empilait (voir POST /admin/staff, qui réassigne même le mock entier).
        jest.resetAllMocks();
    });

    describe('GET /admin/staff', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/staff');
            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste paginée du personnel', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.$transaction as jest.Mock).mockResolvedValue([[{ id: 's1' }], 1]);

            const res = await request(app).get('/admin/staff');

            expect(res.status).toBe(200);
            expect(res.body.staff).toHaveLength(1);
            expect(res.body.total).toBe(1);
        });
    });

    describe('POST /admin/staff', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/staff').send({});
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour des données invalides ou incomplètes', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/staff').send({ email: 'not-an-email' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si l\'email est déjà attribué', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.findMany as jest.Mock); // unused
            (prisma.staff as any).findUnique = jest.fn()
                .mockResolvedValueOnce(SUPER_ADMIN) // admin lookup
                .mockResolvedValueOnce({ id: 'existing_staff' }); // email uniqueness

            const res = await request(app).post('/admin/staff').send({
                email: 'staff@mongain.com', name: 'Jean Staff', password: 'secret1', role: 'TELLER',
                matricule: 'MAT001', cni: 'CNI001', phone: '066123456'
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('déjà attribué');
        });

        it('devrait créer un compte staff en attente avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce(null);
            (prisma.staff.create as jest.Mock).mockResolvedValue({ id: 'staff_new', email: 'staff@mongain.com', role: 'TELLER' });

            const res = await request(app).post('/admin/staff').send({
                email: 'staff@mongain.com', name: 'Jean Staff', password: 'secret1', role: 'TELLER',
                matricule: 'MAT001', cni: 'CNI001', phone: '066123456'
            });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('EN ATTENTE');
        }, 10000);
    });

    describe('PUT /admin/staff/:id/approve', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).put('/admin/staff/s1/approve');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le staff cible est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce(null);

            const res = await request(app).put('/admin/staff/s1/approve');

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si le compte est déjà actif', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' });

            const res = await request(app).put('/admin/staff/s1/approve');

            expect(res.status).toBe(400);
        });

        it('devrait refuser l\'auto-approbation par le recruteur (non SUPER_ADMIN)', async () => {
            // RISK n'a pas perm_staff_manage par défaut (RBAC.ts — jamais accordée à un rôle
            // non-admin) : depuis la correction de ce contrôle, RISK est désormais rejeté avant
            // même d'atteindre la règle métier d'auto-approbation ci-dessous, qu'il faut donc
            // tester via une surcharge de permissions explicite plutôt qu'un simple rôle RISK.
            const RISK_WITH_STAFF_MANAGE = { id: 'test_staff_id', role: 'RISK', permissionsCustomized: true, permissions: ['perm_staff_manage'] };
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(RISK_WITH_STAFF_MANAGE)
                .mockResolvedValueOnce({ id: 's1', status: 'PENDING', createdById: 'test_staff_id' });

            const res = await request(app).put('/admin/staff/s1/approve');

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('ne peut pas approuver');
        });

        it('devrait approuver un recrutement avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock)
                .mockResolvedValueOnce(SUPER_ADMIN)
                .mockResolvedValueOnce({ id: 's1', status: 'PENDING', createdById: 'someone_else', matricule: 'MAT001' });
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', status: 'ACTIVE' });

            const res = await request(app).put('/admin/staff/s1/approve');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('PUT /admin/staff/:id', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).put('/admin/staff/s1').send({ role: 'TELLER' });
            expect(res.status).toBe(403);
        });

        it('devrait mettre à jour le rôle et l\'agence du staff', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', role: 'BRANCH_MANAGER', matricule: 'MAT001', name: 'Jean' });

            const res = await request(app).put('/admin/staff/s1').send({ role: 'BRANCH_MANAGER', branchId: 'b1' });

            expect(res.status).toBe(200);
            expect(prisma.staff.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ role: 'BRANCH_MANAGER', branchId: 'b1' })
            }));
        });

        it('devrait incrémenter jwtVersion lors d\'une suspension (isActive: false)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', isActive: false, matricule: 'MAT001', name: 'Jean' });

            const res = await request(app).put('/admin/staff/s1').send({ isActive: false });

            expect(res.status).toBe(200);
            expect(prisma.staff.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ isActive: false, jwtVersion: { increment: 1 } })
            }));
        });

        it('ne devrait pas écraser branchId si la clé est absente du body', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.staff.update as jest.Mock).mockResolvedValue({ id: 's1', matricule: 'MAT001', name: 'Jean' });

            const res = await request(app).put('/admin/staff/s1').send({ role: 'TELLER' });

            expect(res.status).toBe(200);
            const updateCall = (prisma.staff.update as jest.Mock).mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('branchId');
        });
    });
});
