import { NextFunction, Request, Response } from 'express';
import { getSystemSettings } from '../../routes/settings';
import { circuitBreakerMiddleware } from '../circuitBreaker';

jest.mock('../../routes/settings', () => ({
    getSystemSettings: jest.fn(),
}));

describe('circuitBreakerMiddleware', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let next: NextFunction;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { method: 'GET' };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    it('devrait appeler next() si aucun paramètre système n\'est trouvé', async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue(null);

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('devrait retourner 503 MAINTENANCE si globalMaintenance est actif', async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ globalMaintenance: true, circuitBreaker: false });

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'MAINTENANCE' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait retourner 503 CIRCUIT_BREAKER pour une requête POST si circuitBreaker est actif', async () => {
        req.method = 'POST';
        (getSystemSettings as jest.Mock).mockResolvedValue({ globalMaintenance: false, circuitBreaker: true });

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'CIRCUIT_BREAKER' }));
        expect(next).not.toHaveBeenCalled();
    });

    it('devrait laisser passer une requête GET même si circuitBreaker est actif', async () => {
        req.method = 'GET';
        (getSystemSettings as jest.Mock).mockResolvedValue({ globalMaintenance: false, circuitBreaker: true });

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('devrait appeler next() normalement si aucun flag n\'est actif', async () => {
        (getSystemSettings as jest.Mock).mockResolvedValue({ globalMaintenance: false, circuitBreaker: false });

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('devrait retourner 503 SYSTEM_UNAVAILABLE si getSystemSettings lève une exception', async () => {
        (getSystemSettings as jest.Mock).mockRejectedValue(new Error('DB down'));

        await circuitBreakerMiddleware(req as Request, res as Response, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'SYSTEM_UNAVAILABLE' }));
        expect(next).not.toHaveBeenCalled();
    });
});
