import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prisma } from '../../prisma';
import splitRoutes from '../split';

// Mock du module Prisma pour ne pas taper la base de données de dev — même approche que
// wallet.test.ts : $transaction invoque directement le callback avec ce même mock comme `tx`.
jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), update: jest.fn() },
        splitRequest: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
        wallet: { update: jest.fn() },
        transaction: { create: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../wallet', () => ({
    notifyParentOfChildSpend: jest.fn().mockResolvedValue(undefined),
}));

const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use('/split', splitRoutes);

describe('POST /split/pay/:id', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user_payer', jwtVersion: 0 });
        (prisma.user.findUnique as jest.Mock).mockImplementation(async (args: any) => {
            // authMiddleware relit toujours avec ce select précis pour vérifier jwtVersion.
            if (args.select && args.select.jwtVersion !== undefined) {
                return { id: 'user_payer', isActive: true, jwtVersion: 0 };
            }
            return {
                id: 'user_payer', phone: '+24177000001', pin: 'hashed-pin',
                failedPinAttempts: 0, lockedUntil: null,
                wallet: { id: 'wallet_payer', balance: 100000 },
            };
        });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('paie une demande PENDING avec succès', async () => {
        (prisma.splitRequest.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'split_1', targetId: 'user_payer', status: 'PENDING', amount: 5000 })
            .mockResolvedValueOnce({
                id: 'split_1', targetId: 'user_payer', status: 'PAID', amount: 5000,
                requester: { wallet: { id: 'wallet_requester' } },
            });
        (prisma.splitRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

        const res = await request(app)
            .post('/split/pay/split_1')
            .set('Authorization', 'Bearer faketoken')
            .send({ pin: '1234' });

        expect(res.status).toBe(200);
        expect(prisma.splitRequest.updateMany).toHaveBeenCalledWith({
            where: { id: 'split_1', status: 'PENDING' },
            data: { status: 'PAID' },
        });
        expect(prisma.wallet.update).toHaveBeenCalledTimes(2);
    });

    it('refuse un double paiement — la réclamation atomique échoue si déjà réglée entre-temps (régression : race condition sur /pay/:id)', async () => {
        (prisma.splitRequest.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'split_1', targetId: 'user_payer', status: 'PENDING', amount: 5000 });
        // Simule une requête concurrente (ou un retry réseau) qui a déjà réclamé ce split :
        // le pré-check ci-dessus le voit encore PENDING (lecture non verrouillée, comme dans
        // le vrai scénario de course), mais l'updateMany conditionné ne trouve plus 0 ligne.
        (prisma.splitRequest.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

        const res = await request(app)
            .post('/split/pay/split_1')
            .set('Authorization', 'Bearer faketoken')
            .send({ pin: '1234' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/déjà été réglée/);
        expect(prisma.wallet.update).not.toHaveBeenCalled();
    });

    it("refuse si l'utilisateur connecté n'est pas le destinataire de la demande", async () => {
        (prisma.splitRequest.findUnique as jest.Mock)
            .mockResolvedValueOnce({ id: 'split_1', targetId: 'quelquun_dautre', status: 'PENDING', amount: 5000 });

        const res = await request(app)
            .post('/split/pay/split_1')
            .set('Authorization', 'Bearer faketoken')
            .send({ pin: '1234' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/pas le destinataire/);
        expect(prisma.splitRequest.updateMany).not.toHaveBeenCalled();
        expect(prisma.wallet.update).not.toHaveBeenCalled();
    });

    it('refuse si la demande est introuvable', async () => {
        (prisma.splitRequest.findUnique as jest.Mock).mockResolvedValueOnce(null);

        const res = await request(app)
            .post('/split/pay/split_1')
            .set('Authorization', 'Bearer faketoken')
            .send({ pin: '1234' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/introuvable/);
        expect(prisma.splitRequest.updateMany).not.toHaveBeenCalled();
    });
});
