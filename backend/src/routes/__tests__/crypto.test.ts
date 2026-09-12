import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import cryptoRoutes from '../crypto';

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
        cryptoWallet: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        cryptoTransaction: { create: jest.fn() },
        wallet: { update: jest.fn() },
        transaction: { create: jest.fn() },
        user: { findUnique: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../utils/pinAuth', () => ({
    verifyUserPin: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({}),
}));

jest.mock('../wallet', () => ({
    notifyParentOfChildSpend: jest.fn().mockResolvedValue(undefined),
}));

const app = express();
app.use(express.json());
app.use('/crypto', cryptoRoutes);

// Aucune bourse/custodian n'est réellement connectée — RATES est un tableau codé en dur (voir
// docs/AUTO_CRITIQUE_PROJET.md) — /buy doit rester désactivé par défaut tant qu'un partenaire
// d'exchange réel n'est pas intégré. /sell reste volontairement ouvert pour ne pas enfermer un
// client qui détiendrait déjà une position simulée sans moyen de la reconvertir en XAF réel.
describe('POST /crypto/buy — désactivé tant qu\'aucune bourse réelle n\'est connectée', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_CRYPTO;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_CRYPTO = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ENABLE_UNVERIFIED_CRYPTO = 'false';
    });

    it('devrait retourner 501 par défaut', async () => {
        const res = await request(app).post('/crypto/buy').send({ asset: 'BTC', amountXaf: 5000, pin: '1234' });

        expect(res.status).toBe(501);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('ne devrait pas bloquer /sell, pour ne pas enfermer une position déjà détenue', async () => {
        (prisma.cryptoWallet.findFirst as jest.Mock).mockResolvedValue({ id: 'cw1', userId: 'user_1', asset: 'BTC', balance: 0.001 });
        (prisma.cryptoWallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user_1', wallet: { id: 'w1' } });

        const res = await request(app).post('/crypto/sell').send({ asset: 'BTC', amountCrypto: 0.0005, pin: '1234' });

        expect(res.status).not.toBe(501);
        expect(res.status).toBe(200);
    });
});

// Restriction Comptes Enfant : l'achat/vente de cryptomonnaies ne fait pas partie des
// fonctionnalités approuvées pour un compte enfant (voir docs produit) — le mobile masque déjà
// le bouton correspondant, mais seul ce contrôle serveur constitue une vraie barrière.
describe('Restriction Comptes Enfant — /crypto/buy et /crypto/sell', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_CRYPTO;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_CRYPTO = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        // Flag activé ici pour prouver que la restriction CHILD est un contrôle SÉPARÉ du
        // gate ENABLE_UNVERIFIED_CRYPTO, et non un effet de bord du 501 par défaut.
        process.env.ENABLE_UNVERIFIED_CRYPTO = 'true';
    });

    it('devrait bloquer /buy avec 403 pour un compte CHILD, sans jamais débiter le wallet', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'user_1', role: 'CHILD', accountStatus: 'ACTIVE', wallet: { id: 'w1', balance: 100000 }
        });

        const res = await request(app).post('/crypto/buy').send({ asset: 'BTC', amountXaf: 5000, pin: '1234' });

        expect(res.status).toBe(403);
        expect(prisma.cryptoTransaction.create).not.toHaveBeenCalled();
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });

    it('devrait bloquer /sell avec 403 pour un compte CHILD, sans jamais créditer le wallet', async () => {
        (prisma.cryptoWallet.findFirst as jest.Mock).mockResolvedValue({ id: 'cw1', userId: 'user_1', asset: 'BTC', balance: 0.001 });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user_1', role: 'CHILD', wallet: { id: 'w1' } });

        const res = await request(app).post('/crypto/sell').send({ asset: 'BTC', amountCrypto: 0.0005, pin: '1234' });

        expect(res.status).toBe(403);
        expect(prisma.cryptoWallet.updateMany).not.toHaveBeenCalled();
        expect(prisma.transaction.create).not.toHaveBeenCalled();
    });
});
