import express from 'express';
import request from 'supertest';
import { prisma } from '../../prisma';
import adminRoutes from '../admin.search';

jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req: any, res: any, next: any) => {
        req.userId = 'test_staff_id';
        next();
    }
}));

jest.mock('../../prisma', () => ({
    prisma: {
        staff: { findUnique: jest.fn() },
        user: { findMany: jest.fn() },
        vault: { findMany: jest.fn() },
        tontineGroup: { findMany: jest.fn() },
    },
}));

const app = express();
app.use(express.json());
app.use('/admin', adminRoutes);

const SUPER_ADMIN = { id: 'test_staff_id', role: 'SUPER_ADMIN' };
const TELLER = { id: 'test_staff_id', role: 'TELLER' };

describe('GET /admin/search (recherche globale)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait retourner 403 pour un rôle non autorisé', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'bad', role: 'INVALID_ROLE' });

        const res = await request(app).get('/admin/search').query({ q: 'ndong' });

        expect(res.status).toBe(403);
    });

    it('devrait retourner des listes vides pour une requête trop courte (sans interroger la base)', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);

        const res = await request(app).get('/admin/search').query({ q: 'a' });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ users: [], vaults: [], tontines: [], merchants: [] });
        expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('devrait interroger les 4 domaines en parallèle et retourner les résultats', async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(SUPER_ADMIN);
        // user.findMany est appelé deux fois (users hors MERCHANT, puis merchants) —
        // distinguer les deux appels via le filtre `role` passé en argument.
        (prisma.user.findMany as jest.Mock).mockImplementation(async (args: any) => {
            if (args.where?.role === 'MERCHANT') return [{ id: 'm1', name: 'Boutique Ndong', phone: '066' }];
            return [{ id: 'u1', name: 'Jean Ndong', phone: '077', role: 'USER' }];
        });
        (prisma.vault.findMany as jest.Mock).mockResolvedValue([{ id: 'v1', name: 'Caisse Ndong' }]);
        (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'Tontine Ndong' }]);

        const res = await request(app).get('/admin/search').query({ q: 'ndong' });

        expect(res.status).toBe(200);
        expect(res.body.users).toHaveLength(1);
        expect(res.body.vaults).toHaveLength(1);
        expect(res.body.tontines).toHaveLength(1);
        expect(res.body.merchants).toEqual([{ id: 'm1', name: 'Boutique Ndong', phone: '066' }]);
        expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    });

    it("ne renvoie ni caisses, ni tontines, ni marchands pour un TELLER (dépourvu de perm_vault_view/perm_tontine_view/perm_merchant_view) même si des résultats existent", async () => {
        (prisma.staff.findUnique as jest.Mock).mockResolvedValue(TELLER);
        (prisma.user.findMany as jest.Mock).mockImplementation(async (args: any) => {
            if (args.where?.role === 'MERCHANT') return [{ id: 'm1', name: 'Boutique Ndong', phone: '066' }];
            return [{ id: 'u1', name: 'Jean Ndong', phone: '077', role: 'USER' }];
        });
        (prisma.vault.findMany as jest.Mock).mockResolvedValue([{ id: 'v1', name: 'Caisse Ndong' }]);
        (prisma.tontineGroup.findMany as jest.Mock).mockResolvedValue([{ id: 'g1', name: 'Tontine Ndong' }]);

        const res = await request(app).get('/admin/search').query({ q: 'ndong' });

        expect(res.status).toBe(200);
        // Un TELLER a perm_customer_360_basic (passe le contrôle d'accès global), donc "users"
        // reste peuplé — mais aucune des 3 autres catégories, dont il n'a la permission de
        // destination pour aucune, sans quoi il obtiendrait un résultat de recherche menant à
        // un onglet vide côté interface (App.tsx bloque Vaults/Tontines/Merchants sur ces mêmes
        // permissions).
        expect(res.body.users).toHaveLength(1);
        expect(res.body.vaults).toEqual([]);
        expect(res.body.tontines).toEqual([]);
        expect(res.body.merchants).toEqual([]);
        expect(prisma.vault.findMany).not.toHaveBeenCalled();
        expect(prisma.tontineGroup.findMany).not.toHaveBeenCalled();
    });
});
