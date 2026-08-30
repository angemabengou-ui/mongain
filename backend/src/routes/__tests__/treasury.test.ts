import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import treasuryRoutes from '../treasury';

// Mock du middleware pour simuler un userId injecté (identifiant Staff ici)
jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'staff_1';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        branch: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        centralTreasury: { findFirst: jest.fn(), create: jest.fn() },
        systemAccount: { findMany: jest.fn() },
        treasuryRequest: {
            count: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            findUnique: jest.fn(),
            updateMany: jest.fn(),
            update: jest.fn()
        },
        systemSettings: { findFirst: jest.fn() },
        wallet: { aggregate: jest.fn(), update: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
        transaction: { create: jest.fn() },
        auditLog: { create: jest.fn() },
        reconciliationCase: { findMany: jest.fn(), update: jest.fn() },
        $transaction: jest.fn((callback) => callback(prisma)),
        $executeRaw: jest.fn()
    },
}));

const app = express();
app.use(express.json());
app.use('/treasury', treasuryRoutes);

const SUPER_ADMIN = { id: 'staff_1', role: 'SUPER_ADMIN', isActive: true, branchId: null };
const CHECKER = { id: 'staff_1', role: 'COMPLIANCE_CHECKER', isActive: true, branchId: null };
const RISK = { id: 'staff_1', role: 'RISK', isActive: true, branchId: null };
const BRANCH_MANAGER = { id: 'staff_1', role: 'BRANCH_MANAGER', isActive: true, branchId: 'branch_own', permissionsCustomized: true, permissions: ['perm_treasury_allocate'] };

// Depuis la séparation Trésorerie Centrale / Siège : la Réserve n'est plus une Branch,
// getCentralTreasury() la trouve via prisma.centralTreasury.findFirst().
const CENTRAL_TREASURY = { id: 'ct_1', walletId: 'w_hq', wallet: { id: 'w_hq', balance: 10000000 } };

beforeEach(() => {
    // systemAccount.findMany est utilisé pour les comptes système dans /overview — valeur
    // par défaut vide pour ne pas casser les tests qui ne testent pas ce détail.
    (prisma.systemAccount.findMany as jest.Mock).mockResolvedValue([]);
});

