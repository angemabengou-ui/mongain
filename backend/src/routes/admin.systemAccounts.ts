import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

// ==========================================
// COMPTES SYSTÈME — VISIBILITÉ + HISTORIQUE
// ==========================================
// Passerelle Externe, Corporate, Coffre Tontine, Trésorerie Centrale : des comptes
// techniques (contreparties de double-écriture) auparavant invisibles dans tout
// l'admin — exclus des listes clients (rôle ADMIN) et de la recherche globale, sans
// écran dédié. Résultat : leur solde apparaissait seulement noyé dans des totaux
// (ex. "Portefeuilles Clients" en Trésorerie), impossible à attribuer à un compte
// précis ni à auditer (qui a fait entrer/sortir quoi). Lecture seule ici ; toute
// correction de solde passe par le circuit Maker/Checker existant de Trésorerie
// (ADJUSTMENT/REVERSAL avec targetWalletId) — jamais un solde éditable directement.
// Extrait de admin.ts (portion "COMPTES SYSTÈME") lors du découpage du monolithe.

router.get('/system-accounts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_treasury_view')) return res.status(403).json({ error: 'Accès refusé.' });

        const [systemAccounts, centralTreasury] = await Promise.all([
            prisma.systemAccount.findMany({
                include: { wallet: { select: { id: true, balance: true } } },
                orderBy: { createdAt: 'asc' }
            }),
            getCentralTreasury()
        ]);

        const accounts = [
            {
                id: `treasury:${centralTreasury.id}`,
                walletId: centralTreasury.walletId,
                name: centralTreasury.name,
                balance: centralTreasury.wallet.balance,
                kind: 'CENTRAL_TREASURY'
            },
            ...systemAccounts.map(a => ({
                id: `system:${a.id}`,
                walletId: a.wallet.id,
                name: a.name,
                balance: a.wallet.balance,
                kind: a.kind,
                createdAt: a.createdAt
            }))
        ];

        res.json({ accounts });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/system-accounts/:walletId/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_treasury_view')) return res.status(403).json({ error: 'Accès refusé.' });

        const walletId = req.params.walletId as string;
        const transactions = await prisma.transaction.findMany({
            where: { OR: [{ senderWalletId: walletId }, { receiverWalletId: walletId }] },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } }, systemAccount: { select: { name: true } }, branch: { select: { name: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } }, systemAccount: { select: { name: true } }, branch: { select: { name: true } } } }
            }
        });

        res.json({ transactions });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
