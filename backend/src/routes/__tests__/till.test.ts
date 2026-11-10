import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { JWT_SECRET } from '../../middleware/auth';
import { prisma } from '../../prisma';
import tillRoutes, { createMerchantTill, deactivateMerchantTill, listMerchantTills } from '../till';

// spread jest.requireActual : JWT_SECRET doit rester le VRAI secret généré au chargement du
// module (voir middleware/auth.ts) pour que le jwt.sign() fait par routes/till.ts et le
// jwt.verify() fait par ce test utilisent la même valeur — seul authMerchantTill est
// surchargé, pour tester POST /collect sans reproduire toute la logique déjà couverte par
// middleware/__tests__/auth.test.ts.
jest.mock('../../middleware/auth', () => {
    const actual = jest.requireActual('../../middleware/auth');
    return {
        ...actual,
        authMerchantTill: (req: any, _res: any, next: any) => {
            req.userId = 'merchant_owner_1';
            req.tillId = 'till_1';
            next();
        },
    };
});

jest.mock('bcryptjs', () => ({
    hash: jest.fn().mockResolvedValue('HASHED_PIN'),
    compare: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        merchantTill: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        user: { findUnique: jest.fn() },
    },
}));

// circuitBreakerMiddleware (appliqué sur POST /collect, voir routes/till.ts) appelle
// getSystemSettings() à chaque requête — sans ce mock, il tombe sur son propre filet de
// sécurité (fail-closed, 503) faute de prisma.systemSettings dans le mock ci-dessus, jamais
// sur la vraie assertion du test.
jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({}),
}));

// executeQrCollection a sa propre couverture (logique métier d'encaissement, plafonds, frais)
// via ses appelants existants — ici on vérifie uniquement que POST /collect délègue avec le
// bon merchantId (celui mappé par authMerchantTill, PAS un id de guichet).
const mockExecuteQrCollection = jest.fn((_merchantId: string, _req: any, res: any) => res.json({ message: 'ok' }));
jest.mock('../pay', () => ({
    executeQrCollection: (...args: any[]) => (mockExecuteQrCollection as any)(...args),
}));

const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use('/till', tillRoutes);

