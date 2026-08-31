import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import vaultRoutes from '../vault';

// Mock du middleware pour simuler un userId injecté
jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_user_id';
        next();
    }
}));

// Mock bcryptjs pour contrôler la vérification du PIN sur /vouchers/:id/spend
jest.mock('bcryptjs', () => ({
    compare: jest.fn()
}));

jest.mock('../../prisma', () => ({
    prisma: {
        vaultMember: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            upsert: jest.fn(),
            update: jest.fn(),
            count: jest.fn(),
            delete: jest.fn(),
            create: jest.fn()
        },
        vault: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        vaultTransaction: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        vaultApproval: {
            create: jest.fn()
        },
        vaultVoucher: {
            findMany: jest.fn(),
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn()
        },
        user: {
            findUnique: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            // Utilisé par getOrCreateCorporateWallet (wallet.ts) quand le compte corporate
            // n'existe pas encore — sans ce stub, un test qui atteint ce chemin plante avec
            // "tx.user.create is not a function" plutôt que d'échouer sur une vraie assertion.
            create: jest.fn()
        },
        systemAccount: {
            upsert: jest.fn()
        },
        notification: {
            create: jest.fn(),
            createMany: jest.fn()
        },
        wallet: {
            findUnique: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn()
        },
        // Ajoutés suite à l'introduction des frais P2P sur dépôt/retrait de caisse commune
        // (vault.ts lit désormais tx.systemSettings.findFirst() et écrit dans tx.transaction).
        systemSettings: {
            findFirst: jest.fn()
        },
        transaction: {
            create: jest.fn()
        },
        $transaction: jest.fn((callback) => callback(prisma))
    },
}));

const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());
app.use('/vault', vaultRoutes);

