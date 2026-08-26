import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prisma } from '../../prisma';
import walletRoutes from '../wallet';

// Mock du module Prisma pour ne pas taper la base de données de dev
jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
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

const bcrypt = require('bcryptjs');
const pvit = require('../../services/pvit');
const { getSystemSettings } = require('../settings');
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
});
