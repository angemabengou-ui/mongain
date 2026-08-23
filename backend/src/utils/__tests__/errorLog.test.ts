import { prisma } from '../../prisma';
import { logError } from '../errorLog';

jest.mock('../../prisma', () => ({
    prisma: {
        errorLog: { create: jest.fn() },
    },
}));

describe('logError', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        (console.error as jest.Mock).mockRestore();
    });

    it('devrait créer un log avec source, message et méta fournis', async () => {
        (prisma.errorLog.create as jest.Mock).mockResolvedValue({});

        await logError('PVIT_WEBHOOK', 'Erreur de test', { foo: 'bar' }, { userId: 'user_1', path: '/api/webhooks/pvit-status' });

        expect(prisma.errorLog.create).toHaveBeenCalledWith({
            data: {
                source: 'PVIT_WEBHOOK',
                message: 'Erreur de test',
                details: JSON.stringify({ foo: 'bar' }),
                userId: 'user_1',
                path: '/api/webhooks/pvit-status',
            },
        });
    });

    it('devrait stocker details tel quel si déjà une chaîne', async () => {
        (prisma.errorLog.create as jest.Mock).mockResolvedValue({});

        await logError('SOURCE', 'msg', 'raw string details');

        expect(prisma.errorLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ details: 'raw string details' }),
        });
    });

    it('devrait mettre details à null si non fourni', async () => {
        (prisma.errorLog.create as jest.Mock).mockResolvedValue({});

        await logError('SOURCE', 'msg');

        expect(prisma.errorLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ details: null, userId: undefined, path: undefined }),
        });
    });

    it('devrait tronquer le message à 2000 caractères', async () => {
        (prisma.errorLog.create as jest.Mock).mockResolvedValue({});
        const longMessage = 'x'.repeat(3000);

        await logError('SOURCE', longMessage);

        const callArgs = (prisma.errorLog.create as jest.Mock).mock.calls[0][0];
        expect(callArgs.data.message.length).toBe(2000);
    });

    it('devrait tronquer details à 5000 caractères', async () => {
        (prisma.errorLog.create as jest.Mock).mockResolvedValue({});
        const longDetails = 'y'.repeat(6000);

        await logError('SOURCE', 'msg', longDetails);

        const callArgs = (prisma.errorLog.create as jest.Mock).mock.calls[0][0];
        expect(callArgs.data.details.length).toBe(5000);
    });

    it('ne devrait pas lever d\'exception si prisma.errorLog.create échoue', async () => {
        (prisma.errorLog.create as jest.Mock).mockRejectedValue(new Error('DB down'));

        await expect(logError('SOURCE', 'msg')).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });
});
