import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { JWT_SECRET } from '../../middleware/auth';
import { prisma } from '../../prisma';
import authRoutes from '../auth';

jest.mock('../../prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        verificationCode: { count: jest.fn(), upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    },
}));

jest.mock('../../services/sms', () => ({
    sendSms: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);

describe('Auth Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /auth/request-otp', () => {
        it('devrait rejeter un numéro invalide', async () => {
            const res = await request(app).post('/auth/request-otp').send({ phone: '123' });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Numéro de téléphone invalide');
        });

        it('devrait envoyer le code OTP si le numéro est valide', async () => {
            (prisma.verificationCode.count as jest.Mock).mockResolvedValue(0);
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/auth/request-otp').send({ phone: '066123456' });
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Code envoyé avec succès.');
            expect(prisma.verificationCode.upsert).toHaveBeenCalled();
        });
    });

    describe('POST /auth/register', () => {
        it('devrait rejeter avec une erreur 400 si OTP est invalide', async () => {
            (prisma.verificationCode.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/auth/register').send({
                name: 'Test',
                username: 'tester',
                phone: '066123456',
                pin: '1234',
                otpCode: '0000'
            });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Code de vérification invalide ou expiré.');
        });
    });

    describe('POST /auth/refresh', () => {
        it('devrait rejeter un refresh token absent du corps de la requête', async () => {
            const res = await request(app).post('/auth/refresh').send({});
            expect(res.status).toBe(400);
        });

        it('devrait rejeter un refresh token inconnu', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/auth/refresh').send({ refreshToken: 'bogus' });

            expect(res.status).toBe(401);
            expect(res.body.error).toContain('Session expirée');
        });

        it('devrait rejeter un refresh token expiré', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', jwtVersion: 0, isActive: true, accountStatus: 'ACTIVE',
                refreshTokenExpiresAt: new Date(Date.now() - 1000), // déjà expiré
            });

            const res = await request(app).post('/auth/refresh').send({ refreshToken: 'stale' });

            expect(res.status).toBe(401);
        });

        it('devrait rejeter le refresh pour un compte suspendu', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', jwtVersion: 0, isActive: true, accountStatus: 'SUSPENDED',
                refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
            });

            const res = await request(app).post('/auth/refresh').send({ refreshToken: 'valid' });

            expect(res.status).toBe(403);
        });

        it('devrait renouveler la session (rotation) pour un refresh token valide', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'u1', jwtVersion: 2, isActive: true, accountStatus: 'ACTIVE',
                refreshTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
            });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/auth/refresh').send({ refreshToken: 'valid' });

            expect(res.status).toBe(200);
            expect(res.body.token).toEqual(expect.any(String));
            expect(res.body.refreshToken).toEqual(expect.any(String));
            // Rotation : le nouveau refresh token renvoyé n'est jamais celui reçu en entrée.
            expect(res.body.refreshToken).not.toBe('valid');
            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'u1' },
                data: expect.objectContaining({ refreshTokenHash: expect.any(String), refreshTokenExpiresAt: expect.any(Date) }),
            }));

            // Le nouvel access token porte bien le jwtVersion actuel de l'utilisateur.
            const decoded = jwt.verify(res.body.token, JWT_SECRET) as { userId: string, jwtVersion: number };
            expect(decoded.userId).toBe('u1');
            expect(decoded.jwtVersion).toBe(2);
        });
    });

    describe('POST /auth/logout', () => {
        it('devrait rejeter sans token d\'authentification', async () => {
            const res = await request(app).post('/auth/logout');
            expect(res.status).toBe(401);
        });

        it('devrait révoquer le refresh token stocké pour l\'utilisateur authentifié', async () => {
            const accessToken = jwt.sign({ userId: 'u1', jwtVersion: 0 }, JWT_SECRET, { expiresIn: '30m' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', isActive: true, jwtVersion: 0 });
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/auth/logout').set('Authorization', `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'u1' },
                data: { refreshTokenHash: null, refreshTokenExpiresAt: null, jwtVersion: { increment: 1 } },
            });
        });
    });

    describe('PUT /auth/profile', () => {
        const accessToken = jwt.sign({ userId: 'u1', jwtVersion: 0 }, JWT_SECRET, { expiresIn: '30m' });

        beforeEach(() => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', isActive: true, jwtVersion: 0 });
        });

        it('stamps un résultat NOT_CONFIGURED (services/kycVendorCheck.ts) quand le dossier KYC complet (3 documents) est soumis', async () => {
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', kycStatus: 'PENDING', kycLevel: 0, wallet: null });

            const res = await request(app).put('/auth/profile').set('Authorization', `Bearer ${accessToken}`).send({
                name: 'Jean', idCardFront: 'front.jpg', idCardBack: 'back.jpg', selfie: 'selfie.jpg',
            });

            expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'u1' },
                data: expect.objectContaining({
                    kycStatus: 'PENDING',
                    kycVendorProvider: null,
                    kycVendorStatus: 'NOT_CONFIGURED',
                    kycVendorCheckedAt: expect.any(Date),
                }),
                include: { wallet: true },
            });
        });

        it('ne touche pas aux champs de vérification tierce pour une mise à jour partielle sans dossier KYC complet', async () => {
            (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'u1', name: 'Jean', kycStatus: 'UNVERIFIED', kycLevel: 0, wallet: null });

            const res = await request(app).put('/auth/profile').set('Authorization', `Bearer ${accessToken}`).send({ name: 'Jean' });

            expect(res.status).toBe(200);
            const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
            expect(updateCall.data).not.toHaveProperty('kycVendorStatus');
            expect(updateCall.data).not.toHaveProperty('kycStatus');
        });
    });
});
