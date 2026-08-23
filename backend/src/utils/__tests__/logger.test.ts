import logger, { logger as namedLogger } from '../logger';

describe('logger', () => {
    it('devrait exporter le même logger en export nommé et en export par défaut', () => {
        expect(logger).toBe(namedLogger);
    });

    it('devrait avoir le niveau "debug" hors production (NODE_ENV=test)', () => {
        expect(logger.level).toBe('debug');
    });

    it('devrait exposer les méthodes standards de winston', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('ne devrait pas lever d\'exception lors d\'un appel info/error', () => {
        expect(() => logger.info('message de test')).not.toThrow();
        expect(() => logger.error(new Error('erreur de test'))).not.toThrow();
    });
});