describe('Till Routes (guichets/caisses)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /till/auth/login', () => {
        it('devrait retourner 400 si téléphone ou PIN manquant', async () => {
            const res = await request(app).post('/till/auth/login').send({ phone: '077000000' });

            expect(res.status).toBe(400);
            expect(prisma.merchantTill.findUnique).not.toHaveBeenCalled();
        });

        it('devrait retourner 401 générique si le guichet est introuvable ou désactivé', async () => {
            // Même branche de code (`!till || !till.isActive`) couvre les deux cas — pas besoin
            // d'un second test/d'une seconde requête pour le guichet désactivé, chaque requête
            // sur cette route comptant contre tillLoginLimiter (5/15min) PARTAGÉ par tous les
            // tests de ce fichier.
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/till/auth/login').send({ phone: '077000000', pin: '1234' });

            expect(res.status).toBe(401);
        });

        it('devrait retourner 403 si le marchand propriétaire est suspendu', async () => {
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({
                id: 'till_1', isActive: true, pin: 'HASHED_PIN',
                merchant: { id: 'merchant_owner_1', role: 'MERCHANT', accountStatus: 'SUSPENDED' },
            });

            const res = await request(app).post('/till/auth/login').send({ phone: '077000000', pin: '1234' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 401 si le PIN est incorrect', async () => {
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({
                id: 'till_1', isActive: true, pin: 'HASHED_PIN',
                merchant: { id: 'merchant_owner_1', role: 'MERCHANT', accountStatus: 'ACTIVE' },
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);

            const res = await request(app).post('/till/auth/login').send({ phone: '077000000', pin: '0000' });

            expect(res.status).toBe(401);
        });

        it('devrait authentifier un guichet actif avec le bon PIN et émettre un JWT {tillId, till, tillTokenVersion}', async () => {
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({
                id: 'till_1', name: 'Guichet 1', phone: '077000000', pin: 'HASHED_PIN', isActive: true, tokenVersion: 3,
                merchant: { id: 'merchant_owner_1', role: 'MERCHANT', accountStatus: 'ACTIVE' },
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);

            const res = await request(app).post('/till/auth/login').send({ phone: '077 00 00 00', pin: '1234' });

            expect(res.status).toBe(200);
            expect(res.body.till).toEqual({ id: 'till_1', name: 'Guichet 1' });
            // Espaces retirés du numéro avant la recherche.
            expect(prisma.merchantTill.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: '077000000' } }));

            const decoded: any = jwt.verify(res.body.token, JWT_SECRET);
            expect(decoded.till).toBe(true);
            expect(decoded.tillId).toBe('till_1');
            expect(decoded.tillTokenVersion).toBe(3);
        });
    });

    describe('POST /till/collect', () => {
        it('devrait déléguer à executeQrCollection avec le marchand propriétaire (req.userId mappé par authMerchantTill)', async () => {
            const res = await request(app).post('/till/collect').send({ scannedCode: 'cust_1', amountXaf: 5000, pin: '1234' });

            expect(res.status).toBe(200);
            expect(mockExecuteQrCollection).toHaveBeenCalledWith('merchant_owner_1', expect.anything(), expect.anything());
        });
    });

    describe('listMerchantTills', () => {
        it('devrait lister les guichets du marchand sans jamais sélectionner le PIN', async () => {
            (prisma.merchantTill.findMany as jest.Mock).mockResolvedValue([]);

            await listMerchantTills('merchant_1');

            const call = (prisma.merchantTill.findMany as jest.Mock).mock.calls[0][0];
            expect(call.where).toEqual({ merchantId: 'merchant_1' });
            expect(call.select.pin).toBeUndefined();
            expect(call.select.name).toBe(true);
        });
    });

    describe('createMerchantTill', () => {
        it('devrait rejeter un PIN invalide (pas 4-6 chiffres)', async () => {
            const result = await createMerchantTill('merchant_1', { name: 'Guichet', phone: '077000001', pin: 'abcd' });

            expect(result.status).toBe(400);
            expect(prisma.merchantTill.create).not.toHaveBeenCalled();
        });

        it('devrait rejeter un nom ou téléphone manquant', async () => {
            const result = await createMerchantTill('merchant_1', { name: '', phone: '077000001', pin: '1234' });
            expect(result.status).toBe(400);
        });

        it('devrait retourner 409 si le téléphone est déjà utilisé par un User', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1' });
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue(null);

            const result = await createMerchantTill('merchant_1', { name: 'Guichet', phone: '077000001', pin: '1234' });

            expect(result.status).toBe(409);
            expect(prisma.merchantTill.create).not.toHaveBeenCalled();
        });

        it('devrait retourner 409 si le téléphone est déjà utilisé par un autre guichet', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({ id: 'till_existant' });

            const result = await createMerchantTill('merchant_1', { name: 'Guichet', phone: '077000001', pin: '1234' });

            expect(result.status).toBe(409);
        });

        it('devrait créer un guichet avec un PIN haché et ne jamais renvoyer le PIN', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue(null);
            (prisma.merchantTill.create as jest.Mock).mockResolvedValue({
                id: 't1', merchantId: 'merchant_1', name: 'Guichet', phone: '077000001', pin: 'HASHED_PIN', isActive: true,
            });

            const result = await createMerchantTill('merchant_1', { name: 'Guichet', phone: '077000001', pin: '1234' });

            expect(result.status).toBe(201);
            expect(result.body.till.pin).toBeUndefined();
            expect(prisma.merchantTill.create).toHaveBeenCalledWith({
                data: { merchantId: 'merchant_1', name: 'Guichet', phone: '077000001', pin: 'HASHED_PIN' },
            });
        });
    });

    describe('deactivateMerchantTill', () => {
        it("devrait retourner 404 si le guichet n'appartient pas à ce marchand", async () => {
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({ id: 't1', merchantId: 'un_autre_marchand' });

            const result = await deactivateMerchantTill('merchant_1', 't1');

            expect(result.status).toBe(404);
            expect(prisma.merchantTill.update).not.toHaveBeenCalled();
        });

        it('devrait désactiver le guichet et incrémenter tokenVersion (coupe les sessions ouvertes)', async () => {
            (prisma.merchantTill.findUnique as jest.Mock).mockResolvedValue({ id: 't1', merchantId: 'merchant_1' });
            (prisma.merchantTill.update as jest.Mock).mockResolvedValue({});

            const result = await deactivateMerchantTill('merchant_1', 't1');

            expect(result.status).toBe(200);
            expect(prisma.merchantTill.update).toHaveBeenCalledWith({
                where: { id: 't1' },
                data: { isActive: false, tokenVersion: { increment: 1 } },
            });
        });
    });
});
