import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';
import { prisma } from '../prisma';

// Résout la salle Socket.io à rejoindre pour un jeton d'accès donné — jamais depuis une
// valeur fournie telle quelle par le client. Avant ce correctif, le client envoyait son
// propre numéro de téléphone en clair ('register', phone) sans aucune vérification, et le
// CORS Socket.io était en plus ouvert à `origin: '*'` : n'importe quel script pouvait
// rejoindre la salle de N'IMPORTE QUEL numéro et recevoir en direct chaque notification
// 'payment_received' (montant + nom de l'expéditeur) destinée à ce compte.
export async function resolveSocketRoom(authToken: unknown): Promise<string | null> {
    if (typeof authToken !== 'string' || !authToken) return null;

    try {
        const decoded = jwt.verify(authToken, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string; isCorp?: boolean };
        if (decoded.isCorp) return null; // Pas de notifications temps réel pour les comptes Staff pour l'instant.

        const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { phone: true } });
        if (!user) return null;

        return `user_${user.phone}`;
    } catch {
        // Jeton invalide/expiré : aucune salle, échec silencieux (comme authMiddleware côté
        // REST, pas de détail exposé sur la raison de l'échec).
        return null;
    }
}
