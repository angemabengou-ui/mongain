import { friendlyErrorMessage, isDbConnectivityError, withDbRetry } from '../errors';

describe('isDbConnectivityError', () => {
    it('devrait retourner true pour le code P1001', () => {
        expect(isDbConnectivityError({ code: 'P1001' })).toBe(true);
    });

    it('devrait retourner true pour le code P1002', () => {
        expect(isDbConnectivityError({ code: 'P1002' })).toBe(true);
    });

    it('devrait retourner true pour le code P1008', () => {
        expect(isDbConnectivityError({ code: 'P1008' })).toBe(true);
    });

    it('devrait retourner true pour le code P1017', () => {
        expect(isDbConnectivityError({ code: 'P1017' })).toBe(true);
    });

    it('devrait retourner true pour errorCode au lieu de code', () => {
        expect(isDbConnectivityError({ errorCode: 'P1001' })).toBe(true);
    });

    it('devrait retourner true pour name PrismaClientInitializationError', () => {
        expect(isDbConnectivityError({ name: 'PrismaClientInitializationError' })).toBe(true);
    });

    it('devrait retourner true si le message contient "Can\'t reach database server"', () => {
        expect(isDbConnectivityError({ message: "Can't reach database server at host" })).toBe(true);
    });

    it('devrait retourner true si le message contient "Server has closed the connection"', () => {
        expect(isDbConnectivityError({ message: 'Server has closed the connection unexpectedly' })).toBe(true);
    });

    it('devrait retourner false pour une erreur métier normale', () => {
        expect(isDbConnectivityError({ message: 'Solde insuffisant.' })).toBe(false);
    });

    it('devrait retourner false pour une erreur undefined', () => {
        expect(isDbConnectivityError(undefined)).toBe(false);
    });
});

describe('friendlyErrorMessage', () => {
    it('devrait retourner un message générique pour une erreur de connectivité DB', () => {
        const msg = friendlyErrorMessage({ code: 'P1001', message: 'Some internal detail' });
        expect(msg).toBe('Le service est momentanément indisponible. Veuillez réessayer dans quelques secondes.');
    });

    it('devrait retourner e.message pour une erreur métier normale', () => {
        const msg = friendlyErrorMessage({ message: 'Solde insuffisant.' });
        expect(msg).toBe('Solde insuffisant.');
    });

    it('devrait retourner le fallback par défaut si aucun message', () => {
        const msg = friendlyErrorMessage({});
        expect(msg).toBe('Une erreur inattendue est survenue.');
    });

    it('devrait retourner un fallback personnalisé si fourni et aucun message', () => {
        const msg = friendlyErrorMessage({}, 'Erreur custom.');
        expect(msg).toBe('Erreur custom.');
    });

    it('devrait gérer une erreur null/undefined sans planter', () => {
        const msg = friendlyErrorMessage(null);
        expect(msg).toBe('Une erreur inattendue est survenue.');
    });
});

describe('withDbRetry', () => {
    it('devrait retourner le résultat immédiatement si fn réussit du premier coup', async () => {
        const fn = jest.fn().mockResolvedValue('ok');
        const result = await withDbRetry(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('devrait réessayer une fois après une erreur de connectivité DB puis réussir', async () => {
        const fn = jest.fn()
            .mockRejectedValueOnce({ code: 'P1001', message: "Can't reach database server" })
            .mockResolvedValueOnce('recovered');

        const result = await withDbRetry(fn, 2, 1);
        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('devrait épuiser toutes les tentatives et relancer la dernière erreur de connectivité', async () => {
        const err = { code: 'P1001', message: "Can't reach database server" };
        const fn = jest.fn().mockRejectedValue(err);

        await expect(withDbRetry(fn, 3, 1)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('devrait relancer immédiatement sans réessayer pour une erreur non liée à la connectivité', async () => {
        const err = new Error('Solde insuffisant.');
        const fn = jest.fn().mockRejectedValue(err);

        await expect(withDbRetry(fn, 3, 1)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('devrait respecter le nombre de tentatives personnalisé', async () => {
        const err = { code: 'P1002' };
        const fn = jest.fn().mockRejectedValue(err);

        await expect(withDbRetry(fn, 1, 1)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