describe('Treasury Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // ==========================================
    // GET /treasury/overview
    // ==========================================
    describe('GET /treasury/overview', () => {
        it('devrait retourner 403 si le rôle n\'est pas autorisé', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'BRANCH_MANAGER' });

            const res = await request(app).get('/treasury/overview');

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Accès refusé');
        });

        it('devrait retourner un aperçu global de la trésorerie', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            // Le Siège n'est plus exclu : c'est une agence normale depuis la séparation.
            (prisma.branch.findMany as jest.Mock).mockResolvedValue([
                { wallet: { balance: 500 }, balance: 200, walletId: 'w_b1' }
            ]);
            (prisma.treasuryRequest.count as jest.Mock).mockResolvedValue(3);
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({ id: 'ct_1', walletId: 'w_hq', wallet: { id: 'w_hq', balance: 1000 } });
            // Compte système (ex: Passerelle Externe) : exclu de clientWalletsBalance, compté à part.
            (prisma.systemAccount.findMany as jest.Mock).mockResolvedValue([{ wallet: { id: 'w_gateway', balance: 999999999 } }]);
            (prisma.wallet.aggregate as jest.Mock).mockResolvedValue({ _sum: { balance: 700 } });

            const res = await request(app).get('/treasury/overview');

            expect(res.status).toBe(200);
            expect(res.body.reserveBalance).toBe(1000);
            expect(res.body.totalAgencyElectronic).toBe(500);
            expect(res.body.totalPhysicalVault).toBe(200);
            expect(res.body.clientWalletsBalance).toBe(700);
            expect(res.body.systemAccountsBalance).toBe(999999999);
            expect(res.body.moneySupply).toBe(1000 + 500 + 700 + 999999999);
            expect(res.body.pendingRequestsCount).toBe(3);
            // Le wallet de la Trésorerie Centrale et les wallets système doivent être exclus
            // du calcul "Portefeuilles Clients", pas seulement les wallets d'agences.
            expect(prisma.wallet.aggregate).toHaveBeenCalledWith({
                where: { id: { notIn: ['w_b1', 'w_hq', 'w_gateway'] } },
                _sum: { balance: true }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/treasury/overview');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // GET /treasury/requests
    // ==========================================
    describe('GET /treasury/requests', () => {
        it('devrait retourner 403 si le compte staff est inactif ou introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).get('/treasury/requests');

            expect(res.status).toBe(403);
        });

        it('devrait retourner la liste des requêtes de trésorerie', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const mockRequests = [{ id: 'req1', type: 'ISSUANCE' }];
            (prisma.treasuryRequest.findMany as jest.Mock).mockResolvedValue(mockRequests);

            const res = await request(app).get('/treasury/requests');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockRequests);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/treasury/requests');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /treasury/requests
    // ==========================================
    describe('POST /treasury/requests', () => {
        it('devrait retourner 403 si le rôle du maker est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'COMPLIANCE_CHECKER_JUNIOR' });

            const res = await request(app).post('/treasury/requests').send({ type: 'ISSUANCE', amount: 1000, reason: 'Test créat' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si les données sont invalides (zod)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);

            const res = await request(app).post('/treasury/requests').send({ type: 'INVALID_TYPE', amount: -5, reason: 'x' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Données invalides');
        });

        it('devrait retourner 403 si le circuit breaker est actif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: true });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ISSUANCE', amount: 1000, reason: 'Création monnaie' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('Circuit Breaker');
        });

        it('devrait retourner 400 si le montant ISSUANCE dépasse le plafond', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false, maxMintAmount: 500 });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ISSUANCE', amount: 1000, reason: 'Création monnaie' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('plafonnée');
        });

        it('devrait permettre de cibler le Siège comme une agence normale pour une ALLOCATION', async () => {
            // Depuis la séparation Trésorerie Centrale / Siège, le Siège (même flaggé
            // isHQ=true) n'est plus la Réserve elle-même : il peut recevoir une Allocation
            // comme n'importe quelle autre agence ("le siège peut aussi avoir son agence").
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.treasuryRequest.create as jest.Mock).mockResolvedValue({ id: 'req_hq' });
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ALLOCATION', amount: 1000, reason: 'Allocation vers le Siège', targetBranchId: 'hq_1' });

            expect(res.status).toBe(200);
        });

        it('devrait retourner 400 si ALLOCATION sans cible', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ALLOCATION', amount: 1000, reason: 'Allocation test' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('cible');
        });

        it('devrait retourner 400 si les fonds centraux sont insuffisants pour une ALLOCATION', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({ id: 'ct_1', walletId: 'w_hq', wallet: { id: 'w_hq', balance: 100 } });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ALLOCATION', amount: 1000, reason: 'Allocation test', targetBranchId: 'branch_2' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('insuffisants');
        });

        it('devrait retourner 403 si un BRANCH_MANAGER tente un RETURN pour une autre agence', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(BRANCH_MANAGER);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'RETURN', amount: 1000, reason: 'Retour agence', targetBranchId: 'branch_other' });

            expect(res.status).toBe(403);
            expect(res.body.error).toContain('propre agence');
        });

        it('devrait retourner 400 si RETURN sans agence d\'origine', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'RETURN', amount: 1000, reason: 'Retour agence' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('agence');
        });

        it('devrait créer une requête ISSUANCE avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false, maxMintAmount: 1000000000 });
            (prisma.treasuryRequest.create as jest.Mock).mockResolvedValue({ id: 'req1', type: 'ISSUANCE', amount: 1000 });
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ISSUANCE', amount: 1000, reason: 'Création monnaie' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.request.id).toBe('req1');
            expect(prisma.auditLog.create).toHaveBeenCalled();
        });

        it('devrait créer une requête ALLOCATION avec succès quand les fonds sont suffisants', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.treasuryRequest.create as jest.Mock).mockResolvedValue({ id: 'req2', type: 'ALLOCATION', amount: 1000 });
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ALLOCATION', amount: 1000, reason: 'Allocation agence', targetBranchId: 'branch_2' });

            expect(res.status).toBe(200);
            expect(res.body.request.id).toBe('req2');
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app)
                .post('/treasury/requests')
                .send({ type: 'ISSUANCE', amount: 1000, reason: 'Création monnaie' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /treasury/requests/:id/approve
    // ==========================================
    describe('POST /treasury/requests/:id/approve', () => {
        it('devrait retourner 403 si le rôle du checker est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'BRANCH_MANAGER' });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(403);
        });

        it('devrait retourner 500 si la requête est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('introuvable');
        });

        it('devrait refuser l\'auto-approbation par le maker (sauf SUPER_ADMIN)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'staff_1', status: 'PENDING', amount: 1000, targetBranch: null
            });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('ne peut pas s\'approuver');
        });

        it('devrait refuser si la requête n\'est pas PENDING (idempotence)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'EXECUTED', amount: 1000, targetBranch: null
            });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('déjà été traitée');
        });

        it('devrait refuser si le circuit breaker est actif', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 1000, targetBranch: null
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: true });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('Circuit Breaker');
        });

        it('devrait exiger le SUPER_ADMIN au-delà du seuil d\'approbation', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 6000000, targetBranch: null
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false, treasuryApprovalThreshold: 5000000 });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('SUPER_ADMIN');
        });

        it('devrait échouer si la réclamation atomique perd la course (déjà traitée)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 1000, targetBranch: null
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('déjà été traitée');
        });

        it('devrait exécuter une requête ISSUANCE avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 1000, targetBranch: null, reference: 'ISS-1', type: 'ISSUANCE'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_hq' },
                data: { balance: { increment: 1000 } }
            });
        });

        it('devrait exécuter un ADJUSTMENT vers une agence flaggée isHQ comme une agence normale', async () => {
            // Depuis la séparation, le Siège n'est plus la Réserve elle-même : plus de garde
            // anti-auto-ciblage, un ADJUSTMENT vers cette agence s'exécute normalement.
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 1000, targetBranchId: 'hq_1',
                targetBranch: { id: 'hq_1', walletId: 'w_hq_branch' }, reference: 'ADJ-1', type: 'ADJUSTMENT'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_hq_branch' },
                data: { balance: { increment: 1000 } }
            });
        });

        it('devrait exécuter une requête ALLOCATION vers une agence avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 500,
                targetBranch: { id: 'branch_2', walletId: 'w_b2' }, reference: 'ALL-1', type: 'ALLOCATION'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_hq', balance: { gte: 500 } },
                data: { balance: { decrement: 500 } }
            });
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_b2' },
                data: { balance: { increment: 500 } }
            });
        });

        it('devrait refuser l\'exécution ALLOCATION si les fonds centraux sont insuffisants', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 500,
                targetBranch: { id: 'branch_2', walletId: 'w_b2' }, reference: 'ALL-1', type: 'ALLOCATION'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue({ id: 'ct_1', walletId: 'w_hq', wallet: { id: 'w_hq', balance: 100 } });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('insuffisants');
        });

        it('devrait exécuter une requête RETURN avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 300,
                targetBranch: { id: 'branch_2', walletId: 'w_b2' }, reference: 'RET-1', type: 'RETURN'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_b2', balance: 1000 });
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_b2', balance: { gte: 300 } },
                data: { balance: { decrement: 300 } }
            });
        });

        it('devrait refuser l\'exécution RETURN si l\'agence a une monnaie électronique insuffisante', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 300,
                targetBranch: { id: 'branch_2', walletId: 'w_b2' }, reference: 'RET-1', type: 'RETURN'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w_b2', balance: 50 });

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
            expect(res.body.error).toContain('insuffisante');
        });

        it('devrait exécuter un ADJUSTMENT vers la réserve elle-même (aucune cible)', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({
                id: 'req1', makerId: 'other_maker', status: 'PENDING', amount: 400,
                targetBranch: null, targetWalletId: null, reference: 'ADJ-1', type: 'ADJUSTMENT'
            });
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ circuitBreaker: false });
            (prisma.treasuryRequest.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
            (prisma.centralTreasury.findFirst as jest.Mock).mockResolvedValue(CENTRAL_TREASURY);
            (prisma.wallet.update as jest.Mock).mockResolvedValue({});
            (prisma.transaction.create as jest.Mock).mockResolvedValue({});
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(200);
            expect(prisma.wallet.update).toHaveBeenCalledWith({
                where: { id: 'w_hq' },
                data: { balance: { increment: 400 } }
            });
        });

        it('devrait retourner 500 en cas d\'erreur serveur inattendue', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/treasury/requests/req1/approve');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /treasury/requests/:id/reject
    // ==========================================
    describe('POST /treasury/requests/:id/reject', () => {
        it('devrait retourner 403 si le rôle est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'BRANCH_MANAGER' });

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'Motif valide' });

            expect(res.status).toBe(403);
        });

        it('devrait retourner 400 si le motif de rejet est trop court', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'no' });

            expect(res.status).toBe(400);
        });

        it('devrait retourner 404 si la requête est introuvable', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue(null);

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'Motif valide' });

            expect(res.status).toBe(404);
        });

        it('devrait retourner 400 si la requête n\'est pas PENDING', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'req1', status: 'EXECUTED' });

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'Motif valide' });

            expect(res.status).toBe(400);
        });

        it('devrait rejeter la requête avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(CHECKER);
            (prisma.treasuryRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'req1', status: 'PENDING', reference: 'ISS-1' });
            (prisma.treasuryRequest.update as jest.Mock).mockResolvedValue({ id: 'req1', status: 'REJECTED' });
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'Motif valide' });

            expect(res.status).toBe(200);
            expect(res.body.request.status).toBe('REJECTED');
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/treasury/requests/req1/reject').send({ rejectionReason: 'Motif valide' });

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // GET /treasury/agencies-liquidity
    // ==========================================
    describe('GET /treasury/agencies-liquidity', () => {
        it('devrait retourner 403 si le rôle est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'INVALID_ROLE' });

            const res = await request(app).get('/treasury/agencies-liquidity');

            expect(res.status).toBe(403);
        });

        it('devrait retourner le statut de liquidité des agences', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(RISK);
            (prisma.systemSettings.findFirst as jest.Mock).mockResolvedValue({ agencyLowLiquidityThreshold: 1000, agencyCriticalLiquidity: 100 });
            (prisma.branch.findMany as jest.Mock).mockResolvedValue([
                { id: 'b1', name: 'A', code: 'A1', isActive: true, wallet: { balance: 5000 }, balance: 100 },
                { id: 'b2', name: 'B', code: 'B1', isActive: true, wallet: { balance: 500 }, balance: 50 },
                { id: 'b3', name: 'C', code: 'C1', isActive: true, wallet: { balance: 50 }, balance: 10 }
            ]);

            const res = await request(app).get('/treasury/agencies-liquidity');

            expect(res.status).toBe(200);
            expect(res.body[0].status).toBe('HEALTHY');
            expect(res.body[1].status).toBe('LOW');
            expect(res.body[2].status).toBe('CRITICAL');
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/treasury/agencies-liquidity');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // GET /treasury/reconciliation
    // ==========================================
    describe('GET /treasury/reconciliation', () => {
        it('devrait retourner 403 si le rôle est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'INVALID_ROLE' });

            const res = await request(app).get('/treasury/reconciliation');

            expect(res.status).toBe(403);
        });

        it('devrait retourner le registre des cas de réconciliation', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            const cases = [{ id: 'case1', status: 'PENDING' }];
            (prisma.reconciliationCase.findMany as jest.Mock).mockResolvedValue(cases);

            const res = await request(app).get('/treasury/reconciliation');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(cases);
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).get('/treasury/reconciliation');

            expect(res.status).toBe(500);
        });
    });

    // ==========================================
    // POST /treasury/reconciliation/:id/resolve
    // ==========================================
    describe('POST /treasury/reconciliation/:id/resolve', () => {
        it('devrait retourner 403 si le rôle est insuffisant', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff_1', role: 'INVALID_ROLE' });

            const res = await request(app).post('/treasury/reconciliation/case1/resolve').send({ resolution: 'OK', newStatus: 'RESOLVED' });

            expect(res.status).toBe(403);
        });

        it('devrait résoudre un cas de réconciliation avec succès', async () => {
            (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
            (prisma.reconciliationCase.update as jest.Mock).mockResolvedValue({ id: 'case1', status: 'RESOLVED' });
            (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

            const res = await request(app).post('/treasury/reconciliation/case1/resolve').send({ resolution: 'OK', newStatus: 'RESOLVED' });

            expect(res.status).toBe(200);
            expect(res.body.case.status).toBe('RESOLVED');
        });

        it('devrait retourner 500 en cas d\'erreur serveur', async () => {
            (prisma.staff.findUnique as jest.Mock).mockRejectedValue(new Error('DB fail'));

            const res = await request(app).post('/treasury/reconciliation/case1/resolve').send({ resolution: 'OK' });

            expect(res.status).toBe(500);
        });
    });
});
