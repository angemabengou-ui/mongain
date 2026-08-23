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
        user: { findMany: jest.fn() },
        branch: { findFirst: jest.fn() },
        centralTreasury: { findFirst: jest.fn(), create: jest.fn() },
        transaction: { findMany: jest.fn() },
    },
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('Admin System Accounts Routes (lecture seule)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/system-accounts', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);

            const res = await request(app).get('/admin/system-accounts');

            expect(res.status).toBe(403);
        });

        it('devrait retourner la Trésorerie Centrale et les comptes système (rôle ADMIN)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({
                id: 'ct_1', name: 'Trésorerie Centrale Mongain', walletId: 'w_ct', wallet: { id: 'w_ct', balance: 79840000 }
            });
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'u_gateway', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)', phone: '+24133333333', createdAt: new Date(), wallet: { id: 'w_gateway', balance: 1000000499 } },
                { id: 'u_no_wallet', name: 'Compte orphelin', phone: '+241000', createdAt: new Date(), wallet: null }
            ]);

            const res = await request(app).get('/admin/system-accounts');

            expect(res.status).toBe(200);
            expect(res.body.accounts).toHaveLength(2);
            expect(res.body.accounts[0]).toMatchObject({ kind: 'CENTRAL_TREASURY', balance: 79840000, walletId: 'w_ct' });
            expect(res.body.accounts[1]).toMatchObject({ kind: 'SYSTEM_USER', balance: 1000000499, walletId: 'w_gateway', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)' });
        });
    });

    describe('GET /admin/system-accounts/:walletId/transactions', () => {
        it('devrait retourner 403 pour un rôle non autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);

            const res = await request(app).get('/admin/system-accounts/w_gateway/transactions');

            expect(res.status).toBe(403);
        });

        it('devrait retourner les mouvements où ce wallet est émetteur ou destinataire', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const txs = [{ id: 'tx1', amount: 5000, senderWalletId: 'w_gateway' }];
            (prisma.transaction.findMany as jest.Mock).mockResolvedValue(txs);

            const res = await request(app).get('/admin/system-accounts/w_gateway/transactions');

            expect(res.status).toBe(200);
            expect(res.body.transactions).toEqual(txs);
            expect(prisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { OR: [{ senderWalletId: 'w_gateway' }, { receiverWalletId: 'w_gateway' }] },
            }));
        });
    });
});
