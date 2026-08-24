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
        user: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        riskFlag: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        verificationCode: { upsert: jest.fn() },
        settingsApproval: { findMany: jest.fn() },
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
const SUPPORT_MAKER = { id: 'test_staff_id', role: 'SUPPORT_MAKER' };

describe('Admin Customers/Teller Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/customers', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/customers');
            expect(res.status).toBe(403);
        });

        it('devrait retourner les clients paginés (segment USER par défaut)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.$transaction as jest.Mock).mockResolvedValue([[{ id: 'c1' }], 1]);

            const res = await request(app).get('/admin/customers');

            expect(res.status).toBe(200);
            expect(res.body.customers).toHaveLength(1);
            expect(res.body.total).toBe(1);
        });

        it('devrait filtrer par segment ALL (USER + MERCHANT)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.$transaction as jest.Mock).mockResolvedValue([[], 0]);

            const res = await request(app).get('/admin/customers?role=ALL');

            expect(res.status).toBe(200);
        });
    });

    describe('POST /admin/users/:id/logout-all', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/users/u1/logout-all');
            expect(res.status).toBe(403);
        });

        it('devrait invalider toutes les sessions avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);

            const res = await request(app).post('/admin/users/u1/logout-all');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/users/:id/risk-flags', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/users/u1/risk-flags').send({ description: 'Suspicious activity here' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si la description est trop courte', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/users/u1/risk-flags').send({ description: 'ab' });
            expect(res.status).toBe(400);
        });

        it('devrait créer un flag de risque avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);

            const res = await request(app).post('/admin/users/u1/risk-flags').send({ type: 'FRAUD_REPORT', description: 'Activité suspecte détectée' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/users/:id/reset-pin-request', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'COMPLIANCE_CHECKER' });
            const res = await request(app).post('/admin/users/u1/reset-pin-request').send({ reason: 'Client oublié' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le motif est manquant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/users/u1/reset-pin-request').send({});
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si l\'utilisateur est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/users/u1/reset-pin-request').send({ reason: 'Client oublié son PIN' });

            expect(res.status).toBe(404);
        });

        it('devrait déclencher la procédure OTP avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', phone: '+241066123456' });

            const res = await request(app).post('/admin/users/u1/reset-pin-request').send({ reason: 'Client oublié son PIN' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('GET /admin/users/:id/limit-requests', () => {
        it('devrait retourner 403 si le staff est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await request(app).get('/admin/users/u1/limit-requests');
            expect(res.status).toBe(403);
        });

        it('devrait retourner les demandes de limite du client', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.settingsApproval.findMany as jest.Mock).mockResolvedValue([{ id: 'req1' }]);

            const res = await request(app).get('/admin/users/u1/limit-requests');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
        });
    });

    describe('GET /admin/teller/lookup/:phone', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'SUPPORT_MAKER' });
            const res = await request(app).get('/admin/teller/lookup/066123456');
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si le client est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'TELLER' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/teller/lookup/066123456');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le client trouvé, avec ses photos KYC pour vérification en agence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'x', role: 'TELLER' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', name: 'Jean', phone: '066123456', kycStatus: 'APPROVED', role: 'USER',
                idCardFront: 'https://cdn/front.jpg', idCardBack: 'https://cdn/back.jpg', selfie: 'https://cdn/selfie.jpg',
            });

            const res = await request(app).get('/admin/teller/lookup/066123456');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('u1');
            expect(res.body.selfie).toBe('https://cdn/selfie.jpg');
            expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                select: expect.objectContaining({ idCardFront: true, idCardBack: true, selfie: true }),
            }));
        });
    });
});
