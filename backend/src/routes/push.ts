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
        // perm_broadcast_send dédiée, pas perm_analytics_view (une permission de LECTURE que
        // BRANCH_MANAGER/RISK/COMPLIANCE_CHECKER possèdent tous par défaut) : envoyer une
        // notification de masse à TOUS les clients/agents/marchands de la plateforme n'a
        // rien à voir avec le droit de consulter un tableau de bord.
        if (!admin || !hasPermission(admin, 'perm_broadcast_send')) {
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

        const users = await prisma.user.findMany({ where: query, select: { pushToken: true, phone: true } });

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
            // SOCKET.IO FALLBACK: Emit local push instruction directly to the connected device!
            // `io` lu via req.app.get('io') plutôt qu'importé de '../index' au niveau du
            // module (voir CashOperationService.ts/credit.ts) — un import direct chargeait
            // toute l'application comme effet de bord d'un simple require de ce fichier.
            req.app.get('io').to(`user_${user.phone}`).emit('global_push', { title, body: message });
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
