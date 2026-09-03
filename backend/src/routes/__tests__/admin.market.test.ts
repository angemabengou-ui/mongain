import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminMarketRoutes from '../admin.market';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

jest.mock('../wallet', () => ({
    sendPush: jest.fn(),
}));

jest.mock('../../services/systemAccounts', () => ({
    getSystemAccount: jest.fn().mockResolvedValue({ wallet: { id: 'escrow_wallet' } }),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        escrowTransaction: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/admin', adminMarketRoutes);

const RISK = { id: 'staff_1', role: 'RISK' };
const TELLER = { id: 'staff_1', role: 'TELLER' };

describe('Admin Market Escrow Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/market/escrow', () => {
        it('devrait retourner 403 pour un rôle sans perm_market_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/market/escrow');
            expect(res.status).toBe(403);
        });

        it('devrait lister les séquestres pour RISK', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.escrowTransaction.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/market/escrow');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    describe('POST /admin/market/escrow/:id/resolve', () => {
        it('devrait exiger decision et reason', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/market/escrow/e1/resolve').send({});
            expect(res.status).toBe(400);
        });

        it('devrait retourner 403 pour un rôle sans perm_market_manage', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).post('/admin/market/escrow/e1/resolve').send({ decision: 'REFUND_BUYER', reason: 'Objet jamais reçu' });
            expect(res.status).toBe(403);
        });

        it('REFUND_BUYER : devrait rembourser l\'acheteur, pas le vendeur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const escrow = { id: 'e1', status: 'LOCKED', amount: 5000, buyerId: 'buyer_1', sellerId: 'seller_1' };
            const tx = {
                escrowTransaction: {
                    findUnique: jest.fn().mockResolvedValue(escrow),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                wallet: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    update: jest.fn().mockResolvedValue({}),
                },
                user: { findUnique: jest.fn().mockResolvedValue({ id: 'buyer_1', phone: '+24100000000', pushToken: null, wallet: { id: 'buyer_wallet' } }) },
                transaction: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/market/escrow/e1/resolve')
                .send({ decision: 'REFUND_BUYER', reason: 'Vendeur injoignable, objet jamais expédié' });

            expect(res.status).toBe(200);
            expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'buyer_1' } }));
            expect(tx.escrowTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'REFUNDED' }),
            }));
        });

        it('RELEASE_TO_SELLER : devrait créditer le vendeur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const escrow = { id: 'e1', status: 'LOCKED', amount: 5000, buyerId: 'buyer_1', sellerId: 'seller_1' };
            const tx = {
                escrowTransaction: {
                    findUnique: jest.fn().mockResolvedValue(escrow),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                wallet: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    update: jest.fn().mockResolvedValue({}),
                },
                user: { findUnique: jest.fn().mockResolvedValue({ id: 'seller_1', phone: '+24100000001', pushToken: null, wallet: { id: 'seller_wallet' } }) },
                transaction: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/market/escrow/e1/resolve')
                .send({ decision: 'RELEASE_TO_SELLER', reason: 'Preuve de livraison fournie par le vendeur' });

            expect(res.status).toBe(200);
            expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'seller_1' } }));
            expect(tx.escrowTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ status: 'RELEASED' }),
            }));
        });

        it('devrait retourner 400 si le séquestre a déjà été traité', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const tx = { escrowTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 'e1', status: 'RELEASED' }) } };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/market/escrow/e1/resolve')
                .send({ decision: 'REFUND_BUYER', reason: 'Trop tard' });

            expect(res.status).toBe(400);
        });
    });
});
