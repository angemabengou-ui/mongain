import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prisma } from '../../prisma';
import walletRoutes from '../wallet';

// Mock du module Prisma pour ne pas taper la base de données de dev
jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        wallet: { findUnique: jest.fn(), update: jest.fn() },
        transaction: { create: jest.fn(), findMany: jest.fn() },
        systemSettings: { findFirst: jest.fn() },
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
});
