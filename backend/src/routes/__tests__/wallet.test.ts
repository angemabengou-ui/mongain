import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prisma } from '../../prisma';
import walletRoutes from '../wallet';

// Mock du module Prisma pour ne pas taper la base de données de dev
jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
        transaction: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        notification: { create: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
        $executeRaw: jest.fn(),
        $transaction: jest.fn((callback) => callback(prisma))
    },
}));

// Mock du LimitEngine pour simplifier ce test unitaire
jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: {
        verifyAndIncrementConsumption: jest.fn().mockResolvedValue(true),
        getApplicableLimits: jest.fn().mockResolvedValue({ effectiveDaily: 50000 })
    }
}));

// Mock JWT pour l'authentification
jest.mock('jsonwebtoken', () => ({
    verify: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash: jest.fn().mockResolvedValue('hashed-secret'),
}));

jest.mock('../../services/pvit', () => ({
    isPvitConfigured: jest.fn().mockReturnValue(true),
    initiatePvitTransfer: jest.fn(),
    initiatePvitPayment: jest.fn(),
    toPvitCustomerAccountNumber: jest.fn((v: string) => v),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({ taxWithdraw: 0 }),
}));

jest.mock('../../services/centralTreasury', () => ({
    getCentralTreasury: jest.fn(),
}));

const bcrypt = require('bcryptjs');
const pvit = require('../../services/pvit');
const { getSystemSettings } = require('../settings');
const { getCentralTreasury } = require('../../services/centralTreasury');
const { LimitEngine } = require('../../services/LimitEngine');
const CORPORATE_PHONE = process.env.CORPORATE_PHONE || '+2410000000';

// Setup d'une mini-app Express avec nos routes
const app = express();
app.use(express.json());
// Injection du routeur
app.use('/wallet', walletRoutes);

