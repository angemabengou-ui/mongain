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
        user: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        auditLog: { create: jest.fn() },
        notification: { create: jest.fn() },
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const RISK = { id: 'test_staff_id', role: 'COMPLIANCE_CHECKER' }; // Renamed role for validation tests
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin KYC Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/users/kyc', () => {
        // TELLER a perm_customer_kyc_view par défaut (RBAC.ts — vérifier une pièce au
        // guichet) : depuis la correction de ce contrôle (qui n'acceptait auparavant QUE
        // perm_customer_kyc_validate, refusant même la simple lecture aux rôles voir-seul),
        // TELLER doit désormais réussir cet appel — voir le test dédié plus bas.
        it('devrait retourner 403 pour un rôle sans aucun droit KYC', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'test_staff_id', role: 'INVALID_ROLE' });
            const res = await request(app).get('/admin/users/kyc');
            expect(res.status).toBe(403);
        });

        it('devrait autoriser un TELLER (lecture seule via perm_customer_kyc_view)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/users/kyc');
            expect(res.status).toBe(200);
        });

        it('devrait retourner la liste des dossiers KYC en attente par défaut', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', kycStatus: 'PENDING' }]);

            const res = await request(app).get('/admin/users/kyc');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kycStatus: 'PENDING' } }));
        });

        it('devrait filtrer par statut demandé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/admin/users/kyc?status=APPROVED');

            expect(res.status).toBe(200);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kycStatus: 'APPROVED' } }));
        });
    });

    describe('PUT /admin/users/:id/vip-limit', () => {
        it('devrait retourner 403 pour un non SUPER_ADMIN', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).put('/admin/users/u1/vip-limit').send({ limitType: 'customDailyLimit', limit: 100000 });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 pour un plafond invalide', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const res = await request(app).put('/admin/users/u1/vip-limit').send({ limitType: 'customDailyLimit', limit: 50 });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/admin/users/u1/vip-limit').send({ limitType: 'customDailyLimit', limit: 100000 });

            expect(res.status).toBe(404);
        });

        it('devrait appliquer le plafond VIP avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241X' });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).put('/admin/users/u1/vip-limit').send({ limitType: 'customDailyLimit', limit: 100000 });

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ customDailyLimit: 100000 })
            }));
        });
    });

    describe('PUT /admin/users/:id/kyc', () => {
        it('devrait retourner 403 pour un rôle non KYC', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).put('/admin/users/u1/kyc').send({ status: 'APPROVED' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le motif de rejet est manquant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).put('/admin/users/u1/kyc').send({ status: 'REJECTED' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/admin/users/u1/kyc').send({ status: 'APPROVED' });

            expect(res.status).toBe(404);
        });

        it('devrait approuver le dossier KYC avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241X' });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).put('/admin/users/u1/kyc').send({ status: 'APPROVED' });

            expect(res.status).toBe(200);
            expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ title: expect.stringContaining('approuvée') })
            }));
        });

        it('devrait rejeter le dossier KYC avec un motif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241X' });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).put('/admin/users/u1/kyc').send({ status: 'REJECTED', reason: 'Documents illisibles' });

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ kycStatus: 'REJECTED', kycLevel: 0, kycRejectReason: 'Documents illisibles' })
            }));
        });
    });
});
