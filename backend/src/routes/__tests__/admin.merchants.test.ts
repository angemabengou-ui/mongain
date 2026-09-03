import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminRoutes from '../admin.merchants';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'staff_1';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findMany: jest.fn(), findUnique: jest.fn() },
        transaction: { findMany: jest.fn() },
        merchantPayoutRequest: { findUnique: jest.fn(), updateMany: jest.fn() },
        notification: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

jest.mock('../wallet', () => ({
    getOrCreateCorporateWallet: jest.fn().mockResolvedValue({ wallet: { id: 'w_corporate', balance: 0 } }),
    sendPush: jest.fn().mockResolvedValue(undefined),
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'staff_1', role: 'SUPER_ADMIN' };
const RISK = { id: 'staff_1', role: 'RISK' };
const COMPLIANCE_CHECKER = { id: 'staff_1', role: 'COMPLIANCE_CHECKER' };
const TELLER = { id: 'staff_1', role: 'TELLER' };

describe('Admin Merchants Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/merchants', () => {
        it('devrait retourner 403 pour un rôle sans perm_merchant_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/merchants');
            expect(res.status).toBe(403);
        });

        it('devrait être accessible en lecture à COMPLIANCE_CHECKER', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(COMPLIANCE_CHECKER);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/merchants');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /admin/merchants/:id', () => {
        it('devrait retourner 404 si le marchand est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await request(app).get('/admin/merchants/m1');
            expect(res.status).toBe(404);
        });

        it("devrait exposer canManage=false pour COMPLIANCE_CHECKER (lecture seule)", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(COMPLIANCE_CHECKER);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'm1', role: 'MERCHANT', wallet: { id: 'w1', balance: 1000 }, commissionWallet: null, merchantPayoutRequests: [] });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/merchants/m1');
            expect(res.status).toBe(200);
            expect(res.body.canManage).toBe(false);
        });

        it('devrait exposer canManage=true pour RISK', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'm1', role: 'MERCHANT', wallet: { id: 'w1', balance: 1000 }, commissionWallet: { id: 'wc1', balance: 200 }, merchantPayoutRequests: [] });
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/merchants/m1');
            expect(res.body.canManage).toBe(true);
        });
    });

    describe('POST /admin/merchants/:id/payouts/:payoutId/approve', () => {
        it('devrait retourner 403 pour un rôle sans perm_merchant_manage (ex: COMPLIANCE_CHECKER)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(COMPLIANCE_CHECKER);
            const res = await request(app).post('/admin/merchants/m1/payouts/p1/approve');
            expect(res.status).toBe(403);
        });

        it('COMMISSION : devrait consolider vers le wallet principal', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const payout = { id: 'p1', merchantId: 'm1', sourceAccount: 'COMMISSION', amount: 500, status: 'PENDING' };
            const tx = {
                merchantPayoutRequest: {
                    findUnique: jest.fn().mockResolvedValue(payout),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                user: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', wallet: { id: 'w1', balance: 1000 }, commissionWallet: { id: 'wc1', balance: 500 } }) },
                wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
                transaction: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/merchants/m1/payouts/p1/approve');

            expect(res.status).toBe(200);
            expect(tx.wallet.updateMany).toHaveBeenCalledWith({ where: { id: 'wc1', balance: { gte: 500 } }, data: { balance: { decrement: 500 } } });
            expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { balance: { increment: 500 } } });
            expect(tx.transaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ senderWalletId: 'wc1', receiverWalletId: 'w1', reference: 'MPAYOUT-p1' }),
            });
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'APPROVE_MERCHANT_PAYOUT' }),
            }));
        });

        it('SALES : devrait débiter le wallet principal et créditer le corporate en compensation', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const payout = { id: 'p2', merchantId: 'm1', sourceAccount: 'SALES', amount: 2000, status: 'PENDING' };
            const tx = {
                merchantPayoutRequest: {
                    findUnique: jest.fn().mockResolvedValue(payout),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                user: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', wallet: { id: 'w1', balance: 5000 }, commissionWallet: null }) },
                wallet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
                transaction: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/merchants/m1/payouts/p2/approve');

            expect(res.status).toBe(200);
            expect(tx.wallet.updateMany).toHaveBeenCalledWith({ where: { id: 'w1', balance: { gte: 2000 } }, data: { balance: { decrement: 2000 } } });
            expect(tx.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_corporate' }, data: { balance: { increment: 2000 } } });
            expect(tx.transaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ senderWalletId: 'w1', receiverWalletId: 'w_corporate', reference: 'MPAYOUT-p2' }),
            });
        });

        it('devrait retourner 400 si la demande a déjà été traitée', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const tx = { merchantPayoutRequest: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', merchantId: 'm1', status: 'EXECUTED' }) } };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/merchants/m1/payouts/p1/approve');

            expect(res.status).toBe(400);
        });

        it('devrait retourner 400 si le solde commission est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const payout = { id: 'p1', merchantId: 'm1', sourceAccount: 'COMMISSION', amount: 500, status: 'PENDING' };
            const tx = {
                merchantPayoutRequest: {
                    findUnique: jest.fn().mockResolvedValue(payout),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                user: { findUnique: jest.fn().mockResolvedValue({ id: 'm1', wallet: { id: 'w1', balance: 1000 }, commissionWallet: { id: 'wc1', balance: 100 } }) },
                wallet: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn() },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/merchants/m1/payouts/p1/approve');

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('insuffisant');
        });
    });

    describe('POST /admin/merchants/:id/payouts/:payoutId/reject', () => {
        it('devrait exiger un motif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/merchants/m1/payouts/p1/reject').send({});
            expect(res.status).toBe(400);
        });

        it('devrait rejeter la demande et tracer un AuditLog', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.merchantPayoutRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', merchantId: 'm1', amount: 500, status: 'PENDING' });
            (prisma.merchantPayoutRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

            const res = await request(app).post('/admin/merchants/m1/payouts/p1/reject').send({ reason: 'Justificatif manquant' });

            expect(res.status).toBe(200);
            expect(prisma.merchantPayoutRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'p1', status: 'PENDING' },
                data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Justificatif manquant' }),
            }));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'REJECT_MERCHANT_PAYOUT' }),
            }));
        });
    });
});
