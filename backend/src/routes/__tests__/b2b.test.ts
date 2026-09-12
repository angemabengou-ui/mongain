import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import b2bRoutes from '../b2b';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'merchant_1';
        next();
    },
}));

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        invoice: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        payoutBulk: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        payoutEntry: { update: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn() },
        transaction: { create: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn() },
}));

jest.mock('../../utils/pinAuth', () => ({
    verifyUserPin: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({}),
}));

const app = express();
app.use(express.json());
app.use('/b2b', b2bRoutes);

describe('B2B Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /b2b/invoices', () => {
        const merchant = { id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1' } };

        it('devrait refuser un montant négatif — inverserait le sens du paiement à /pay', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/invoices').send({ customerPhone: '074000000', amount: -5000 });

            expect(res.status).toBe(400);
            expect(prisma.invoice.create).not.toHaveBeenCalled();
        });

        it('devrait refuser un montant nul ou non numérique', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/invoices').send({ customerPhone: '074000000', amount: 'abc' });

            expect(res.status).toBe(400);
            expect(prisma.invoice.create).not.toHaveBeenCalled();
        });

        it('devrait créer la facture pour un montant positif valide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv1', amount: 5000 });

            const res = await request(app).post('/b2b/invoices').send({ customerPhone: '074000000', amount: 5000 });

            expect(res.status).toBe(201);
            expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ amount: 5000 })
            }));
        });
    });

    describe('POST /b2b/payouts', () => {
        const merchant = { id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1', balance: 1000000 } };

        it('devrait refuser tout le lot si une entrée a un montant négatif (vol de fonds sinon)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [
                    { phone: '074000001', amount: 10000 },
                    { phone: '074999999', amount: -999999 }, // victime arbitraire, montant négatif
                ]
            });

            expect(res.status).toBe(400);
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

        it('devrait refuser un lot avec un téléphone manquant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ amount: 10000 }]
            });

            expect(res.status).toBe(400);
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

        it('devrait accepter un lot valide avec uniquement des montants positifs', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.payoutBulk.create as jest.Mock).mockResolvedValue({ id: 'bulk1', entries: [] });
            (prisma.payoutBulk.findUnique as jest.Mock).mockResolvedValue({ id: 'bulk1', entries: [] });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 1000000 });
            (prisma.payoutBulk.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }],
                pin: '1234'
            });

            expect(res.status).toBe(202);
            expect(prisma.payoutBulk.create).toHaveBeenCalled();
        });

        it('devrait refuser un virement de masse sans PIN (régression : débitait le marchand sans consentement explicite)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }]
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/PIN requis/);
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

        it('devrait refuser un virement de masse si le PIN est incorrect', async () => {
            const { verifyUserPin } = require('../../utils/pinAuth');
            (verifyUserPin as jest.Mock).mockResolvedValueOnce({ ok: false, status: 400, error: 'Code PIN incorrect. Tentative 1/3.' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }],
                pin: '0000'
            });

            expect(res.status).toBe(400);
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

        it('ne devrait pas retraiter un lot déjà soumis avec la même clé d\'idempotence (régression : double-clic/retry payait deux fois chaque bénéficiaire)', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.payoutBulk.findUnique as jest.Mock).mockResolvedValue({ id: 'bulk_existant', entries: [] });

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }],
                pin: '1234',
                idempotencyKey: 'clef-abc-123'
            });

            expect(res.status).toBe(202);
            expect(res.body.bulkId).toBe('bulk_existant');
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

        it('devrait créer un nouveau lot et enregistrer sa clé d\'idempotence si elle est inédite', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.payoutBulk.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.payoutBulk.create as jest.Mock).mockResolvedValue({ id: 'bulk_neuf', entries: [] });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 1000000 });

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }],
                pin: '1234',
                idempotencyKey: 'clef-neuve-456'
            });

            expect(res.status).toBe(202);
            expect(prisma.payoutBulk.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ idempotencyKey: 'clef-neuve-456' })
            }));
        });
    });
});
