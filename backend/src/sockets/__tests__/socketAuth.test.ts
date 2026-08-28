import jwt from 'jsonwebtoken';
import { prisma } from '../../prisma';
import { resolveSocketRoom } from '../socketAuth';

jest.mock('jsonwebtoken');
jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
    },
}));

describe('resolveSocketRoom', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renvoie null si aucun jeton n'est fourni", async () => {
        expect(await resolveSocketRoom(undefined)).toBeNull();
        expect(await resolveSocketRoom('')).toBeNull();
        expect(await resolveSocketRoom(42)).toBeNull();
        expect(jwt.verify).not.toHaveBeenCalled();
    });

    it("renvoie null pour un jeton invalide/expiré, sans lever d'exception", async () => {
        (jwt.verify as jest.Mock).mockImplementation(() => { throw new Error('jwt expired'); });

        expect(await resolveSocketRoom('un-mauvais-token')).toBeNull();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('renvoie null pour un token Staff (isCorp) — pas de notifications temps réel pour le personnel', async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'staff_1', isCorp: true });

        expect(await resolveSocketRoom('tok-staff')).toBeNull();
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("renvoie null si l'utilisateur du token n'existe plus", async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'ghost' });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

        expect(await resolveSocketRoom('tok-ghost')).toBeNull();
    });

    it("dérive la salle depuis le numéro RÉEL en base, jamais d'une valeur fournie par le client", async () => {
        (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user_1' });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ phone: '+24177000000' });

        const room = await resolveSocketRoom('tok-valide');

        expect(room).toBe('user_+24177000000');
        expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user_1' }, select: { phone: true } });
    });
});
