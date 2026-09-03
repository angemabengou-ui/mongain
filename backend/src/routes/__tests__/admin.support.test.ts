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
        user: { findUnique: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
        reclamation: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        fraudCase: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        refundRequest: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        transaction: { findUnique: jest.fn(), create: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn() },
        notification: { create: jest.fn() },
        $transaction: jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg(prisma)),
    },
}));

jest.mock('../../services/sms', () => ({ sendSms: jest.fn() }));
jest.mock('../wallet', () => ({ sendPush: jest.fn().mockResolvedValue(undefined) }));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', name: 'Admin', role: 'SUPER_ADMIN' };
const SUPPORT_MAKER = { id: 'test_staff_id', name: 'Support', role: 'SUPPORT_MAKER' };
const RISK = { id: 'test_staff_id', name: 'Risk', role: 'RISK' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin Support/Fraud/Refund Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /admin/reclamations', () => {
        // TELLER a perm_ticket_create par défaut (RBAC.ts) : depuis la correction de ce
        // contrôle (qui vérifiait auparavant perm_ticket_resolve — clôturer un ticket, sans
        // rapport avec le fait d'en créer un), TELLER doit désormais réussir cet appel. RISK
        // n'a ni l'un ni l'autre, donc reste un bon exemple de rôle sans ce droit.
        it('devrait retourner 403 pour un rôle sans droit de création de ticket', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/reclamations').send({ title: 'T', description: 'D', userId: 'u1' });
            expect(res.status).toBe(403);
        });

        it('devrait autoriser un TELLER (perm_ticket_create) à créer un ticket', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.reclamation.create as jest.Mock).mockResolvedValue({ id: 'r1' });
            const res = await request(app).post('/admin/reclamations').send({ title: 'T', description: 'D', userId: 'u1' });
            expect(res.status).toBe(201);
        });

        it('devrait retourner 400 si des champs obligatoires manquent', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/reclamations').send({ title: 'T' });
            expect(res.status).toBe(400);
        });

        it('devrait créer un ticket avec échéance SLA calculée', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);
            (prisma.reclamation.create as jest.Mock).mockResolvedValue({ id: 'rec1' });

            const res = await request(app).post('/admin/reclamations').send({ title: 'T', description: 'D', userId: 'u1', priority: 'HIGH' });

            expect(res.status).toBe(201);
            expect(res.body.id).toBe('rec1');
        });
    });

    describe('POST /admin/fraud-cases', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/fraud-cases').send({ userId: 'u1', description: 'D' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si userId ou description manque', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/fraud-cases').send({ userId: 'u1' });
            expect(res.status).toBe(400);
        });

        it('devrait ouvrir un dossier de fraude avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.fraudCase.create as jest.Mock).mockResolvedValue({ id: 'fc1' });

            const res = await request(app).post('/admin/fraud-cases').send({ userId: 'u1', description: 'Activité suspecte' });

            expect(res.status).toBe(201);
            expect(res.body.id).toBe('fc1');
        });
    });

    describe('GET /admin/fraud-cases', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/fraud-cases');
            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste paginée des dossiers de fraude', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.fraudCase.findMany as jest.Mock).mockResolvedValue([{ id: 'fc1' }]);
            (prisma.fraudCase.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/fraud-cases');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
        });
    });

    describe('GET /admin/fraud-cases/:id', () => {
        it('devrait retourner 404 si le dossier est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.fraudCase.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/admin/fraud-cases/fc1');

            expect(res.status).toBe(404);
        });

        it('devrait retourner le détail du dossier', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.fraudCase.findUnique as jest.Mock).mockResolvedValue({ id: 'fc1' });

            const res = await request(app).get('/admin/fraud-cases/fc1');

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('fc1');
        });
    });

    describe('PATCH /admin/fraud-cases/:id', () => {
        it('devrait mettre à jour le dossier de fraude', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.fraudCase.update as jest.Mock).mockResolvedValue({ id: 'fc1', status: 'CLOSED' });

            const res = await request(app).patch('/admin/fraud-cases/fc1').send({ status: 'CLOSED', decision: 'CONFIRMED_FRAUD' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/refund-requests', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/refund-requests').send({});
            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si des champs obligatoires manquent', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/refund-requests').send({ transactionId: 'tx1' });
            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si la transaction est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/refund-requests').send({ transactionId: 'tx1', userId: 'u1', amount: 100, reason: 'Erreur' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si le montant dépasse la transaction originale', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', amount: 50 });

            const res = await request(app).post('/admin/refund-requests').send({ transactionId: 'tx1', userId: 'u1', amount: 100, reason: 'Erreur' });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 409 en cas de double remboursement (P2002)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', amount: 100 });
            (prisma.refundRequest.create as jest.Mock).mockRejectedValue({ code: 'P2002' });

            const res = await request(app).post('/admin/refund-requests').send({ transactionId: 'tx1', userId: 'u1', amount: 100, reason: 'Erreur' });

            expect(res.status).toBe(409);
        });

        it('devrait créer une demande de remboursement avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', amount: 100 });
            (prisma.refundRequest.create as jest.Mock).mockResolvedValue({ id: 'rf1' });

            const res = await request(app).post('/admin/refund-requests').send({ transactionId: 'tx1', userId: 'u1', amount: 100, reason: 'Erreur' });

            expect(res.status).toBe(201);
            expect(res.body.id).toBe('rf1');
        });
    });

    describe('GET /admin/refund-requests', () => {
        it('devrait retourner la liste paginée', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.refundRequest.findMany as jest.Mock).mockResolvedValue([{ id: 'rf1' }]);
            (prisma.refundRequest.count as jest.Mock).mockResolvedValue(1);

            const res = await request(app).get('/admin/refund-requests');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
        });
    });

    describe('PATCH /admin/refund-requests/:id/approve', () => {
        it('devrait retourner 403 pour un rôle non finance', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).patch('/admin/refund-requests/rf1/approve').send({ action: 'APPROVE' });
            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si la demande est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).patch('/admin/refund-requests/rf1/approve').send({ action: 'APPROVE' });

            expect(res.status).toBe(404);
        });

        it('devrait refuser l\'auto-approbation (Maker == Checker)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'rf1', requesterId: 'test_staff_id', status: 'REQUESTED' });

            const res = await request(app).patch('/admin/refund-requests/rf1/approve').send({ action: 'APPROVE' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le statut est incompatible', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'rf1', requesterId: 'other', status: 'EXECUTED' });

            const res = await request(app).patch('/admin/refund-requests/rf1/approve').send({ action: 'APPROVE' });

            expect(res.status).toBe(400);
        });

        it('devrait approuver la demande avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'rf1', requesterId: 'other', status: 'REQUESTED' });
            (prisma.refundRequest.update as jest.Mock).mockResolvedValue({ id: 'rf1', status: 'APPROVED' });

            const res = await request(app).patch('/admin/refund-requests/rf1/approve').send({ action: 'APPROVE' });

            expect(res.status).toBe(200);
            expect(res.body.refund.status).toBe('APPROVED');
        });
    });

    describe('POST /admin/refund-requests/:id/execute', () => {
        it('devrait retourner 403 pour un rôle non finance', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/refund-requests/rf1/execute');
            expect(res.status).toBe(403);
        });

        it('devrait bloquer si le Circuit Breaker est activé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: true });

            const res = await request(app).post('/admin/refund-requests/rf1/execute');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si la demande est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/admin/refund-requests/rf1/execute');

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si la demande n\'est pas APPROVED', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'rf1', status: 'REQUESTED' });

            const res = await request(app).post('/admin/refund-requests/rf1/execute');

            expect(res.status).toBe(400);
        });

        it('devrait exécuter le remboursement avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.refundRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'rf1', status: 'APPROVED', amount: 500, userId: 'u1', transactionId: 'tx1' });
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', receiverWalletId: 'w_counterpart', reference: 'TX-ORIG' });
            (prisma.wallet.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'w_user', userId: 'u1', balance: 0 }) // userWallet
                .mockResolvedValueOnce({ id: 'w_counterpart', balance: 10000 }); // counterpartWallet
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ phone: '077000000', pushToken: null });

            const txMock = {
                refundRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
                wallet: { update: jest.fn().mockResolvedValue({}) },
                transaction: { create: jest.fn().mockResolvedValue({}) },
                auditLog: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((arg: any) => {
                if (typeof arg === 'function') return arg(txMock);
                return Promise.all(arg);
            });

            const res = await request(app).post('/admin/refund-requests/rf1/execute');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(txMock.refundRequest.updateMany).toHaveBeenCalled();
        });
    });
});
