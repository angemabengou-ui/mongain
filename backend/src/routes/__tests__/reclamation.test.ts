import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import reclamationRoutes from '../reclamation';

// Mock du middleware pour simuler un userId injecté
jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_user_id';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        reclamation: {
            create: jest.fn(),
            findMany: jest.fn()
        }
    }
}));

const app = express();
app.use(express.json());
app.use('/reclamation', reclamationRoutes);

describe('Reclamation Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /reclamation', () => {
        it('devrait retourner 400 si titre ou description manque', async () => {
            const res = await request(app).post('/reclamation').send({ title: 'Test' });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Titre et description requis.');
        });

        it('devrait créer une réclamation avec 200 OK', async () => {
            (prisma.reclamation.create as jest.Mock).mockResolvedValue({ id: 'rec_1', title: 'Test', description: 'Desc' });
            const res = await request(app).post('/reclamation').send({ title: 'Test', description: 'Desc' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.reclamation.id).toBe('rec_1');
        });
    });

    describe('GET /reclamation', () => {
        it('devrait récupérer la liste des réclamations', async () => {
            const mockData = [{ id: 'rec_1' }, { id: 'rec_2' }];
            (prisma.reclamation.findMany as jest.Mock).mockResolvedValue(mockData);
            const res = await request(app).get('/reclamation');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockData);
        });
    });
});
