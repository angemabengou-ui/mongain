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

// Le numéro/CVV sont générés par Math.random(), sans réseau Visa/Mastercard ni processeur
// connecté (voir docs/AUTO_CRITIQUE_PROJET.md) — /issue et /fund doivent rester désactivés par
// défaut tant qu'un émetteur de cartes réel n'est pas intégré.
describe('POST /cards/issue et /cards/:id/fund — désactivées tant qu\'aucun émetteur réel n\'est connecté', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_CARDS;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_CARDS = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ENABLE_UNVERIFIED_CARDS = 'false';
    });

    it('POST /cards/issue devrait retourner 501 par défaut', async () => {
        const res = await request(app).post('/cards/issue').send({});

        expect(res.status).toBe(501);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('POST /cards/:id/fund devrait retourner 501 par défaut', async () => {
        const res = await request(app).post('/cards/c1/fund').send({ amount: 5000, pin: '1234' });

        expect(res.status).toBe(501);
        expect(prisma.virtualCard.findUnique).not.toHaveBeenCalled();
    });
});

// Restriction Comptes Enfant : l'émission/le rechargement de carte virtuelle ne fait pas
// partie des fonctionnalités approuvées pour un compte enfant — le mobile masque déjà le
// bouton correspondant, mais seul ce contrôle serveur constitue une vraie barrière.
describe('Restriction Comptes Enfant — /cards/issue et /cards/:id/fund', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_CARDS;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_CARDS = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        // Flag activé ici pour prouver que la restriction CHILD est un contrôle SÉPARÉ du
        // gate ENABLE_UNVERIFIED_CARDS, et non un effet de bord du 501 par défaut.
        process.env.ENABLE_UNVERIFIED_CARDS = 'true';
    });

    it('devrait bloquer /issue avec 403 pour un compte CHILD, sans jamais créer de carte', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'user_1', role: 'CHILD', accountStatus: 'ACTIVE', wallet: { id: 'w1' }
        });

        const res = await request(app).post('/cards/issue').send({});

        expect(res.status).toBe(403);
        // La génération de numéro de carte interroge virtualCard.findUnique en boucle pour
        // vérifier l'unicité — s'il n'est jamais appelé, la logique de création n'a pas été
        // atteinte.
        expect(prisma.virtualCard.findUnique).not.toHaveBeenCalled();
    });

    it('devrait bloquer /fund avec 403 pour un compte CHILD, sans jamais débiter le wallet', async () => {
        (prisma.virtualCard.findUnique as jest.Mock).mockResolvedValue({
            id: 'c1', userId: 'user_1', status: 'ACTIVE', fundingWalletId: 'w1',
            fundingWallet: { id: 'w1', balance: 100000 },
            user: { id: 'user_1', role: 'CHILD' }
        });

        const res = await request(app).post('/cards/c1/fund').send({ amount: 5000, pin: '1234' });

        expect(res.status).toBe(403);
        expect(prisma.virtualCard.update).not.toHaveBeenCalled();
    });
});
