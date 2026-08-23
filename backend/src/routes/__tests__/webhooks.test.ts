import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { logError } from '../../utils/errorLog';
import { getSystemSettings } from '../settings';
import webhooksRoutes from '../webhooks';

jest.mock('../../utils/errorLog', () => ({
    logError: jest.fn(),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        transaction: { findUnique: jest.fn() },
        $transaction: jest.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/webhooks', webhooksRoutes);

const buildTxMock = () => ({
    transaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    wallet: { update: jest.fn(), findUnique: jest.fn() },
    notification: { create: jest.fn() },
});

describe('Webhooks Routes', () => {
    let txMock: ReturnType<typeof buildTxMock>;

    beforeEach(() => {
        jest.clearAllMocks();
        txMock = buildTxMock();
        (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(txMock));
        (getSystemSettings as jest.Mock).mockResolvedValue({ pvitWebhookSecret: 'secret123' });
    });

    describe('POST /webhooks/pvit-status', () => {
        it('devrait retourner 403 si la clé de webhook est invalide', async () => {
            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'wrong-key' })
                .send({ transactionId: 'tid1' });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Clé de webhook invalide.');
        });

        it('devrait retourner 403 si aucun pvitWebhookSecret n\'est configuré', async () => {
            (getSystemSettings as jest.Mock).mockResolvedValue({ pvitWebhookSecret: null });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({});

            expect(res.status).toBe(403);
        });

        it('devrait accuser réception (ack) si merchantReferenceId est absent', async () => {
            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', code: '00' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ transactionId: 'tid1', responseCode: '00' });
            expect(prisma.transaction.findUnique).not.toHaveBeenCalled();
        });

        it('devrait accuser réception si la transaction est introuvable', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-1', status: 'SUCCESS', code: '00' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ transactionId: 'tid1', responseCode: '00' });
        });

        it('devrait accuser réception si la transaction n\'est plus PENDING (déjà traitée)', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({ id: 'tx1', status: 'COMPLETED' });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-1', status: 'SUCCESS', code: '00' });

            expect(res.status).toBe(200);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('devrait créditer le destinataire pour un CASH_IN réussi et notifier', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1', status: 'PENDING', type: 'CASH_IN', receiverWalletId: 'w_receiver', amount: 10000,
            });
            txMock.wallet.update.mockResolvedValue({ id: 'w_receiver', user: { id: 'user_1' } });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-1', status: 'SUCCESS', code: '00', amountCredited: 10000 });

            expect(res.status).toBe(200);
            expect(txMock.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'w_receiver' },
                data: { balance: { increment: 10000 } },
            }));
            expect(txMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'user_1', title: 'Dépôt reçu' }),
            }));
        });

        it('ne devrait pas notifier un CASH_IN réussi si claim.count est 0 (déjà réclamé)', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1', status: 'PENDING', type: 'CASH_IN', receiverWalletId: 'w_receiver', amount: 10000,
            });
            txMock.transaction.updateMany.mockResolvedValue({ count: 0 });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-1', status: 'SUCCESS', code: '00' });

            expect(res.status).toBe(200);
            expect(txMock.wallet.update).not.toHaveBeenCalled();
        });

        it('devrait notifier un CASH_OUT réussi sans mouvement de fonds', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1', status: 'PENDING', type: 'CASH_OUT', senderWalletId: 'w_sender', amount: 5000,
            });
            txMock.wallet.findUnique.mockResolvedValue({ id: 'w_sender', user: { id: 'user_2' } });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-2', status: 'SUCCESS', code: '00' });

            expect(res.status).toBe(200);
            expect(txMock.wallet.update).not.toHaveBeenCalled();
            expect(txMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'user_2', title: 'Retrait réussi' }),
            }));
        });

        it('devrait notifier un échec de CASH_IN sans mouvement de fonds', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1', status: 'PENDING', type: 'CASH_IN', receiverWalletId: 'w_receiver', amount: 10000,
            });
            txMock.wallet.findUnique.mockResolvedValue({ id: 'w_receiver', user: { id: 'user_3' } });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-3', status: 'FAILED', code: '01' });

            expect(res.status).toBe(200);
            expect(txMock.wallet.update).not.toHaveBeenCalled();
            expect(txMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'user_3', title: 'Dépôt échoué' }),
            }));
        });

        it('devrait rembourser le client pour un CASH_OUT échoué et notifier', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1', status: 'PENDING', type: 'CASH_OUT', senderWalletId: 'w_sender', amount: 7000,
            });
            txMock.wallet.update.mockResolvedValue({ id: 'w_sender', user: { id: 'user_4' } });

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-4', status: 'FAILED', code: '01' });

            expect(res.status).toBe(200);
            expect(txMock.wallet.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'w_sender' },
                data: { balance: { increment: 7000 } },
            }));
            expect(txMock.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'user_4', title: 'Retrait échoué' }),
            }));
        });

        it('devrait quand même accuser réception et journaliser en cas d\'exception interne', async () => {
            (prisma.transaction.findUnique as jest.Mock).mockRejectedValue(new Error('DB kaboom'));

            const res = await request(app)
                .post('/webhooks/pvit-status')
                .query({ key: 'secret123' })
                .send({ transactionId: 'tid1', merchantReferenceId: 'REF-5', status: 'SUCCESS', code: '00' });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ transactionId: 'tid1', responseCode: '00' });
            expect(logError).toHaveBeenCalledWith(
                'PVIT_WEBHOOK',
                'DB kaboom',
                expect.anything(),
                expect.objectContaining({ path: '/api/webhooks/pvit-status' })
            );
        });
    });
});
