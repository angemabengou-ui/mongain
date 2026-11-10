import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import gatewayRoutes from '../gateway';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.userId = 'merchant_1';
        next();
    },
}));

// hash/compare mockés (même convention que vault.test.ts/family.test.ts) pour contrôler
// déterministement l'authentification par clé API sur POST /charge, sans dépendre du coût
// réel de bcrypt dans les tests.
jest.mock('bcryptjs', () => ({
    hash: jest.fn().mockResolvedValue('HASHED_SECRET'),
    compare: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        apiIntegration: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        apiLog: { create: jest.fn() },
        apiWebhookDelivery: { findUnique: jest.fn(), findMany: jest.fn() },
        invoice: { create: jest.fn() },
    },
}));

const mockSendPush = jest.fn().mockResolvedValue(undefined);
jest.mock('../wallet', () => ({
    sendPush: (...args: any[]) => mockSendPush(...args),
}));

const mockRetryWebhookDelivery = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/webhookDelivery', () => ({
    retryWebhookDelivery: (...args: any[]) => mockRetryWebhookDelivery(...args),
}));

const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use('/gateway', gatewayRoutes);

describe('Gateway Routes (Mongain Connect)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /gateway/keys/generate', () => {
        it('devrait refuser un non-marchand', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user_1', role: 'USER' });

            const res = await request(app).post('/gateway/keys/generate').send({});

            expect(res.status).toBe(403);
            expect(prisma.apiIntegration.create).not.toHaveBeenCalled();
        });

        it('devrait générer une intégration et renvoyer secret + webhookSigningSecret en clair une seule fois', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.create as jest.Mock).mockResolvedValue({ id: 'integ_1', publicKey: 'pk_abc' });

            const res = await request(app).post('/gateway/keys/generate').send({ appName: 'Ma Boutique' });

            expect(res.status).toBe(201);
            expect(res.body.publicKey).toBe('pk_abc');
            expect(res.body.secret).toMatch(/^sk_live_[0-9a-f]{64}$/);
            expect(res.body.webhookSigningSecret).toMatch(/^[0-9a-f]{64}$/);
            expect(prisma.apiIntegration.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    merchantId: 'merchant_1',
                    appName: 'Ma Boutique',
                    environment: 'LIVE',
                    secretHash: 'HASHED_SECRET',
                }),
            }));
            expect(prisma.apiLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ integrationId: 'integ_1', action: 'GENERATE', actorId: 'merchant_1' }),
            }));
        });

        it("ne devrait jamais renvoyer secretHash dans la réponse", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.create as jest.Mock).mockResolvedValue({
                id: 'integ_1', publicKey: 'pk_abc', secretHash: 'NEVER_EXPOSED',
            });

            const res = await request(app).post('/gateway/keys/generate').send({});

            expect(JSON.stringify(res.body)).not.toContain('NEVER_EXPOSED');
        });

        it("devrait utiliser un nom par défaut si appName est absent", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.create as jest.Mock).mockResolvedValue({ id: 'integ_1', publicKey: 'pk_abc' });

            await request(app).post('/gateway/keys/generate').send({});

            expect(prisma.apiIntegration.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ appName: 'Mongain Connect' }),
            }));
        });
    });

    describe('GET /gateway/keys', () => {
        it('ne devrait jamais sélectionner secretHash/webhookSigningSecret', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app).get('/gateway/keys');

            expect(res.status).toBe(200);
            const call = (prisma.apiIntegration.findMany as jest.Mock).mock.calls[0][0];
            expect(call.where).toEqual({ merchantId: 'merchant_1' });
            expect(call.select.secretHash).toBeUndefined();
            expect(call.select.webhookSigningSecret).toBeUndefined();
        });
    });

    describe('PATCH /gateway/keys/:id', () => {
        it("devrait retourner 404 si l'intégration n'appartient pas à ce marchand", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'un_autre_marchand' });

            const res = await request(app).patch('/gateway/keys/integ_1').send({ isActive: false });

            expect(res.status).toBe(404);
            expect(prisma.apiIntegration.update).not.toHaveBeenCalled();
        });

        it('devrait modifier webhookUrl et isActive', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'merchant_1' });
            (prisma.apiIntegration.update as jest.Mock).mockResolvedValue({
                id: 'integ_1', webhookUrl: 'https://x.test/hook', isActive: false,
            });

            const res = await request(app).patch('/gateway/keys/integ_1').send({ webhookUrl: 'https://x.test/hook', isActive: false });

            expect(res.status).toBe(200);
            expect(prisma.apiIntegration.update).toHaveBeenCalledWith({
                where: { id: 'integ_1' },
                data: { webhookUrl: 'https://x.test/hook', isActive: false },
            });
        });

        it("devrait retourner 400 si aucune modification n'est fournie", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'merchant_1' });

            const res = await request(app).patch('/gateway/keys/integ_1').send({});

            expect(res.status).toBe(400);
            expect(prisma.apiIntegration.update).not.toHaveBeenCalled();
        });
    });

    describe('POST /gateway/keys/:id/rotate', () => {
        it('devrait régénérer secret et webhookSigningSecret et journaliser ROTATE', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'merchant_1', publicKey: 'pk_abc' });
            (prisma.apiIntegration.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/gateway/keys/integ_1/rotate').send({});

            expect(res.status).toBe(200);
            expect(res.body.secret).toMatch(/^sk_live_[0-9a-f]{64}$/);
            expect(res.body.webhookSigningSecret).toMatch(/^[0-9a-f]{64}$/);
            expect(prisma.apiIntegration.update).toHaveBeenCalledWith({
                where: { id: 'integ_1' },
                data: expect.objectContaining({ secretHash: 'HASHED_SECRET' }),
            });
            expect(prisma.apiLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'ROTATE', actorId: 'merchant_1' }),
            }));
        });

        it("devrait retourner 404 pour une intégration d'un autre marchand", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'un_autre' });

            const res = await request(app).post('/gateway/keys/integ_1/rotate').send({});

            expect(res.status).toBe(404);
            expect(prisma.apiIntegration.update).not.toHaveBeenCalled();
        });
    });

    describe('POST /gateway/charge', () => {
        const integration = {
            id: 'integ_1',
            merchantId: 'merchant_1',
            isActive: true,
            secretHash: 'HASH',
            merchant: { id: 'merchant_1', name: 'Boutique', wallet: { id: 'w1' } },
        };

        it("devrait refuser sans en-tête Authorization", async () => {
            const res = await request(app).post('/gateway/charge').send({});
            expect(res.status).toBe(401);
        });

        it('devrait refuser un format de clé invalide (pas de séparateur)', async () => {
            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer justastringnodot')
                .send({});

            expect(res.status).toBe(401);
            expect(prisma.apiIntegration.findUnique).not.toHaveBeenCalled();
        });

        it('devrait refuser une clé publique inconnue ou inactive', async () => {
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer pk_abc.somesecret')
                .send({ customerPhone: '074000000', amount: 5000 });

            expect(res.status).toBe(401);
        });

        it('devrait refuser un secret incorrect', async () => {
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue(integration);
            (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer pk_abc.wrongsecret')
                .send({ customerPhone: '074000000', amount: 5000 });

            expect(res.status).toBe(401);
            expect(prisma.invoice.create).not.toHaveBeenCalled();
        });

        it('devrait créer une facture avec integrationId et renvoyer REQUIRES_CUSTOMER_APPROVAL', async () => {
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue(integration);
            (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'cust_1', phone: '074000000', wallet: { id: 'wc1' }, pushToken: null });
            (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv_1' });

            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer pk_abc.correctsecret')
                .send({ customerPhone: '074000000', amount: 5000, orderId: 'ORD1' });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('REQUIRES_CUSTOMER_APPROVAL');
            expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ integrationId: 'integ_1', merchantId: 'merchant_1', amount: 5000 }),
            }));
        });

        it('devrait rejeter un montant sous 100 FCFA', async () => {
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue(integration);
            (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer pk_abc.correctsecret')
                .send({ customerPhone: '074000000', amount: 50 });

            expect(res.status).toBe(400);
            expect(prisma.invoice.create).not.toHaveBeenCalled();
        });

        it('devrait retourner 404 si le client Mongain est introuvable', async () => {
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue(integration);
            (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/gateway/charge')
                .set('Authorization', 'Bearer pk_abc.correctsecret')
                .send({ customerPhone: '074999999', amount: 5000 });

            expect(res.status).toBe(404);
            expect(prisma.invoice.create).not.toHaveBeenCalled();
        });
    });

    describe('POST /gateway/webhook-deliveries/:id/retry', () => {
        it("devrait retourner 404 si la livraison n'appartient pas au marchand", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiWebhookDelivery.findUnique as jest.Mock).mockResolvedValue({
                id: 'd1', integration: { id: 'integ_1', merchantId: 'un_autre' },
            });

            const res = await request(app).post('/gateway/webhook-deliveries/d1/retry');

            expect(res.status).toBe(404);
            expect(mockRetryWebhookDelivery).not.toHaveBeenCalled();
        });

        it('devrait rejouer la livraison', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiWebhookDelivery.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'd1', payload: '{}', integration: { id: 'integ_1', merchantId: 'merchant_1' } })
                .mockResolvedValueOnce({ id: 'd1', status: 'DELIVERED' });

            const res = await request(app).post('/gateway/webhook-deliveries/d1/retry');

            expect(res.status).toBe(200);
            expect(mockRetryWebhookDelivery).toHaveBeenCalled();
            expect(res.body.delivery).toEqual({ id: 'd1', status: 'DELIVERED' });
        });
    });

    describe('GET /gateway/webhook-deliveries', () => {
        it('devrait exiger integrationId', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });

            const res = await request(app).get('/gateway/webhook-deliveries');

            expect(res.status).toBe(400);
        });

        it("devrait retourner 404 pour une intégration d'un autre marchand", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'un_autre' });

            const res = await request(app).get('/gateway/webhook-deliveries?integrationId=integ_1');

            expect(res.status).toBe(404);
        });

        it("devrait lister les livraisons de l'intégration", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'merchant_1', role: 'MERCHANT' });
            (prisma.apiIntegration.findUnique as jest.Mock).mockResolvedValue({ id: 'integ_1', merchantId: 'merchant_1' });
            (prisma.apiWebhookDelivery.findMany as jest.Mock).mockResolvedValue([{ id: 'd1' }]);

            const res = await request(app).get('/gateway/webhook-deliveries?integrationId=integ_1');

            expect(res.status).toBe(200);
            expect(res.body.deliveries).toEqual([{ id: 'd1' }]);
        });
    });
});
