import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import { sendPush } from '../wallet';
import adminRoutes from '../admin.vaults';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

// Import dynamique (await import('./wallet')) déclenché dès qu'il y a au moins un membre à
// notifier lors d'un gel/dégel — sans ce mock, Jest chargerait le vrai wallet.ts (routes
// Express, Expo SDK, etc.) pour rien.
jest.mock('../wallet', () => ({
    sendPush: jest.fn(),
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findUnique: jest.fn() },
        vault: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        vaultMember: { findUnique: jest.fn(), count: jest.fn(), update: jest.fn() },
        vaultVoucher: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(),
    },
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'staff_1', role: 'SUPER_ADMIN' };
const RISK = { id: 'staff_1', role: 'RISK' };
const TELLER = { id: 'staff_1', role: 'TELLER' };
const SUPPORT_MAKER = { id: 'staff_1', role: 'SUPPORT_MAKER' };

describe('Admin Vaults Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /admin/vaults', () => {
        it('devrait retourner 403 pour un rôle sans perm_vault_view', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
            const res = await request(app).get('/admin/vaults');
            expect(res.status).toBe(403);
        });

        it('devrait être accessible à SUPPORT_MAKER (lecture, investigation litige)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.vault.findMany as jest.Mock).mockResolvedValue([]);
            const res = await request(app).get('/admin/vaults');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /admin/vaults/:id', () => {
        it('devrait retourner 404 si la caisse est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue(null);
            const res = await request(app).get('/admin/vaults/v1');
            expect(res.status).toBe(404);
        });

        it('devrait exposer canManage=false pour un rôle lecture seule', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A' });
            const res = await request(app).get('/admin/vaults/v1');
            expect(res.status).toBe(200);
            expect(res.body.canManage).toBe(false);
        });

        it('devrait exposer canManage=true pour RISK', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A' });
            const res = await request(app).get('/admin/vaults/v1');
            expect(res.body.canManage).toBe(true);
        });
    });

    describe('POST /admin/vaults/:id/freeze', () => {
        it('devrait rejeter sans motif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/vaults/v1/freeze').send({});
            expect(res.status).toBe(400);
        });

        it('devrait retourner 403 pour un rôle sans perm_vault_manage (ex: SUPPORT_MAKER, lecture seule)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPPORT_MAKER);
            const res = await request(app).post('/admin/vaults/v1/freeze').send({ reason: 'Litige signalé' });
            expect(res.status).toBe(403);
        });

        it('devrait geler la caisse, notifier les membres (base + push) et tracer un AuditLog pour RISK', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vault.update as jest.Mock).mockResolvedValue({
                id: 'v1', name: 'Caisse A', isFrozen: true,
                members: [{ userId: 'u1', user: { pushToken: 'tok1' } }, { userId: 'u2', user: { pushToken: null } }],
            });

            const res = await request(app).post('/admin/vaults/v1/freeze').send({ reason: 'Litige signalé' });

            expect(res.status).toBe(200);
            expect(prisma.vault.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'v1' },
                data: expect.objectContaining({ isFrozen: true, frozenReason: 'Litige signalé' }),
            }));
            expect(prisma.notification.createMany).toHaveBeenCalledWith({
                data: [
                    expect.objectContaining({ userId: 'u1', title: 'Caisse commune gelée' }),
                    expect.objectContaining({ userId: 'u2', title: 'Caisse commune gelée' }),
                ],
            });
            expect(sendPush).toHaveBeenCalledWith('tok1', 'Caisse commune gelée', expect.any(String));
            expect(sendPush).toHaveBeenCalledWith(null, 'Caisse commune gelée', expect.any(String));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'FREEZE_VAULT', adminId: 'staff_1' }),
            }));
        });

        it('ne devrait pas planter si la caisse gelée n\'a aucun membre', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A', isFrozen: true, members: [] });

            const res = await request(app).post('/admin/vaults/v1/freeze').send({ reason: 'Litige signalé' });

            expect(res.status).toBe(200);
            expect(prisma.notification.createMany).not.toHaveBeenCalled();
            expect(sendPush).not.toHaveBeenCalled();
        });
    });

    describe('POST /admin/vaults/:id/unfreeze', () => {
        it('devrait dégeler la caisse et notifier les membres (base + push)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A', isFrozen: false, members: [{ userId: 'u1', user: { pushToken: 'tok1' } }] });

            const res = await request(app).post('/admin/vaults/v1/unfreeze');

            expect(res.status).toBe(200);
            expect(prisma.vault.update).toHaveBeenCalledWith(expect.objectContaining({
                data: { isFrozen: false, frozenReason: null, frozenAt: null },
            }));
            expect(prisma.notification.createMany).toHaveBeenCalledWith({
                data: [expect.objectContaining({ userId: 'u1', title: 'Caisse commune dégelée' })],
            });
            expect(sendPush).toHaveBeenCalledWith('tok1', 'Caisse commune dégelée', expect.any(String));
        });
    });

    describe('POST /admin/vaults/:id/withdraw-requests/:txId/force-resolve', () => {
        it('devrait exiger decision et reason', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const res = await request(app).post('/admin/vaults/v1/withdraw-requests/tx1/force-resolve').send({});
            expect(res.status).toBe(400);
        });

        it('REJECT : devrait rejeter la demande et notifier le demandeur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const vaultTx = { id: 'tx1', vaultId: 'v1', status: 'PENDING', amount: 5000, requestedById: 'u1', vault: { name: 'Caisse A' } };
            const tx = {
                vaultTransaction: {
                    findUnique: jest.fn().mockResolvedValue(vaultTx),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                notification: { create: jest.fn().mockResolvedValue({}) },
                user: { findUnique: jest.fn().mockResolvedValue({ pushToken: null }) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/vaults/v1/withdraw-requests/tx1/force-resolve')
                .send({ decision: 'REJECT', reason: 'Justificatif insuffisant' });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('REJECTED');
            expect(tx.vaultTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: { status: 'REJECTED' },
            }));
            expect(tx.notification.create).toHaveBeenCalled();
        });

        it('APPROVE (VOUCHER) : devrait exécuter le retrait et créer un bon', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const vaultTx = { id: 'tx1', vaultId: 'v1', status: 'PENDING', amount: 5000, destinationType: 'VOUCHER', destinationId: null, requestedById: 'u1', vault: { name: 'Caisse A' } };
            const tx = {
                vaultTransaction: {
                    findUnique: jest.fn().mockResolvedValue(vaultTx),
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                vault: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
                vaultVoucher: { create: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
                user: { findUnique: jest.fn().mockResolvedValue({ pushToken: null }) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/vaults/v1/withdraw-requests/tx1/force-resolve')
                .send({ decision: 'APPROVE', reason: 'Quorum bloqué, motif vérifié manuellement' });

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('COMPLETED');
            expect(tx.vaultVoucher.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ vaultId: 'v1', amount: 5000, presidentId: 'u1' }),
            }));
        });

        it('devrait retourner 400 si la demande a déjà été traitée', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            const tx = { vaultTransaction: { findUnique: jest.fn().mockResolvedValue({ id: 'tx1', vaultId: 'v1', status: 'COMPLETED' }) } };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app)
                .post('/admin/vaults/v1/withdraw-requests/tx1/force-resolve')
                .send({ decision: 'REJECT', reason: 'Trop tard' });

            expect(res.status).toBe(400);
        });
    });

    describe('PUT /admin/vaults/:id/members/:userId/role', () => {
        it("devrait retourner 404 si la cible n'est pas membre", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).put('/admin/vaults/v1/members/u9/role').send({ isAdmin: false });

            expect(res.status).toBe(404);
        });

        it('devrait refuser de retirer le dernier administrateur (garde-fou partagé)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true, isValidator: true, isRequiredValidator: false });
            (prisma.vaultMember.count as jest.Mock).mockResolvedValue(0);

            const res = await request(app).put('/admin/vaults/v1/members/u1/role').send({ isAdmin: false });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('dernier administrateur');
        });

        it('devrait réassigner les rôles, notifier le membre concerné et tracer un AuditLog', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: false, isValidator: false, isRequiredValidator: false });
            (prisma.vaultMember.count as jest.Mock).mockResolvedValue(2);
            (prisma.vaultMember.update as jest.Mock).mockResolvedValue({ userId: 'u1', isValidator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ name: 'Caisse A' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ pushToken: null });

            const res = await request(app).put('/admin/vaults/v1/members/u1/role').send({ isValidator: true });

            expect(res.status).toBe(200);
            expect(prisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ userId: 'u1', title: 'Vos rôles ont été modifiés' }),
            }));
            expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ action: 'OVERRIDE_VAULT_MEMBER_ROLE' }),
            }));
        });
    });

    describe('POST /admin/vaults/:id/vouchers/:voucherId/void', () => {
        it("devrait retourner 400 si le bon n'est plus ACTIVE", async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'vo1', vaultId: 'v1', status: 'USED', amount: 5000, presidentId: 'u1' });
            const tx = {
                vaultVoucher: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
                vault: { update: jest.fn() },
                notification: { create: jest.fn() },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/vaults/v1/vouchers/vo1/void').send({ reason: 'Doublon' });

            expect(res.status).toBe(400);
            expect(tx.vault.update).not.toHaveBeenCalled();
        });

        it('devrait annuler un bon actif, reverser le solde à la caisse et notifier son porteur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'vo1', vaultId: 'v1', status: 'ACTIVE', amount: 5000, presidentId: 'u1' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ pushToken: null });
            const tx = {
                vaultVoucher: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
                vault: { update: jest.fn().mockResolvedValue({}) },
                notification: { create: jest.fn().mockResolvedValue({}) },
            };
            (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));

            const res = await request(app).post('/admin/vaults/v1/vouchers/vo1/void').send({ reason: 'Doublon' });

            expect(res.status).toBe(200);
            expect(tx.vaultVoucher.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'vo1', status: 'ACTIVE' },
                data: { status: 'VOID', voidReason: 'Doublon' },
            }));
            expect(tx.vault.update).toHaveBeenCalledWith({
                where: { id: 'v1' },
                data: { balance: { increment: 5000 } },
            });
            expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    userId: 'u1',
                    title: 'Bon de retrait annulé',
                    body: expect.stringContaining('reversé au solde de la caisse'),
                }),
            }));
        });
    });
});
