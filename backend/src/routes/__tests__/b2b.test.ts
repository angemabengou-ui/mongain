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
        merchantEmployee: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
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

        // Garde de canal : un marchand géant ne peut initier un paiement de masse que depuis
        // le portail web dédié (voir routes/merchant-portal.ts POST /payouts), jamais depuis
        // le mobile — même principe que wallet.ts /transfer, /client-initiated-withdraw...
        it('devrait refuser un paiement de masse depuis le mobile pour un marchand géant', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ ...merchant, merchantTier: 'GIANT' });

            const res = await request(app).post('/b2b/payouts').send({
                name: 'Paie',
                entries: [{ phone: '074000001', amount: 10000 }],
                pin: '1234'
            });

            expect(res.status).toBe(403);
            expect(prisma.payoutBulk.create).not.toHaveBeenCalled();
        });

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

    // ==========================================
    // RÉPERTOIRE D'EMPLOYÉS (MARCHAND MOBILE)
    // ==========================================
    // Même modèle que routes/merchant-portal.ts côté géant — voir sa propre couverture pour ce
    // même comportement côté portail web.
    describe('GET /b2b/employees', () => {
        const merchant = { id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1' } };

        it('devrait refuser un non-marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'client_1', role: 'USER' });

            const res = await request(app).get('/b2b/employees');

            expect(res.status).toBe(403);
        });

        it('devrait lister les employés actifs du marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            const mockEmployees = [{ id: 'emp1', name: 'Jean', phone: '074000001' }];
            (prisma.merchantEmployee.findMany as jest.Mock).mockResolvedValue(mockEmployees);

            const res = await request(app).get('/b2b/employees');

            expect(res.status).toBe(200);
            expect(res.body.employees).toEqual(mockEmployees);
            expect(prisma.merchantEmployee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { merchantId: 'merchant_1', isActive: true } }));
        });
    });

    describe('POST /b2b/employees', () => {
        const merchant = { id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1' } };

        it('devrait refuser un non-marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'client_1', role: 'USER' });

            const res = await request(app).post('/b2b/employees').send({ name: 'Jean', phone: '074000001' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le nom ou le téléphone manque', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);

            const res = await request(app).post('/b2b/employees').send({ name: 'Jean' });

            expect(res.status).toBe(400);
            expect(prisma.merchantEmployee.create).not.toHaveBeenCalled();
        });

        it('devrait créer un employé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.merchantEmployee.create as jest.Mock).mockResolvedValue({ id: 'emp1', name: 'Jean', phone: '074000001' });

            const res = await request(app).post('/b2b/employees').send({ name: 'Jean', phone: '074000001' });

            expect(res.status).toBe(201);
            expect(prisma.merchantEmployee.create).toHaveBeenCalledWith({
                data: { merchantId: 'merchant_1', name: 'Jean', phone: '074000001' },
            });
        });

        it('devrait retourner 409 en cas de doublon (P2002 sur @@unique([merchantId, phone]))', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.merchantEmployee.create as jest.Mock).mockRejectedValue({ code: 'P2002' });

            const res = await request(app).post('/b2b/employees').send({ name: 'Jean', phone: '074000001' });

            expect(res.status).toBe(409);
        });
    });

    describe('DELETE /b2b/employees/:id', () => {
        const merchant = { id: 'merchant_1', role: 'MERCHANT', wallet: { id: 'w1' } };

        it('devrait retourner 404 si l\'employé n\'appartient pas à ce marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.merchantEmployee.findUnique as jest.Mock).mockResolvedValue({ id: 'emp1', merchantId: 'un_autre_marchand' });

            const res = await request(app).delete('/b2b/employees/emp1');

            expect(res.status).toBe(404);
        });

        it('devrait désactiver (pas supprimer) l\'employé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(merchant);
            (prisma.merchantEmployee.findUnique as jest.Mock).mockResolvedValue({ id: 'emp1', merchantId: 'merchant_1' });
            (prisma.merchantEmployee.update as jest.Mock).mockResolvedValue({ id: 'emp1', isActive: false });

            const res = await request(app).delete('/b2b/employees/emp1');

            expect(res.status).toBe(200);
            expect(prisma.merchantEmployee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { isActive: false } });
        });
    });
});
