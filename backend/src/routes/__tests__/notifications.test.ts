import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import notificationsRoutes from '../notifications';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_user_id';
        next();
    },
}));

jest.mock('../../prisma', () => ({
    prisma: {
        notification: {
            findMany: jest.fn(),
            count: jest.fn(),
            updateMany: jest.fn(),
        },
    },
}));

const app = express();
app.use(express.json());
app.use('/notifications', notificationsRoutes);

describe('Notifications Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /notifications', () => {
        it('devrait retourner la liste des 30 dernières notifications de l\'utilisateur', async () => {
            const mockData = [{ id: 'n1' }, { id: 'n2' }];
            (prisma.notification.findMany as jest.Mock).mockResolvedValue(mockData);

            const res = await request(app).get('/notifications');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockData);
            expect(prisma.notification.findMany).toHaveBeenCalledWith({
                where: { userId: 'test_user_id' },
                orderBy: { createdAt: 'desc' },
                take: 30,
            });
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.notification.findMany as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/notifications');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Erreur réseau');
        });
    });

    describe('GET /notifications/unread-count', () => {
        it('devrait retourner le nombre de notifications non lues', async () => {
            (prisma.notification.count as jest.Mock).mockResolvedValue(5);

            const res = await request(app).get('/notifications/unread-count');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ count: 5 });
            expect(prisma.notification.count).toHaveBeenCalledWith({
                where: { userId: 'test_user_id', isRead: false },
            });
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.notification.count as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/notifications/unread-count');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Erreur réseau');
        });
    });

    describe('PUT /notifications/:id/read', () => {
        it('devrait marquer une notification comme lue', async () => {
            (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

            const res = await request(app).put('/notifications/n1/read');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });
            expect(prisma.notification.updateMany).toHaveBeenCalledWith({
                where: { id: 'n1', userId: 'test_user_id' },
                data: { isRead: true },
            });
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.notification.updateMany as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).put('/notifications/n1/read');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Erreur réseau');
        });
    });

    describe('PUT /notifications/read-all', () => {
        it('devrait marquer toutes les notifications comme lues', async () => {
            (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

            const res = await request(app).put('/notifications/read-all');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true });
            expect(prisma.notification.updateMany).toHaveBeenCalledWith({
                where: { userId: 'test_user_id', isRead: false },
                data: { isRead: true },
            });
        });

        it('devrait retourner 500 en cas d\'erreur', async () => {
            (prisma.notification.updateMany as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).put('/notifications/read-all');

            expect(res.status).toBe(500);
            expect(res.body.error).toBe('Erreur réseau');
        });
    });
});
