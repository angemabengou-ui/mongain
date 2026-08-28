import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import corpRoutes from '../corp';

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash: jest.fn(async () => 'hashed'),
}));

jest.mock('../../services/sms', () => ({
    sendSms: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
        staffVerificationCode: { upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    },
}));

const bcrypt = require('bcryptjs');
const { sendSms } = require('../../services/sms');

const app = express();
app.use(express.json());
app.use('/corp', corpRoutes);

const STAFF = {
    id: 'staff_1',
    email: 'checker@mongain.com',
    password: 'hashed-pw',
    name: 'Fatou',
    role: 'COMPLIANCE_CHECKER',
    branchId: null,
    phone: '+24177000000',
    isActive: true,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    jwtVersion: 0,
    mustChangePassword: false,
};

describe('POST /corp/login', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        delete process.env.TWILIO_ACCOUNT_SID; // Mode démo -> code fixe '1234'
    });

    it('rejette un mot de passe incorrect (401)', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
        (bcrypt.compare as jest.Mock).mockResolvedValue(false);

        const res = await request(app).post('/corp/login').send({ email: STAFF.email, password: 'wrong' });

        expect(res.status).toBe(401);
        expect(prisma.staffVerificationCode.upsert).not.toHaveBeenCalled();
    });

    it("bloque la connexion si le compte n'a aucun téléphone enregistré (pas de repli silencieux sans 2FA)", async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...STAFF, phone: null });
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const res = await request(app).post('/corp/login').send({ email: STAFF.email, password: 'good' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Aucun numéro de téléphone/);
        expect(sendSms).not.toHaveBeenCalled();
    });

    it('envoie un code OTP et renvoie requireOtp — ne délivre jamais le token directement', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
        (bcrypt.compare as jest.Mock).mockResolvedValue(true);

        const res = await request(app).post('/corp/login').send({ email: STAFF.email, password: 'good' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ requireOtp: true, message: expect.any(String) });
        expect(res.body.token).toBeUndefined();
        expect(prisma.staffVerificationCode.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { staffId: STAFF.id },
        }));
    });
});

describe('POST /corp/verify-login-otp', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('rejette un code invalide ou expiré', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
        (prisma.staffVerificationCode.findUnique as jest.Mock).mockResolvedValue({ staffId: STAFF.id, code: '1234', expiresAt: new Date(Date.now() - 1000) });

        const res = await request(app).post('/corp/verify-login-otp').send({ email: STAFF.email, otpCode: '1234' });

        expect(res.status).toBe(400);
        expect(prisma.staffVerificationCode.delete).not.toHaveBeenCalled();
    });

    it('délivre un token et supprime le code à usage unique en cas de succès', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(STAFF);
        (prisma.staffVerificationCode.findUnique as jest.Mock).mockResolvedValue({ staffId: STAFF.id, code: '1234', expiresAt: new Date(Date.now() + 60000) });

        const res = await request(app).post('/corp/verify-login-otp').send({ email: STAFF.email, otpCode: '1234' });

        expect(res.status).toBe(200);
        expect(res.body.token).toEqual(expect.any(String));
        expect(res.body.user).toEqual(expect.objectContaining({ id: STAFF.id, email: STAFF.email }));
        expect(prisma.staffVerificationCode.delete).toHaveBeenCalledWith({ where: { staffId: STAFF.id } });
    });
});
