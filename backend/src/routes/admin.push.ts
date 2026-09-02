import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import logger from '../utils/logger';

const router = Router();
const expo = new Expo();

export async function sendPushNotification(pushToken: string, title: string, body: string, data = {}) {
    if (!Expo.isExpoPushToken(pushToken)) return;
    try {
        const messages: ExpoPushMessage[] = [{ to: pushToken, sound: 'default', title, body, data }];
        const chunks = expo.chunkPushNotifications(messages);
        for (let chunk of chunks) {
            await expo.sendPushNotificationsAsync(chunk);
        }
    } catch (e: any) {
        logger.error(`[PUSH ERREUR] ${e.message}`);
    }
}

// POST /api/admin/push/broadcast
router.post('/broadcast', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
        // En vrai production, valider la permission PUSH_CENTER ou SUPER_ADMIN
        if (!admin || !['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
            return res.status(403).json({ error: "Accès refusé au CRM. Rôle SUPER_ADMIN requis." });
        }

        const { title, message, target } = req.body;
        if (!title || !message) return res.status(400).json({ error: "Titre et message obligatoires." });

        // Resolve Target
        let whereClause: any = { pushToken: { not: null } };

        switch (target) {
            case 'AGENTS':
                whereClause.role = 'AGENT';
                break;
            case 'FROZEN':
                whereClause.status = 'SUSPENDED';
                break;
            case 'ALL':
            default:
                break;
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            select: { pushToken: true }
        });

        // Filter valid tokens
        const validTokens = users.map(u => u.pushToken as string).filter(t => Expo.isExpoPushToken(t));

        if (validTokens.length === 0) {
            return res.status(400).json({ error: "Aucun appareil compatible trouvé pour cette cible." });
        }

        // Format to Expo Messages
        let messages: ExpoPushMessage[] = [];
        for (let pushToken of validTokens) {
            messages.push({
                to: pushToken,
                sound: 'default',
                title,
                body: message,
                data: { origin: 'CRM_BROADCAST' },
            });
        }

        // Chunk and Send
        let chunks = expo.chunkPushNotifications(messages);
        let tickets = [];
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                logger.error(error);
            }
        }

        logger.info(`[CRM] Broadcast envoye: ${validTokens.length} appareils atteints.`);

        res.json({ success: true, ticketsSent: validTokens.length });
    } catch (e: any) {
        logger.error(`[PUSH BROADCAST] ${e.message}`);
        res.status(500).json({ error: e.message || 'Erreur serveur.' });
    }
});

export default router;
