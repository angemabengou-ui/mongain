import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

// ==========================================
// RECHERCHE GLOBALE (barre du haut du portail)
// ==========================================
// Avant ça, retrouver un client/caisse/tontine précis obligeait à d'abord deviner le
// bon écran, puis à parcourir sa liste manuellement — Vaults/Tontines n'avaient même
// pas de filtre local. Un seul champ, interrogeant les 3 domaines en parallèle,
// plafonné à 5 résultats chacun : de quoi sauter directement à la fiche visée.
// Extrait de admin.ts (portion "RECHERCHE GLOBALE") lors du découpage du monolithe.

router.get('/search', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'Accès refusé.' });

        const q = ((req.query.q as string) || '').trim();
        if (q.length < 2) return res.json({ users: [], vaults: [], tontines: [], merchants: [] });

        // Chaque catégorie est cloisonnée par SA propre permission de destination, pas
        // uniquement par le contrôle d'accès global ci-dessus (perm_customer_360_basic) : un
        // TELLER a ce dernier mais ni perm_vault_view/perm_tontine_view/perm_merchant_view — sans
        // ce cloisonnement, sa recherche renvoyait quand même des caisses/tontines/marchands, et
        // cliquer dessus menait à un onglet vide (App.tsx bloque le rendu de Vaults/Tontines/
        // Merchants sur ces mêmes permissions), un résultat de recherche fantôme.
        const canVaults = hasPermission(staff, 'perm_vault_view');
        const canTontines = hasPermission(staff, 'perm_tontine_view');
        const canMerchants = hasPermission(staff, 'perm_merchant_view');

        // Les marchands (role=MERCHANT) ont désormais leur propre écran de supervision
        // (Merchants.tsx, soldes ventes/commission séparés) — exclus de "users" pour éviter
        // un doublon (même compte listé deux fois avec deux destinations différentes).
        const [users, vaults, tontines, merchants] = await Promise.all([
            prisma.user.findMany({
                where: { role: { not: 'MERCHANT' }, OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] },
                select: { id: true, name: true, phone: true, role: true },
                take: 5
            }),
            canVaults ? prisma.vault.findMany({
                where: { name: { contains: q, mode: 'insensitive' } },
                select: { id: true, name: true, admin: { select: { name: true } } },
                take: 5
            }) : Promise.resolve([]),
            canTontines ? prisma.tontineGroup.findMany({
                where: { name: { contains: q, mode: 'insensitive' } },
                select: { id: true, name: true, creator: { select: { name: true } } },
                take: 5
            }) : Promise.resolve([]),
            canMerchants ? prisma.user.findMany({
                where: { role: 'MERCHANT', OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] },
                select: { id: true, name: true, phone: true },
                take: 5
            }) : Promise.resolve([])
        ]);

        res.json({ users, vaults, tontines, merchants });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
