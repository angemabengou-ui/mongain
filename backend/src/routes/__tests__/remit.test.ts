import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import remitRoutes from '../remit';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'user_1';
        next();
    },
}));

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
    },
}));

jest.mock('../../services/LimitEngine', () => ({
    LimitEngine: { verifyAndIncrementConsumption: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../services/systemAccounts', () => ({
    getSystemAccount: jest.fn(),
}));

jest.mock('../../utils/pinAuth', () => ({
    verifyUserPin: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../settings', () => ({
    getSystemSettings: jest.fn().mockResolvedValue({ forexMarkup: 0.025 }),
}));

jest.mock('../wallet', () => ({
    notifyParentOfChildSpend: jest.fn().mockResolvedValue(undefined),
    sendPush: jest.fn().mockResolvedValue(undefined),
}));

const app = express();
app.use(express.json());
app.use('/remit', remitRoutes);

// Aucun partenaire de transfert/paiement à l'étranger n'est connecté — FX_RATES est un tableau
// "Mock... for MVP" (voir docs/AUTO_CRITIQUE_PROJET.md) — /send doit rester désactivé par défaut
// tant qu'un partenaire réel n'est pas intégré, pour ne plus jamais débiter un client sans que
// rien ne parte réellement vers la destination annoncée. /quote reste ouvert (pas de mouvement
// de fonds, simple cotation).
describe('POST /remit/send — désactivé tant qu\'aucun partenaire de transfert réel n\'est connecté', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_REMIT;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_REMIT = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ENABLE_UNVERIFIED_REMIT = 'false';
    });

    it('devrait retourner 501 par défaut', async () => {
        const res = await request(app).post('/remit/send').send({
            destinationCountry: 'FR', destinationCurrency: 'EUR', recipientPhone: '+33600000000',
            amountXaf: 50000, pin: '1234'
        });

        expect(res.status).toBe(501);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('ne devrait pas bloquer /quote, qui ne déplace aucun fonds', async () => {
        const res = await request(app).post('/remit/quote').send({ destinationCurrency: 'EUR', amountXaf: 50000 });

        expect(res.status).not.toBe(501);
        expect(res.status).toBe(200);
    });
});

// Restriction Comptes Enfant : l'envoi d'argent à l'international ne fait pas partie des
// fonctionnalités approuvées pour un compte enfant — le mobile masque déjà le bouton
// correspondant, mais seul ce contrôle serveur constitue une vraie barrière.
describe('Restriction Comptes Enfant — /remit/send', () => {
    const ORIGINAL_FLAG = process.env.ENABLE_UNVERIFIED_REMIT;
    afterAll(() => { process.env.ENABLE_UNVERIFIED_REMIT = ORIGINAL_FLAG; });

    beforeEach(() => {
        jest.clearAllMocks();
        // Flag activé ici pour prouver que la restriction CHILD est un contrôle SÉPARÉ du
        // gate ENABLE_UNVERIFIED_REMIT, et non un effet de bord du 501 par défaut.
        process.env.ENABLE_UNVERIFIED_REMIT = 'true';
    });

    it('devrait bloquer /send avec 403 pour un compte CHILD, sans jamais débiter le wallet', async () => {
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({
            id: 'user_1', role: 'CHILD', accountStatus: 'ACTIVE', wallet: { id: 'w1', balance: 100000 }, pushToken: null
        });

        const res = await request(app).post('/remit/send').send({
            destinationCountry: 'FR', destinationCurrency: 'EUR', recipientPhone: '+33600000000',
            amountXaf: 50000, pin: '1234'
        });

        expect(res.status).toBe(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
