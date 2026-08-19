import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma';

export const circuitBreakerMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const settings = await prisma.systemSettings.findFirst();
        if (!settings) return next();

        // Mode Maintenance Globale
        if (settings.globalMaintenance) {
            return res.status(503).json({
                error: 'MAINTENANCE',
                message: 'MONGAIN EST EN MODE MAINTENANCE. Nos systèmes sont actuellement en cours de mise à jour.'
            });
        }

        // Circuit Breaker (Verrouillage stricte des opérations financières / écritures)
        // Les GET (lecture de solde) peuvent passer, mais pas les transferts, paiements, cashin, cashout.
        if (settings.circuitBreaker && req.method !== 'GET') {
            return res.status(503).json({
                error: 'CIRCUIT_BREAKER',
                message: 'Le système est en verrouillage d\'urgence. Les opérations financières sont temporairement suspendues pour votre sécurité.'
            });
        }

        next();
    } catch (e: any) {
        console.error('CircuitBreaker Failure:', e);
        // Fail-open ou fail-closed ? En cas de doute absolu sur la BDD, fail-open permet au moins de récupérer un signal, mais par sécurité financière, fail-closed est mieux.
        // Ici on laisse passer si c'est la DB qui vacille brièvement, ou plutôt on bloque : 
        return res.status(503).json({ error: 'SYSTEM_UNAVAILABLE', message: 'Système indisponible.' });
    }
};
