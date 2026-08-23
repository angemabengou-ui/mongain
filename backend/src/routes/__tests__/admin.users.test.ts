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
        staff: { findUnique: jest.fn() },
        user: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        reclamation: { create: jest.fn() },
        auditLog: { create: jest.fn(), findMany: jest.fn() },
        transaction: { findMany: jest.fn() },
        branch: { findUnique: jest.fn() },
        $transaction: jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', name: 'Admin', role: 'SUPER_ADMIN' };
const SUPPORT_MAKER = { id: 'test_staff_id', name: 'Support', role: 'SUPPORT_MAKER' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin Users/Logs/Ledger Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /admin/users/:id/reclamation', () => {
        it('devrait retourner 403 pour un rôle sans accès support', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'BRANCH_MANAGER_UNKNOWN' });
            const res = await request(app).post('/admin/users/u1/reclamation').send({ title: 'T', description: 'D' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/users/u1/reclamation').send({ title: 'T', description: 'D' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si titre ou description manque', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+24100000000' });

            const res = await request(app).post('/admin/users/u1/reclamation').send({ title: 'T' });

            expect(res.status).toBe(400);
        });

        it('devrait créer une réclamation avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+24100000000' });
            (prisma.reclamation.create as jest.Mock).mockResolvedValue({ id: 'rec_1' });

            const res = await request(app).post('/admin/users/u1/reclamation').send({ title: 'T', description: 'D' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.reclamation.id).toBe('rec_1');
        });
    });

    describe('GET /admin/users', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/users');
            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste des utilisateurs', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

            const res = await request(app).get('/admin/users');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
        });

        it('devrait filtrer par rôle si fourni', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', role: 'AGENT' }]);

            const res = await request(app).get('/admin/users?role=AGENT');

            expect(res.status).toBe(200);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'AGENT' } }));
        });
    });

    describe('POST /admin/users/create-pro', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/users/create-pro').send({});
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour des données invalides', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).post('/admin/users/create-pro').send({ phone: '066123456' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si le téléphone est déjà pris', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' });

            const res = await request(app).post('/admin/users/create-pro').send({
                phone: '066123456', name: 'Marchand X', role: 'MERCHANT', pin: '1234'
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('déjà pris');
        });

        it('devrait créer un compte pro avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u_new' });

            const res = await request(app).post('/admin/users/create-pro').send({
                phone: '066123456', name: 'Marchand X', role: 'MERCHANT', pin: '1234'
            });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('créé avec succès');
        }, 10000);
    });

    describe('POST /admin/users/:id/toggle-status', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/users/u1/toggle-status');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/users/u1/toggle-status');

            expect(res.status).toBe(404);
        });

        it('devrait refuser de désactiver un Administrateur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'ADMIN', isActive: true, phone: '+241X' });

            const res = await request(app).post('/admin/users/u1/toggle-status');

            expect(res.status).toBe(400);
        });

        it('devrait basculer le statut avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'USER', isActive: true, phone: '+241X' });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', isActive: false });

            const res = await request(app).post('/admin/users/u1/toggle-status');

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('SUSPENDU');
        });
    });

    describe('PUT /admin/users/:id', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).put('/admin/users/u1').send({ name: 'X', phone: '066123456' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour des données invalides', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).put('/admin/users/u1').send({ name: 'A' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/admin/users/u1').send({ name: 'Nouveau Nom', phone: '066123456' });

            expect(res.status).toBe(404);
        });

        it('devrait refuser de modifier un autre Administrateur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'other_admin', role: 'ADMIN', phone: '066123456' });

            const res = await request(app).put('/admin/users/other_admin').send({ name: 'Nouveau Nom', phone: '066123456' });

            expect(res.status).toBe(403);
        });

        it('devrait mettre à jour le profil avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock)
                .mockReset()
                .mockResolvedValueOnce({ id: 'u1', role: 'USER', phone: '066000000', username: null }) // targetUser lookup
                .mockResolvedValueOnce(null); // uniqueness check on new phone
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Nouveau Nom', phone: '+241066123456' });

            const res = await request(app).put('/admin/users/u1').send({ name: 'Nouveau Nom', phone: '066123456' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('mis à jour');
        });
    });

    describe('PUT /admin/users/:id/branch', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).put('/admin/users/u1/branch').send({ branchId: 'b1' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour un rôle non Agent', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'USER' });

            const res = await request(app).put('/admin/users/u1/branch').send({ branchId: 'b1' });

            expect(res.status).toBe(400);
        });

        it('devrait rattacher un agent à une agence avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'AGENT', phone: '+241X' });
            (prisma.branch.findUnique as jest.Mock).mockResolvedValue({ id: 'b1' });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', branchId: 'b1' });

            const res = await request(app).put('/admin/users/u1/branch').send({ branchId: 'b1' });

            expect(res.status).toBe(200);
            expect(res.body.user.branchId).toBe('b1');
        });
    });

    describe('GET /admin/logs', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/logs');
            expect(res.status).toBe(403);
        });

        it('devrait retourner les logs avec les acteurs attachés', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([{ id: 'l1', adminId: 'test_staff_id' }]);
            // attachAuditActors makes internal staff.findMany / user.findMany calls
            (prisma.staff.findMany as any) = jest.fn().mockResolvedValue([{ id: 'test_staff_id', name: 'Admin', phone: null, role: 'SUPER_ADMIN' }]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/logs');

            expect(res.status).toBe(200);
            expect(res.body[0].admin.name).toBe('Admin');
        });
    });

    describe('GET /admin/ledger', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/ledger');
            expect(res.status).toBe(403);
        });

        it('devrait retourner les transactions récentes', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([{ id: 'tx1' }]);

            const res = await request(app).get('/admin/ledger');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    describe('DELETE /admin/users/:id', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).delete('/admin/users/u1');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).delete('/admin/users/u1');

            expect(res.status).toBe(404);
        });

        it('devrait refuser de supprimer un autre Administrateur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'other_admin', role: 'ADMIN', phone: '+241X', wallet: {} });

            const res = await request(app).delete('/admin/users/other_admin');

            expect(res.status).toBe(403);
        });

        it('devrait effectuer un soft-delete avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', role: 'USER', phone: '+241X', username: 'jdoe', email: 'j@d.com', name: 'Jean', wallet: {} });
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1' });

            const res = await request(app).delete('/admin/users/u1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
