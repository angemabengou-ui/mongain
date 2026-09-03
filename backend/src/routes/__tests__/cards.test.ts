import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import cardsRoutes from '../cards';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'user_1';
        next();
    },
}));

jest.mock('../../middleware/circuitBreaker', () => ({
    circuitBreakerMiddleware: (req: any, res: any, next: any) => next(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        virtualCard: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        user: { findUnique: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

const app = express();
app.use(express.json());
app.use('/cards', cardsRoutes);

describe('PUT /cards/:id/freeze', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait refuser au titulaire de débloquer une carte BLOCKED par le back-office', async () => {
        (prisma.virtualCard.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'user_1', status: 'BLOCKED' });

        const res = await request(app).put('/cards/c1/freeze');

        expect(res.status).toBe(403);
        expect(prisma.virtualCard.update).not.toHaveBeenCalled();
    });

    it('devrait permettre au titulaire de geler sa propre carte ACTIVE', async () => {
        (prisma.virtualCard.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'user_1', status: 'ACTIVE' });
        (prisma.virtualCard.update as jest.Mock).mockResolvedValue({ id: 'c1', status: 'FROZEN' });

        const res = await request(app).put('/cards/c1/freeze');

        expect(res.status).toBe(200);
        expect(prisma.virtualCard.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'FROZEN' } });
    });

    it('devrait permettre au titulaire de dégeler sa propre carte FROZEN (auto-gel)', async () => {
        (prisma.virtualCard.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'user_1', status: 'FROZEN' });
        (prisma.virtualCard.update as jest.Mock).mockResolvedValue({ id: 'c1', status: 'ACTIVE' });

        const res = await request(app).put('/cards/c1/freeze');

        expect(res.status).toBe(200);
        expect(prisma.virtualCard.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { status: 'ACTIVE' } });
    });

    it('devrait retourner 404 si la carte n\'appartient pas à l\'appelant', async () => {
        (prisma.virtualCard.findUnique as jest.Mock).mockResolvedValue({ id: 'c1', userId: 'someone_else', status: 'ACTIVE' });

        const res = await request(app).put('/cards/c1/freeze');

        expect(res.status).toBe(404);
    });
});
