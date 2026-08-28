import { NextFunction, Request, Response } from 'express';
import { getSystemSettings } from '../routes/settings';

// `req.ip` peut se présenter en forme IPv4-mappée-IPv6 ("::ffff:203.0.113.5") selon la pile
// réseau — sans cette normalisation, une IP saisie sous sa forme IPv4 classique dans la
// liste ne correspondrait jamais à la valeur réellement observée à l'exécution, bloquant
// silencieusement un membre du personnel qui a pourtant la "bonne" IP.
export function normalizeIp(ip: string): string {
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// Restriction réseau du portail personnel — équivalent applicatif d'un VPN pour la jambe
// admin-web ↔ backend, désactivée par défaut (voir SystemSettings.adminIpAllowlistEnabled).
// Appliquée explicitement route par route / routeur par routeur (jamais à un mount
// générique qui mélangerait des routes publiques, comme GET /api/settings utilisé par
// l'app mobile pour les taux de frais — l'appliquer là bloquerait tous les clients).
export async function adminIpAllowlistMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const settings = await getSystemSettings();
        if (!settings.adminIpAllowlistEnabled) return next();

        const clientIp = req.ip ? normalizeIp(req.ip) : '';
        const allowed = (settings.adminIpAllowlist || []).map(normalizeIp);
        if (clientIp && allowed.includes(clientIp)) return next();

        return res.status(403).json({ error: 'Accès refusé depuis cette adresse IP.' });
    } catch (e) {
        // Une erreur ici (ex. base injoignable) ne doit jamais se traduire par un accès
        // accordé par défaut — voir CashOperationService/webhooks.ts pour le même principe
        // appliqué à l'argent : fermé par défaut en cas de doute, jamais ouvert.
        return res.status(503).json({ error: 'Service momentanément indisponible.' });
    }
}