describe('Wallet Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Par défaut, toute requête est authentifiée avec l'ID 'user123'
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user123', jwtVersion: 0 });
        // Simuler le contrôle jwtVersion authMiddleware
        (prisma.user.findUnique as jest.Mock).mockImplementation(async (args) => {
            // Pour le middleware auth
            if (args.select && args.select.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
            return null;
        });
    });

    describe('GET /wallet/balance', () => {
        it('devrait retourner le solde du portefeuille', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user123', isActive: true, jwtVersion: 0 });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ balance: 50000, currency: 'FCFA' });

            const res = await request(app)
                .get('/wallet/balance')
                .set('Authorization', 'Bearer dummy-token');

            expect(res.status).toBe(200);
            expect(res.body.balance).toBe(50000);
        });

        it('devrait retourner 404 si le portefeuille n\'existe pas', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user123', isActive: true, jwtVersion: 0 });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .get('/wallet/balance')
                .set('Authorization', 'Bearer dummy-token');

            expect(res.status).toBe(404);
            expect(res.body.error).toContain('Portefeuille introuvable');
        });
    });

    describe('POST /wallet/match-contacts', () => {
        it("devrait retourner 400 si aucun numéro n'est fourni", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user123', isActive: true, jwtVersion: 0 });

            const res = await request(app)
                .post('/wallet/match-contacts')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phones: [] });

            expect(res.status).toBe(400);
        });

        it("ne devrait renvoyer que les numéros correspondant à un compte Mongain existant, sans jamais exposer les numéros absents", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user123', isActive: true, jwtVersion: 0 });
            (prisma.user.findMany as jest.Mock).mockResolvedValue([
                { id: 'u2', name: 'Alice', phone: '+24177000002', role: 'USER' },
            ]);

            const res = await request(app)
                .post('/wallet/match-contacts')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phones: ['+24177000002', '+24177000099'] }); // le second n'a pas de compte

            expect(res.status).toBe(200);
            expect(res.body.matches).toEqual([{ id: 'u2', name: 'Alice', phone: '+24177000002', role: 'USER' }]);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ phone: { in: ['+24177000002', '+24177000099'] } }),
            }));
        });

        it("ne devrait jamais renvoyer l'appelant lui-même parmi les correspondances", async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user123', isActive: true, jwtVersion: 0 });
            (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app)
                .post('/wallet/match-contacts')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phones: ['+24177000001'] });

            expect(res.status).toBe(200);
            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: { not: 'user123' } }),
            }));
        });
    });

    // Un retrait Mobile Money débite le client + crédite la Passerelle Externe (contrepartie
    // comptable) AVANT même d'appeler PVit — si PVit refuse la demande, ce pré-débit doit être
    // repris intégralement, sinon l'argent existe à la fois chez le client (remboursé plus
    // tard, ou jamais) ET dans la Passerelle (jamais reprise) : créé à partir de rien.
    describe('POST /wallet/push (retrait Mobile Money)', () => {
        const mockSenderAndGateway = () => {
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.phone === '+24133333333') return { id: 'gateway_id', wallet: { id: 'w_gateway', balance: 999999999 } };
                if (args.where?.id === 'user123') {
                    return {
                        id: 'user123', pin: 'hashed-pin', failedPinAttempts: 0, lockedUntil: null,
                        wallet: args.include?.wallet ? { id: 'w_sender', balance: 100000 } : undefined,
                    };
                }
                return null;
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
        };

        it('devrait débiter le client et créditer la Passerelle sans jamais reprendre si PVit accepte', async () => {
            mockSenderAndGateway();
            (pvit.initiatePvitTransfer as jest.Mock).mockResolvedValue({ message: 'ok' });

            const res = await request(app)
                .post('/wallet/push')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phone: '077000000', amount: 5000, network: 'AIRTEL', pin: '1234' });

            expect(res.status).toBe(200);
            expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
                where: { id: 'w_sender', balance: { gte: 5000 } },
                data: { balance: { decrement: 5000 } },
            });
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_gateway' },
                data: { balance: { increment: 5000 } },
            });
            // Aucune reprise : seuls les deux appels ci-dessus doivent avoir touché des wallets.
            expect(prisma.wallet.update).toHaveBeenCalledTimes(1);
        });

        it('devrait tout reprendre (client recrédité, Passerelle redébitée) si PVit refuse la demande', async () => {
            mockSenderAndGateway();
            (pvit.initiatePvitTransfer as jest.Mock).mockRejectedValue(new Error('PVit : solde marchand insuffisant'));
            (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

            const res = await request(app)
                .post('/wallet/push')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phone: '077000000', amount: 5000, network: 'AIRTEL', pin: '1234' });

            expect(res.status).toBe(400);
            // La transaction PENDING doit être réclamée/marquée FAILED avant toute reprise.
            expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
                where: { id: 'tx1', status: 'PENDING' },
                data: { status: 'FAILED' },
            });
            // Passerelle redébitée du montant qu'elle avait reçu à l'initiation.
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_gateway' },
                data: { balance: { decrement: 5000 } },
            });
            // Client recrédité de la totalité pré-débitée (montant + frais, ici 0 de frais).
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_sender' },
                data: { balance: { increment: 5000 } },
            });
        });

        it('ne devrait PAS reprendre deux fois si un webhook a déjà traité la transaction entre-temps', async () => {
            mockSenderAndGateway();
            (pvit.initiatePvitTransfer as jest.Mock).mockRejectedValue(new Error('PVit : timeout'));
            // Le webhook a gagné la course : la réclamation ne trouve plus de ligne PENDING.
            (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app)
                .post('/wallet/push')
                .set('Authorization', 'Bearer dummy-token')
                .send({ phone: '077000000', amount: 5000, network: 'AIRTEL', pin: '1234' });

            expect(res.status).toBe(400);
            // Seuls les 2 mouvements de l'initiation ont eu lieu (le gateway credit) — aucune
            // reprise supplémentaire (pas de second wallet.update après l'initiation).
            expect(prisma.wallet.update).toHaveBeenCalledTimes(1);
        });
    });

    // /recharge crée une transaction PENDING que seul le webhook PVit complète — sans `type`
    // explicite, elle retombait sur le défaut Prisma ("TRANSFER"), que le webhook ignore
    // (il ne crédite que `type === 'CASH_IN'') : un SUCCESS confirmé par PVit marquait la
    // transaction COMPLETED sans jamais créditer le client.
    describe('POST /wallet/recharge', () => {
        it('devrait créer la transaction PENDING avec type CASH_IN', async () => {
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.id === 'user123') return { id: 'user123', phone: '077000000', wallet: { id: 'w_sender', balance: 1000 } };
                if (args.where?.phone === '+24133333333') return { id: 'gateway_id', wallet: { id: 'w_gateway', balance: 999999999 } };
                return null;
            });
            (pvit.initiatePvitPayment as jest.Mock).mockResolvedValue({ message: 'ok' });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });

            const res = await request(app)
                .post('/wallet/recharge')
                .set('Authorization', 'Bearer dummy-token')
                .send({ method: 'AIRTEL', identifier: '077000000', amount: 5000 });

            expect(res.status).toBe(200);
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ type: 'CASH_IN', status: 'PENDING', amount: 5000 }),
            });
        });
    });

    // La commission marchand part désormais sur un solde séparé (commissionWallet) au lieu
    // d'être fondue dans le même wallet que la vente — voir merchantService.ts et le
    // commentaire dans wallet.ts /client-initiated-withdraw.
    describe('POST /wallet/client-initiated-withdraw (commission marchand séparée)', () => {
        const mockClientAndReceiver = (receiver: any, commissionWallet: any | null) => {
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.id === 'user123' && !args.include) {
                    return { id: 'user123', pin: 'hashed-pin', failedPinAttempts: 0, lockedUntil: null };
                }
                if (args.where?.id === 'user123' && args.include?.wallet) {
                    return { id: 'user123', name: 'Client', wallet: { id: 'w_client', balance: 100000 } };
                }
                if (args.where?.phone === CORPORATE_PHONE) {
                    return { id: 'corporate_id', wallet: { id: 'w_corporate', balance: 0 } };
                }
                if (args.where?.id === receiver.id && args.include?.commissionWallet) {
                    return { id: receiver.id, commissionWallet };
                }
                return null;
            });
            (prisma.user.findFirst as jest.Mock).mockResolvedValue(receiver);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });
        };

        it('AGENT : ne crée ni ne touche aucun commissionWallet (comportement inchangé)', async () => {
            (getSystemSettings as jest.Mock).mockResolvedValue({ taxWithdraw: 0, agencyWithdrawThreshold: 999999999, agencyTaxWithdraw: 0 });
            mockClientAndReceiver(
                { id: 'agent_1', role: 'AGENT', name: 'Agent A', phone: '077888888', branchId: null, wallet: { id: 'w_agent', balance: 0 } },
                null
            );

            const res = await request(app)
                .post('/wallet/client-initiated-withdraw')
                .set('Authorization', 'Bearer dummy-token')
                .send({ receiverPhone: '077888888', amount: 5000, pin: '1234' });

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_agent' }, data: { balance: { increment: 5000 } } });
            expect(prisma.wallet.create).not.toHaveBeenCalled();
            // Aucune ligne REWARD- : seule la transaction principale a été créée.
            expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
        });

        it('MERCHANT : crédite `amount` seul sur le wallet principal et `merchantReward` sur un commissionWallet créé à la volée', async () => {
            (getSystemSettings as jest.Mock).mockResolvedValue({ taxWithdraw: 0.02, rewardMerchant: 0.01 });
            mockClientAndReceiver(
                { id: 'merchant_1', role: 'MERCHANT', name: 'Le Bon Coin', phone: '077999999', wallet: { id: 'w_merchant', balance: 0 } },
                null // pas encore de commissionWallet -> création à la volée
            );
            (prisma.wallet.create as jest.Mock).mockResolvedValue({ id: 'w_commission', balance: 0 });

            const res = await request(app)
                .post('/wallet/client-initiated-withdraw')
                .set('Authorization', 'Bearer dummy-token')
                .send({ receiverPhone: '077999999', amount: 5000, pin: '1234' });

            expect(res.status).toBe(200);
            // fee = 5000*0.02 = 100 ; merchantReward = 5000*0.01 = 50 ; corporateCut = 50.
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_merchant' }, data: { balance: { increment: 5000 } } });
            expect(prisma.wallet.create).toHaveBeenCalledWith({ data: { balance: 0 } });
            expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'merchant_1' }, data: { commissionWalletId: 'w_commission' } });
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_commission' }, data: { balance: { increment: 50 } } });
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_corporate' }, data: { balance: { increment: 50 } } });
            // La ligne REWARD- pointe vers le commissionWallet, pas vers le wallet principal du marchand.
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ amount: 50, senderWalletId: 'w_corporate', receiverWalletId: 'w_commission', reference: expect.stringContaining('REWARD-') }),
            });
        });

        it('MERCHANT : réutilise le commissionWallet existant sans le recréer', async () => {
            (getSystemSettings as jest.Mock).mockResolvedValue({ taxWithdraw: 0.02, rewardMerchant: 0.01 });
            mockClientAndReceiver(
                { id: 'merchant_1', role: 'MERCHANT', name: 'Le Bon Coin', phone: '077999999', wallet: { id: 'w_merchant', balance: 0 } },
                { id: 'w_commission_existing', balance: 500 }
            );

            const res = await request(app)
                .post('/wallet/client-initiated-withdraw')
                .set('Authorization', 'Bearer dummy-token')
                .send({ receiverPhone: '077999999', amount: 5000, pin: '1234' });

            expect(res.status).toBe(200);
            expect(prisma.wallet.create).not.toHaveBeenCalled();
            expect(prisma.user.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { commissionWalletId: expect.anything() } }));
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_commission_existing' }, data: { balance: { increment: 50 } } });
        });
    });

    // ==========================================
    // POST /wallet/pay-service
    // ==========================================
    describe('POST /wallet/pay-service', () => {
        const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES;
        afterAll(() => { process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES = ORIGINAL_FLAG; });

        it('devrait retourner 501 si le flag bêta est désactivé (comportement par défaut)', async () => {
            process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES = 'false';

            const res = await request(app)
                .post('/wallet/pay-service')
                .set('Authorization', 'Bearer dummy-token')
                .send({ type: 'WATER', amount: 1000 });

            expect(res.status).toBe(501);
        });

        // Régression : le crédit vers la réserve centrale avait disparu entièrement — le
        // client était débité mais l'argent n'atterrissait nulle part (ni la réserve, ni
        // aucun autre wallet), alors que la ligne Transaction prétendait qu'il l'était.
        it('devrait débiter le client ET créditer la réserve centrale du même montant', async () => {
            process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES = 'true';
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.id === 'user123' && args.include?.wallet) {
                    return { id: 'user123', role: 'USER', wallet: { id: 'w_client', balance: 100000 } };
                }
                return null;
            });
            (getCentralTreasury as jest.Mock).mockResolvedValue({ wallet: { id: 'w_reserve', balance: 0 } });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({ id: 'w_client', balance: 99000 });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });

            const res = await request(app)
                .post('/wallet/pay-service')
                .set('Authorization', 'Bearer dummy-token')
                .send({ type: 'WATER', amount: 1000, reference: 'REF1' });

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_client', balance: { gte: 1000 } }, data: { balance: { decrement: 1000 } } });
            expect(prisma.wallet.update).toHaveBeenCalledWith({ where: { id: 'w_reserve' }, data: { balance: { increment: 1000 } } });
        });

        // Régression : cette route ne vérifiait jamais les plafonds anti-blanchiment,
        // contrairement à tous les autres rails sortants (transfer, pay-bill, retraits).
        it('devrait vérifier les plafonds anti-blanchiment via LimitEngine', async () => {
            process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES = 'true';
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.id === 'user123' && args.include?.wallet) {
                    return { id: 'user123', role: 'USER', wallet: { id: 'w_client', balance: 100000 } };
                }
                return null;
            });
            (getCentralTreasury as jest.Mock).mockResolvedValue({ wallet: { id: 'w_reserve', balance: 0 } });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({ id: 'w_client', balance: 99000 });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });

            const res = await request(app)
                .post('/wallet/pay-service')
                .set('Authorization', 'Bearer dummy-token')
                .send({ type: 'WATER', amount: 1000, reference: 'REF1' });

            expect(res.status).toBe(200);
            expect(LimitEngine.verifyAndIncrementConsumption).toHaveBeenCalledWith(expect.anything(), 'user123', 'w_client', 1000, expect.anything());
        });
    });

    // ==========================================
    // POST /wallet/transfer
    // ==========================================
    describe('POST /wallet/transfer', () => {
        // Régression : LimitEngine verrouille sender.wallet.id en interne (FOR UPDATE). S'il
        // s'exécutait AVANT le verrou trié (sender+receiver), deux /transfer concurrents en
        // sens opposé entre les deux mêmes wallets pouvaient se verrouiller mutuellement
        // (deadlock réel) au lieu que l'un attende simplement l'autre. Le verrou trié doit
        // donc être acquis avant l'appel à LimitEngine.
        it('devrait acquérir le verrou pessimiste (sender+receiver) avant d\'appeler LimitEngine', async () => {
            (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
                if (args.select?.jwtVersion) return { id: 'user123', isActive: true, jwtVersion: 0 };
                if (args.where?.id === 'user123' && !args.include) {
                    return { id: 'user123', pin: 'hashed-pin', failedPinAttempts: 0, lockedUntil: null };
                }
                if (args.where?.id === 'user123' && args.include?.wallet) {
                    return { id: 'user123', role: 'USER', wallet: { id: 'w_sender', balance: 100000 } };
                }
                if (args.where?.phone === CORPORATE_PHONE) {
                    return { id: 'corporate_id', wallet: { id: 'w_corporate', balance: 0 } };
                }
                return null;
            });
            (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'user456', role: 'USER', wallet: { id: 'w_receiver', balance: 0 } });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (getSystemSettings as jest.Mock).mockResolvedValue({ taxP2P: 0 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({ id: 'w_sender', balance: 99000 });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({ id: 'tx1' });

            const res = await request(app)
                .post('/wallet/transfer')
                .set('Authorization', 'Bearer dummy-token')
                .send({ receiverPhone: '077000000', amount: 1000, pin: '1234' });

            expect(res.status).toBe(200);
            const lockOrder = (prisma.$executeRaw as jest.Mock).mock.invocationCallOrder[0];
            const limitEngineOrder = (LimitEngine.verifyAndIncrementConsumption as jest.Mock).mock.invocationCallOrder[0];
            expect(lockOrder).toBeLessThan(limitEngineOrder);
        });
    });
});