describe('Vault Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Baseline "aucun frais configuré" — jest.clearAllMocks() ne réinitialise QUE
        // l'historique d'appels, jamais une implémentation posée par un test précédent
        // (mockResolvedValue). Sans cette ligne, un test plus haut qui configure taxP2P
        // (ex. "devrait prélever les frais taxP2P...") laissait ce réglage fuiter vers TOUS
        // les tests suivants du fichier, qui se retrouvaient alors à tort sur le chemin
        // payant (crédit du corporate, éventuellement getOrCreateCorporateWallet) sans
        // jamais l'avoir demandé.
        (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue(null);
    });

    // ==========================================
    // GET /vault
    // ==========================================
    describe('GET /vault', () => {
        it('devrait retourner la liste des caisses dont l\'utilisateur est membre', async () => {
            const mockData = [{ id: 'vm1', vaultId: 'v1', userId: 'test_user_id', vault: { id: 'v1', name: 'Caisse A' } }];
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue(mockData);

            const res = await request(app).get('/vault');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual(mockData);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findMany as jest.Mock).mockRejectedValue(new Error('DB down'));

            const res = await request(app).get('/vault');

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
        });
    });

    // ==========================================
    // POST /vault
    // ==========================================
    describe('POST /vault', () => {
        it('devrait créer une caisse avec le seuil fourni', async () => {
            const createdVault = { id: 'v1', name: 'Caisse A', requiredApprovals: 3 };
            (prisma.vault.create as jest.Mock).mockResolvedValue(createdVault);
            (prisma.vaultMember.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/vault')
                .send({ name: 'Caisse A', description: 'Desc', requiredApprovals: 3 });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toEqual(createdVault);
            expect(prisma.vault.create).toHaveBeenCalledWith({
                data: { name: 'Caisse A', description: 'Desc', adminId: 'test_user_id', requiredApprovals: 3 }
            });
            expect(prisma.vaultMember.create).toHaveBeenCalledWith({
                data: { vaultId: 'v1', userId: 'test_user_id', isAdmin: true, isInitiator: true, isValidator: true, isTreasurer: true }
            });
        });

        it('devrait imposer un seuil minimum de 1 si requiredApprovals est invalide', async () => {
            (prisma.vault.create as jest.Mock).mockResolvedValue({ id: 'v1', requiredApprovals: 1 });
            (prisma.vaultMember.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/vault')
                .send({ name: 'Caisse B', requiredApprovals: 0 });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vault.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ requiredApprovals: 1 })
            });
        });

        it('devrait retourner 500 en cas d\'erreur de transaction', async () => {
            (prisma.vault.create as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/vault').send({ name: 'Caisse C' });

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
        });
    });

    // ==========================================
    // GET /vault/:id
    // ==========================================
    describe('GET /vault/:id', () => {
        it('devrait retourner 403 si l\'utilisateur n\'est pas membre', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/vault/v1');

            expect(res.status).toBe(403);
            expect(res.body.message).toContain("Vous n'êtes pas membre");
        });

        it('devrait retourner les détails de la caisse pour un membre', async () => {
            const membership = { vaultId: 'v1', userId: 'test_user_id', isAdmin: true };
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue(membership);
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A' });

            const res = await request(app).get('/vault/v1');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.role).toEqual(membership);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/vault/v1');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /vault/:id/invite
    // ==========================================
    describe('POST /vault/:id/invite', () => {
        it('devrait retourner 403 si l\'appelant n\'est pas admin', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: false });

            const res = await request(app).post('/vault/v1/invite').send({ phone: '+241000000' });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('Seul un admin');
        });

        it('devrait retourner 404 si l\'utilisateur invité est introuvable', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/v1/invite').send({ phone: '+241000000' });

            expect(res.status).toBe(404);
            expect(res.body.message).toContain('introuvable');
        });

        it('devrait ajouter le membre avec succès et le notifier', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2', phone: '+241000000' });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse A' });
            (prisma.vaultMember.upsert as jest.Mock).mockResolvedValue({ vaultId: 'v1', userId: 'u2' });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/invite').send({ phone: '+241000000' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.notification.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ userId: 'u2', type: 'INFO' })
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/vault/v1/invite').send({ phone: '+241000000' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // PUT /vault/:id/roles
    // ==========================================
    describe('PUT /vault/:id/roles', () => {
        it('devrait retourner 403 si l\'appelant n\'est pas admin', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: false });

            const res = await request(app).put('/vault/v1/roles').send({ targetUserId: 'u2', isValidator: true });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 404 si la cible n\'est pas membre', async () => {
            (prisma.vaultMember.findUnique as jest.Mock)
                .mockResolvedValueOnce({ isAdmin: true }) // adminCheck
                .mockResolvedValueOnce(null); // targetMember

            const res = await request(app).put('/vault/v1/roles').send({ targetUserId: 'u2', isValidator: true });

            expect(res.status).toBe(404);
            expect(res.body.message).toContain("n'est pas membre");
        });

        it('devrait refuser de retirer le dernier administrateur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock)
                .mockResolvedValueOnce({ isAdmin: true }) // adminCheck (caller)
                .mockResolvedValueOnce({ isAdmin: true, isValidator: true, isRequiredValidator: false }); // target
            (prisma.vaultMember.count as jest.Mock).mockResolvedValue(0); // otherAdmins

            const res = await request(app).put('/vault/v1/roles').send({ targetUserId: 'u2', isAdmin: false });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('dernier administrateur');
        });

        it('devrait refuser de retirer le dernier commissaire (validateur)', async () => {
            (prisma.vaultMember.findUnique as jest.Mock)
                .mockResolvedValueOnce({ isAdmin: true })
                .mockResolvedValueOnce({ isAdmin: false, isValidator: true, isRequiredValidator: false });
            (prisma.vaultMember.count as jest.Mock).mockResolvedValue(0); // otherValidators

            const res = await request(app).put('/vault/v1/roles').send({ targetUserId: 'u2', isValidator: false });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('dernier commissaire');
        });

        it('devrait forcer isRequiredValidator à false si isValidator devient false', async () => {
            (prisma.vaultMember.findUnique as jest.Mock)
                .mockResolvedValueOnce({ isAdmin: true })
                .mockResolvedValueOnce({ isAdmin: false, isValidator: true, isRequiredValidator: true });
            (prisma.vaultMember.count as jest.Mock).mockResolvedValue(1); // otherValidators > 0, OK to remove
            (prisma.vaultMember.update as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .put('/vault/v1/roles')
                .send({ targetUserId: 'u2', isValidator: false, isRequiredValidator: true });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vaultMember.update).toHaveBeenCalledWith({
                where: { vaultId_userId: { vaultId: 'v1', userId: 'u2' } },
                data: expect.objectContaining({ isValidator: false, isRequiredValidator: false })
            });
        });

        it('devrait mettre à jour les rôles avec succès', async () => {
            (prisma.vaultMember.findUnique as jest.Mock)
                .mockResolvedValueOnce({ isAdmin: true })
                .mockResolvedValueOnce({ isAdmin: false, isValidator: false, isRequiredValidator: false });
            (prisma.vaultMember.update as jest.Mock).mockResolvedValue({ isTreasurer: true });

            const res = await request(app)
                .put('/vault/v1/roles')
                .send({ targetUserId: 'u2', isTreasurer: true });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ isTreasurer: true });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).put('/vault/v1/roles').send({ targetUserId: 'u2' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // PUT /vault/:id/settings
    // ==========================================
    describe('PUT /vault/:id/settings', () => {
        it('devrait retourner 400 si le seuil est invalide', async () => {
            const res = await request(app).put('/vault/v1/settings').send({ requiredApprovals: 0 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('nombre entier');
        });

        it('devrait retourner 403 si l\'appelant n\'est pas admin', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: false });

            const res = await request(app).put('/vault/v1/settings').send({ requiredApprovals: 2 });

            expect(res.status).toBe(403);
        });

        it('devrait mettre à jour le seuil avec succès', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', requiredApprovals: 2 });

            const res = await request(app).put('/vault/v1/settings').send({ requiredApprovals: 2.9 });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vault.update).toHaveBeenCalledWith({
                where: { id: 'v1' },
                data: { requiredApprovals: 2 }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).put('/vault/v1/settings').send({ requiredApprovals: 2 });

            expect(res.status).toBe(500);
        });

        it('devrait retourner 400 si aucune modification n\'est fournie', async () => {
            const res = await request(app).put('/vault/v1/settings').send({});

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Aucune modification');
        });

        it('devrait rejeter un nom vide', async () => {
            const res = await request(app).put('/vault/v1/settings').send({ name: '   ' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('vide');
        });

        it('devrait renommer la caisse et mettre à jour la description sans toucher au seuil', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', name: 'Caisse Mariage 2', description: 'Nouvelle description' });

            const res = await request(app).put('/vault/v1/settings').send({ name: 'Caisse Mariage 2', description: 'Nouvelle description' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vault.update).toHaveBeenCalledWith({
                where: { id: 'v1' },
                data: { name: 'Caisse Mariage 2', description: 'Nouvelle description' },
            });
        });

        it('devrait effacer la description avec une chaîne vide', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', description: null });

            const res = await request(app).put('/vault/v1/settings').send({ description: '   ' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vault.update).toHaveBeenCalledWith({
                where: { id: 'v1' },
                data: { description: null },
            });
        });
    });

    // ==========================================
    // POST /vault/:id/leave
    // ==========================================
    describe('POST /vault/:id/leave', () => {
        it('devrait retourner 404 si l\'utilisateur n\'est pas membre', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/v1/leave');

            expect(res.status).toBe(404);
        });

        it('devrait refuser si admin quitte sans désigner un autre admin (autres membres présents)', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vaultMember.count as jest.Mock)
                .mockResolvedValueOnce(0) // otherAdmins
                .mockResolvedValueOnce(2); // otherMembers

            const res = await request(app).post('/vault/v1/leave');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Désignez un autre Président');
        });

        it('devrait refuser si dernier membre quitte avec un solde non nul', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vaultMember.count as jest.Mock)
                .mockResolvedValueOnce(0) // otherAdmins
                .mockResolvedValueOnce(0); // otherMembers
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 1000 });

            const res = await request(app).post('/vault/v1/leave');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Retirez d\'abord les fonds');
        });

        it('devrait permettre au dernier membre admin de quitter si le solde est nul', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: true });
            (prisma.vaultMember.count as jest.Mock)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0);
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 0 });
            (prisma.vaultMember.delete as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/leave');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('devrait permettre à un membre non-admin de quitter directement', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isAdmin: false });
            (prisma.vaultMember.delete as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/leave');

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vaultMember.delete).toHaveBeenCalledWith({
                where: { vaultId_userId: { vaultId: 'v1', userId: 'test_user_id' } }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/vault/v1/leave');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /vault/:id/deposit
    // ==========================================
    describe('POST /vault/:id/deposit', () => {
        it('devrait retourner 400 si le montant est invalide', async () => {
            const res = await request(app).post('/vault/v1/deposit').send({ amount: -10 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Montant invalide');
        });

        it('devrait retourner 400 si l\'utilisateur n\'est pas membre', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/v1/deposit').send({ amount: 100 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain("n'êtes pas membre");
        });

        it('devrait retourner 400 si le solde personnel est insuffisant', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ vaultId: 'v1', userId: 'test_user_id' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 50 });

            const res = await request(app).post('/vault/v1/deposit').send({ amount: 100 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('insuffisant');
        });

        it('devrait retourner 400 si la garde atomique échoue (course concurrente)', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ vaultId: 'v1', userId: 'test_user_id' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 500 });
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app).post('/vault/v1/deposit').send({ amount: 100 });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('insuffisant');
        });

        it('devrait déposer avec succès', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ vaultId: 'v1', userId: 'test_user_id' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 500 });
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', balance: 600 });
            (prisma.vaultTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1', type: 'DEPOSIT', amount: 100 });

            const res = await request(app).post('/vault/v1/deposit').send({ amount: 100 });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe('tx1');
        });

        it('devrait créer une transaction fantôme FEE-VD- pour le frais, en plus de la transaction principale', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ vaultId: 'v1', userId: 'test_user_id' });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w1', balance: 500 });
            (prisma.wallet.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.update as jest.Mock).mockResolvedValue({ id: 'v1', balance: 600 });
            (prisma.vaultTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1', type: 'DEPOSIT', amount: 100 });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ taxP2P: 0.01 });
            // getOrCreateCorporateWallet (../wallet, non mocké ici) interroge à son tour
            // prisma.systemAccount.upsert pour le compte système "corporate".
            (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'corp_user', wallet: { id: 'w_corporate', balance: 0 } });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/deposit').send({ amount: 100 });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: {
                    amount: 100,
                    fee: 1,
                    senderWalletId: 'w1',
                    receiverWalletId: 'w1',
                    status: 'COMPLETED',
                    reference: 'VAULT_DEP_tx1',
                }
            });
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: {
                    amount: 1,
                    senderWalletId: 'w1',
                    receiverWalletId: 'w_corporate',
                    status: 'COMPLETED',
                    reference: 'FEE-VD-tx1',
                }
            });
        });
    });

    // ==========================================
    // POST /vault/:id/withdraw-request
    // ==========================================
    describe('POST /vault/:id/withdraw-request', () => {
        it('devrait retourner 400 si le montant est invalide', async () => {
            const res = await request(app).post('/vault/v1/withdraw-request').send({ amount: 0, reason: 'Achat' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Montant invalide');
        });

        it('devrait retourner 400 si le motif est trop court', async () => {
            const res = await request(app).post('/vault/v1/withdraw-request').send({ amount: 100, reason: 'ab' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('motif');
        });

        it('devrait retourner 403 si l\'appelant n\'est pas initiateur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: false });

            const res = await request(app).post('/vault/v1/withdraw-request').send({ amount: 100, reason: 'Achat matériel' });

            expect(res.status).toBe(403);
            expect(res.body.message).toContain('Secrétaire');
        });

        it('devrait retourner 400 si le solde de la caisse est insuffisant', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 50, name: 'Caisse A' });

            const res = await request(app).post('/vault/v1/withdraw-request').send({ amount: 100, reason: 'Achat matériel' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('insuffisant');
        });

        it('devrait retourner 400 si TRANSFER sans numéro de destination', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 1000, name: 'Caisse A' });

            const res = await request(app)
                .post('/vault/v1/withdraw-request')
                .send({ amount: 100, reason: 'Achat matériel', destinationType: 'TRANSFER' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Numéro du destinataire requis');
        });

        it('devrait retourner 404 si TRANSFER vers un numéro inconnu', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 1000, name: 'Caisse A' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app)
                .post('/vault/v1/withdraw-request')
                .send({ amount: 100, reason: 'Achat matériel', destinationType: 'TRANSFER', destinationPhone: '+241000000' });

            expect(res.status).toBe(404);
            expect(res.body.message).toContain('Aucun compte Mongain');
        });

        it('devrait créer une demande VOUCHER et notifier les validateurs', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 1000, name: 'Caisse A' });
            (prisma.vaultTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1', status: 'PENDING' });
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([{ userId: 'validator1' }, { userId: 'validator2' }]);
            (prisma.notification.createMany as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/vault/v1/withdraw-request')
                .send({ amount: 100, reason: 'Achat matériel' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.vaultTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ destinationType: 'VOUCHER', status: 'PENDING' })
            });
            expect(prisma.notification.createMany).toHaveBeenCalled();
        });

        it('devrait créer une demande TRANSFER résolue vers le destinataire', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isInitiator: true });
            (prisma.vault.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', balance: 1000, name: 'Caisse A' });
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'recipient1', name: 'Jean' });
            (prisma.vaultTransaction.create as jest.Mock).mockResolvedValue({ id: 'tx1', status: 'PENDING' });
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([]);

            const res = await request(app)
                .post('/vault/v1/withdraw-request')
                .send({ amount: 100, reason: 'Paiement prestataire', destinationType: 'TRANSFER', destinationPhone: '+241000000' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vaultTransaction.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ destinationType: 'TRANSFER', destinationId: 'recipient1' })
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/vault/v1/withdraw-request').send({ amount: 100, reason: 'Achat matériel' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /vault/:id/approve/:txId
    // ==========================================
    describe('POST /vault/:id/approve/:txId', () => {
        it('devrait retourner 400 si l\'appelant n\'est pas validateur', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: false });

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('pas autorisé');
        });

        it('devrait retourner 400 si la transaction est introuvable ou déjà traitée', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({ status: 'COMPLETED' });

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà traitée');
        });

        it('devrait retourner 400 si l\'utilisateur a déjà approuvé', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                status: 'PENDING',
                approvals: [{ userId: 'test_user_id' }],
                vault: { requiredApprovals: 2, name: 'Caisse A' }
            });

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà approuvé');
        });

        it('devrait enregistrer l\'approbation mais ne pas exécuter si le seuil n\'est pas atteint', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'VOUCHER',
                vault: { requiredApprovals: 2, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false },
                { userId: 'other_validator', isValidator: true, isRequiredValidator: false }
            ]);
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/approve/tx1');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.data.executed).toBe(false);
            expect(prisma.vault.update).not.toHaveBeenCalled();
        });

        it('devrait rester en attente si un validateur obligatoire n\'a pas encore approuvé, même si le seuil numérique est atteint', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'VOUCHER',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false },
                { userId: 'required_validator', isValidator: true, isRequiredValidator: true }
            ]);
            (prisma.user.findMany as jest.Mock).mockResolvedValue([{ name: 'Marie' }]);
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/approve/tx1');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.data.executed).toBe(false);
        });

        it('devrait exécuter le retrait TREASURER/TRANSFER une fois le seuil atteint', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'TRANSFER',
                destinationId: 'dest1',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false }
            ]);
            (prisma.vaultTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_dest', balance: 0 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/approve/tx1');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.data.executed).toBe(true);
            // Réclamation atomique du statut AVANT le débit — empêche un second validateur
            // concurrent d'exécuter le même retrait une deuxième fois.
            expect(prisma.vaultTransaction.updateMany).toHaveBeenCalledWith({
                where: { id: 'tx1', status: 'PENDING' },
                data: { status: 'COMPLETED' }
            });
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_dest' },
                data: { balance: { increment: 100 } }
            });
        });

        it('devrait refuser l\'exécution si un autre validateur a déjà réclamé ce retrait (course concurrente)', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'TRANSFER',
                destinationId: 'dest1',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false }
            ]);
            // Un validateur concurrent a déjà fait basculer le statut entre notre lecture et
            // notre tentative de réclamation.
            (prisma.vaultTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('autre validateur');
            // Aucun mouvement de fonds ne doit avoir été tenté : la réclamation a échoué
            // avant le débit de la caisse.
            expect(prisma.vault.updateMany).not.toHaveBeenCalled();
            expect(prisma.wallet.update).not.toHaveBeenCalled();
        });

        it('devrait créer un bon de retrait (voucher) pour une destination VOUCHER', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'VOUCHER',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false }
            ]);
            (prisma.vaultTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vaultVoucher.create as jest.Mock).mockResolvedValue({ id: 'voucher1' });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/v1/approve/tx1');

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.vaultVoucher.create).toHaveBeenCalledWith({
                data: { vaultId: 'v1', amount: 100, presidentId: 'requester1' }
            });
        });

        it('devrait retourner 400 si le solde de la caisse est insuffisant au moment de l\'exécution', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'VOUCHER',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false }
            ]);
            (prisma.vaultTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Solde de la caisse insuffisant');
        });

        it('devrait retourner 400 si le portefeuille destinataire est introuvable', async () => {
            (prisma.vaultMember.findUnique as jest.Mock).mockResolvedValue({ isValidator: true });
            (prisma.vaultTransaction.findUnique as jest.Mock).mockResolvedValue({
                id: 'tx1',
                status: 'PENDING',
                approvals: [],
                vaultId: 'v1',
                amount: 100,
                requestedById: 'requester1',
                destinationType: 'TREASURER',
                destinationId: 'dest1',
                vault: { requiredApprovals: 1, name: 'Caisse A' }
            });
            (prisma.vaultApproval.create as jest.Mock).mockResolvedValue({});
            (prisma.vaultMember.findMany as jest.Mock).mockResolvedValue([
                { userId: 'test_user_id', isValidator: true, isRequiredValidator: false }
            ]);
            (prisma.vaultTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.vault.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/v1/approve/tx1');

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Portefeuille destinataire introuvable');
        });
    });

    // ==========================================
    // GET /vault/vouchers/my
    // ==========================================
    describe('GET /vault/vouchers/my', () => {
        it('devrait retourner les bons de retrait actifs du président', async () => {
            const mockVouchers = [{ id: 'v1', amount: 100, vault: { name: 'Caisse A' } }];
            (prisma.vaultVoucher.findMany as jest.Mock).mockResolvedValue(mockVouchers);

            const res = await request(app).get('/vault/vouchers/my');

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.data).toEqual(mockVouchers);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.vaultVoucher.findMany as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/vault/vouchers/my');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /vault/vouchers/:id/spend
    // ==========================================
    describe('POST /vault/vouchers/:id/spend', () => {
        it('devrait retourner 400 si le PIN est manquant ou invalide', async () => {
            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '12' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('PIN requis');
        });

        it('devrait retourner 404 si le compte est introuvable', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si le compte est temporairement bloqué', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 3,
                lockedUntil: new Date(Date.now() + 60000)
            });

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('bloqué');
        });

        it('devrait retourner 400 et incrémenter les tentatives si le PIN est incorrect', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 0,
                lockedUntil: null
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('incorrect');
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'test_user_id' },
                data: { failedPinAttempts: 1, lockedUntil: null }
            });
        });

        it('devrait bloquer le compte après 3 tentatives échouées', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 2,
                lockedUntil: null
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(false);
            (prisma.user.update as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('bloqué');
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'test_user_id' },
                data: { failedPinAttempts: 3, lockedUntil: expect.any(Date) }
            });
        });

        it('devrait retourner 400 si le bon est introuvable', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 0,
                lockedUntil: null
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('introuvable');
        });

        it('devrait retourner 400 si le bon est déjà utilisé', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 0,
                lockedUntil: null
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'USED', presidentId: 'test_user_id' });

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('déjà utilisé');
        });

        it('devrait retourner 400 si l\'appelant n\'est pas le propriétaire du bon', async () => {
            (prisma.user.findUnique as jest.Mock).mockResolvedValue({
                id: 'test_user_id',
                pin: 'hashed',
                failedPinAttempts: 0,
                lockedUntil: null
            });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'ACTIVE', presidentId: 'someone_else' });

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('propriétaire');
        });

        it('devrait retourner 400 si le marchand destinataire est introuvable', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'test_user_id', pin: 'hashed', failedPinAttempts: 0, lockedUntil: null })
                .mockResolvedValueOnce(null);
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'ACTIVE', presidentId: 'test_user_id', amount: 500 });

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('introuvable');
        });

        it('devrait dépenser le bon avec succès', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'test_user_id', pin: 'hashed', failedPinAttempts: 0, lockedUntil: null })
                .mockResolvedValueOnce({ id: 'merchant1', name: 'Marchand', wallet: { id: 'w_merchant', balance: 0 } });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'ACTIVE', presidentId: 'test_user_id', amount: 500 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.vaultVoucher.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_merchant' },
                data: { balance: { increment: 500 } }
            });
        });

        it('devrait prélever les frais taxP2P, créditer le corporate et tracer une Transaction', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'test_user_id', pin: 'hashed', failedPinAttempts: 0, lockedUntil: null })
                .mockResolvedValueOnce({ id: 'merchant1', name: 'Marchand', wallet: { id: 'w_merchant', balance: 0 } });
            // getOrCreateCorporateWallet (via ../wallet, non mocké ici) interroge à son tour
            // prisma.systemAccount.upsert pour le compte système "corporate".
            (prisma.systemAccount.upsert as jest.Mock).mockResolvedValue({ id: 'corp_user', wallet: { id: 'w_corporate', balance: 0 } });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'ACTIVE', presidentId: 'test_user_id', amount: 500 });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ taxP2P: 0.01 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.vaultVoucher.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            console.log(res.body); expect(res.status).toBe(200);
            // 500 FCFA à 1% => 5 FCFA de frais, 495 FCFA nets pour le marchand.
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_merchant' },
                data: { balance: { increment: 495 } }
            });
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_corporate' },
                data: { balance: { increment: 5 } }
            });
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: {
                    amount: 500,
                    fee: 5,
                    senderWalletId: 'w_merchant',
                    receiverWalletId: 'w_merchant',
                    status: 'COMPLETED',
                    reference: 'VAULT_VOUCHER_v1',
                }
            });
            // Transaction fantôme dédiée au frais (voir vault.ts) — sans elle, ce frais
            // n'apparaissait dans aucun graphique de revenu admin (Dashboard.tsx/
            // MacroStats.tsx/Ledger.tsx), qui n'agrègent que les références "FEE"-préfixées.
            expect(prisma.transaction.create).toHaveBeenCalledWith({
                data: {
                    amount: 5,
                    senderWalletId: 'w_merchant',
                    receiverWalletId: 'w_corporate',
                    status: 'COMPLETED',
                    reference: 'FEE-VV-v1',
                }
            });
        });

        it('devrait réinitialiser les tentatives échouées après un PIN correct', async () => {
            (prisma.user.findUnique as jest.Mock)
                .mockResolvedValueOnce({ id: 'test_user_id', pin: 'hashed', failedPinAttempts: 2, lockedUntil: null })
                .mockResolvedValueOnce({ id: 'merchant1', name: 'Marchand', wallet: { id: 'w_merchant', balance: 0 } });
            (bcrypt.compare as jest.Mock).mockResolvedValue(true);
            (prisma.user.update as jest.Mock).mockResolvedValue({});
            (prisma.vaultVoucher.findUnique as jest.Mock).mockResolvedValue({ id: 'v1', status: 'ACTIVE', presidentId: 'test_user_id', amount: 500 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.vaultVoucher.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.notification.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/vault/vouchers/v1/spend').send({ destinationPhone: '+241000000', pin: '1234' });

            console.log(res.body); expect(res.status).toBe(200);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: 'test_user_id' },
                data: { failedPinAttempts: 0, lockedUntil: null }
            });
        });
    });
});
