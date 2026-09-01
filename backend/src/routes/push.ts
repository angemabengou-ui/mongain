import { Expo } from 'expo-server-sdk';
import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();
let expo = new Expo();

// POST /api/admin/push/broadcast
router.post('/broadcast', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !hasPermission(admin, 'perm_analytics_view')) {
            return res.status(403).json({ error: 'Accès refusé. Privilèges manquants.' });
        }

        const { title, message, target } = req.body;
        if (!title || !message) return res.status(400).json({ error: 'Titre et message requis.' });

        // Build target query
        let query: any = { pushToken: { not: null } };
        if (target === 'AGENTS') {
            query.role = { in: ['AGENT', 'MERCHANT'] };
        } else if (target === 'FROZEN') {
            query.accountStatus = 'FROZEN';
        } // 'ALL' leaves query alone

        const users = await prisma.user.findMany({ where: query, select: { pushToken: true } });

        let messages = [];
        for (let user of users) {
            if (user.pushToken && Expo.isExpoPushToken(user.pushToken)) {
                messages.push({
                    to: user.pushToken,
                    sound: 'default',
                    title,
                    body: message,
                    data: { withSome: 'data' },
                });
            }
        }

        let chunks = expo.chunkPushNotifications(messages as any);
        let tickets = [];

        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                logger.error('Erreur lors du traitement d\'un morceau de notifications EXPO.', error);
            }
        }

        res.json({ success: true, count: messages.length, ticketsSent: tickets.length });
    } catch (e: any) {
        logger.error(`[Push API Error] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
