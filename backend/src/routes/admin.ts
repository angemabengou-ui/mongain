import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { hasPermission } from '../services/RBAC';
import { sendSms } from '../services/sms';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';
import { withCache } from '../utils/redis';

const router = express.Router();

// AuditLog.adminId est une rÃ©fÃ©rence libre (pas de FK) : l'acteur peut Ãªtre un Staff
// (portail corporate) ou un User (rÃ´le ADMIN historique). Impossible de rÃ©soudre son nom/
// tÃ©lÃ©phone/rÃ´le via une relation Prisma unique, donc on le fait manuellement des deux cÃ´tÃ©s.
async function attachAuditActors<T extends { adminId: string }>(logs: T[]) {
    const actorIds = [...new Set(logs.map(l => l.adminId))];
    if (actorIds.length === 0) return logs.map(l => ({ ...l, admin: null as { name: string; phone: string | null; role: string } | null }));
    const [staffActors, userActors] = await Promise.all([
        prisma.staff.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, phone: true, role: true } }),
        prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, phone: true, role: true } })
    ]);
    const actorMap = new Map([...staffActors, ...userActors].map(a => [a.id, { name: a.name, phone: a.phone, role: a.role }]));
    return logs.map(l => ({ ...l, admin: actorMap.get(l.adminId) || null }));
}

// KYC/AML : SUPER_ADMIN + les deux rÃ´les explicitement dÃ©diÃ©s Ã  la conformitÃ©, cohÃ©rent
// avec ce que montre dÃ©jÃ  le portail admin-web (module "Dossiers KYC/AML").
const KYC_ROLES = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'];

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!user || !hasPermission(user, 'perm_analytics_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const totalUsers = await prisma.user.count({ where: { role: 'USER', isActive: true } });
        const agentsCount = await prisma.user.count({ where: { role: 'AGENT', isActive: true } });
        const merchantsCount = await prisma.user.count({ where: { role: 'MERCHANT', isActive: true } });

        // Compte Corporate : source du KPI `revenue` ci-dessous.
        const company = await getSystemAccount('CORPORATE');

        const circulatingWallets = await prisma.wallet.aggregate({
            where: { user: { role: { notIn: ['ADMIN'] } } },
            _sum: { balance: true }
        });
        // Depuis la sÃ©paration TrÃ©sorerie Centrale / SiÃ¨ge : plus un solde d'agence.
        const centralTreasury = await getCentralTreasury();
        const reserveBalance = centralTreasury.wallet.balance;

        // `company` (compte corporate) Ã©tait rÃ©cupÃ©rÃ© ci-dessus mais jamais lu â€” supprimÃ©.
        // `select` scopÃ© ici : seuls `amount` et le rÃ´le du destinataire servent (voir la
        // boucle plus bas) ; la requÃªte entiÃ¨re rapatriait auparavant chaque User complet
        // (photos KYC comprises) pour tout l'historique FUND_AGENT- depuis le lancement, Ã 
        // chaque ouverture du tableau de bord admin.
        const fundTxs = await prisma.transaction.findMany({
            where: { reference: { startsWith: 'FUND_AGENT-' }, status: 'COMPLETED' },
            select: { amount: true, receiverWallet: { select: { user: { select: { role: true } } } } }
        });

        // The total money minted into circulation is all MINT- transactions (into the vault)
        const pureMintTxs = await prisma.transaction.aggregate({
            where: { reference: { startsWith: 'MINT-' }, status: 'COMPLETED' },
            _sum: { amount: true }
        });

        let totalMinted = pureMintTxs._sum.amount || 0;
        let mintedToAgents = 0;
        let mintedToMerchants = 0;
        let mintedToClients = 0;

        fundTxs.forEach(tx => {
            if (tx.receiverWallet?.user?.role === 'AGENT') mintedToAgents += tx.amount;
            else if (tx.receiverWallet?.user?.role === 'MERCHANT') mintedToMerchants += tx.amount;
            else if (tx.receiverWallet?.user?.role === 'USER') mintedToClients += tx.amount;
        });

        const pureVolume = await prisma.transaction.aggregate({
            where: {
                status: 'COMPLETED',
                NOT: {
                    OR: [
                        { reference: { startsWith: 'MINT-' } },
                        { reference: { startsWith: 'FUND_AGENT-' } },
                        { reference: { startsWith: 'FEE-' } }
                    ]
                }
            },
            _sum: { amount: true }
        });
        const totalVolume = pureVolume._sum.amount || 0;

        res.json({
            totalUsers,
            agentsCount,
            merchantsCount,
            totalVolume,
            revenue: company?.wallet?.balance || 0,
            reserve: reserveBalance,
            totalCirculating: circulatingWallets._sum.balance || 0,
            totalMinted,
            mintedToAgents,
            mintedToMerchants,
            mintedToClients
        });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// ============================================================
// PROMPT 10 ? GESTION OP?RATIONNELLE DES AGENCES
// ============================================================

const AGENCY_ADMIN_ROLES = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'];
const AGENCY_OPS_ROLES = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'BRANCH_MANAGER'];

// Helper: r?sout le branchId autoris? (BM limit? au sien, HQ voit tout)
const resolveAgencyScope = async (userId: string, requestedId?: string): Promise<{ branchId: string | null; error?: string }> => {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
    if (!staff) return { branchId: null, error: 'Utilisateur introuvable.' };
    if (staff.role === 'BRANCH_MANAGER' && staff.branchId) {
        if (requestedId && requestedId !== staff.branchId) return { branchId: null, error: 'AccÃ¨s restreint Ã  votre agence.' };
        return { branchId: staff.branchId };
    }
    if (hasPermission(staff, 'perm_branch_manage')) return { branchId: requestedId || null };
    return { branchId: null, error: 'RÃ´le non autorisÃ©.' };
};

// -- 1. Liste agences (pagin?e + filtres) ---------------------
router.get('/branches', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_branch_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        // BRANCH_MANAGER ne voit que son agence
        if (staff.role === 'BRANCH_MANAGER' && staff.branchId) {
            const branch = await prisma.branch.findUnique({
                where: { id: staff.branchId },
                include: { manager: { select: { name: true } }, _count: { select: { staff: true, sessions: true } } }
            });
            return res.json([branch]);
        }

        const { status, city, region, search, page = '1', limit = '50' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const where: any = {};
        if (status) where.status = status as string;
        if (city) where.city = { contains: city as string, mode: 'insensitive' };
        if (region) where.region = { contains: region as string, mode: 'insensitive' };
        if (search) {
            where.OR = [
                { id: { startsWith: search as string } },
                { code: { contains: search as string, mode: 'insensitive' } },
                { name: { contains: search as string, mode: 'insensitive' } },
                { city: { contains: search as string, mode: 'insensitive' } },
                { manager: { name: { contains: search as string, mode: 'insensitive' } } },
            ];
        }

        const [branches, total] = await Promise.all([
            prisma.branch.findMany({
                where,
                include: { manager: { select: { name: true } }, _count: { select: { staff: true, sessions: true } }, wallet: { select: { balance: true } } },
                orderBy: [{ isHQ: 'desc' }, { createdAt: 'desc' }],
                skip, take: parseInt(limit as string)
            }),
            prisma.branch.count({ where })
        ]);

        res.json({ branches, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 2. Cr?er une agence --------------------------------------
router.post('/branches', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_branch_manage')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { name, code, address, city, region, phone, managerId, status, isHQ } = req.body;
        if (!name || !code) return res.status(400).json({ error: 'Nom et code requis.' });

        // V?rification unicit? code
        const existing = await prisma.branch.findUnique({ where: { code } });
        if (existing) return res.status(409).json({ error: `Code agence "${code}" dÃ©jÃ  utilisÃ©.` });

        const agencyWallet = await prisma.wallet.create({ data: { balance: 0 } });

        const newBranch = await prisma.branch.create({
            data: { name, code, address, city, region, phone, status: status || 'DRAFT', isHQ: isHQ || false, walletId: agencyWallet.id, managerId: managerId || null }
        });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'CREATE_BRANCH', details: `CrÃ©ation agence ${code} (${name}) Â· Ville: ${city} Â· Statut: ${status || 'DRAFT'}` }
        });

        res.status(201).json({ success: true, branch: newBranch });
    } catch (e: any) {
        if ((e as any).code === 'P2002') return res.status(409).json({ error: 'Nom ou code agence dÃ©jÃ  utilisÃ©.' });
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- 3. Modifier/Suspendre l'agence ----------------------------
router.patch('/branches/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_branch_manage')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const branchId = req.params.id as string;
        const { status, managerId, name, address, city, region, phone, code } = req.body;

        // Code-immutability guard: si des transactions existent li?es ? cette agence, le code ne peut pas changer
        if (code) {
            const branch = await prisma.branch.findUnique({ where: { id: branchId } });
            if (branch && code !== branch.code) {
                const txCount = await prisma.transaction.count({ where: { branchId } });
                if (txCount > 0) return res.status(400).json({ error: `Code agence immuable : ${txCount} transaction(s) historiques sont rÃ©fÃ©rencÃ©es. Utilisez un workflow sÃ©curisÃ©.` });
            }
        }

        const data: any = {};
        if (name !== undefined) data.name = name;
        if (address !== undefined) data.address = address;
        if (city !== undefined) data.city = city;
        if (region !== undefined) data.region = region;
        if (phone !== undefined) data.phone = phone;
        if (managerId !== undefined) data.managerId = managerId || null;
        if (status !== undefined) { data.status = status; if (status === 'ACTIVE') data.activatedAt = new Date(); }
        if (code !== undefined) data.code = code;

        const updated = await prisma.branch.update({ where: { id: branchId }, data });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'UPDATE_BRANCH', details: `Agence ${updated.code}: statut: ${status || '-'} Â· managerId: ${managerId || '-'}` }
        });

        res.json({ success: true, branch: updated });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 4. Agency 360 ? Overview complet ------------------------
router.get('/branches/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const branch = await prisma.branch.findUnique({
            where: { id: String(req.params.id) as string },
            include: {
                manager: { select: { id: true, name: true, email: true, role: true, status: true } },
                wallet: { select: { balance: true } },
                _count: { select: { staff: true, sessions: true } }
            }
        });
        if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });

        // Stats du jour
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const [cashInToday, cashOutToday, activeSessions, discrepancies] = await Promise.all([
            prisma.transaction.aggregate({ where: { branchId: branch.id, type: 'CASH_IN', createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.transaction.aggregate({ where: { branchId: branch.id, type: 'CASH_OUT', createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.cashSession.count({ where: { branchId: branch.id, status: 'OPEN' } }),
            prisma.cashSession.count({ where: { branchId: branch.id, discrepancy: { not: 0 } } }),
        ]);

        res.json({
            ...branch,
            stats: {
                cashInToday: cashInToday._sum.amount || 0,
                cashInCount: cashInToday._count.id,
                cashOutToday: cashOutToday._sum.amount || 0,
                cashOutCount: cashOutToday._count.id,
                volumeToday: (cashInToday._sum.amount || 0) + (cashOutToday._sum.amount || 0),
                activeSessions,
                discrepancies,
            }
        });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 5. Staff de l'agence -------------------------------------
router.get('/branches/:id/staff', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const staff = await prisma.staff.findMany({
            where: { branchId: req.params.id as string },
            select: { id: true, name: true, email: true, matricule: true, role: true, status: true, createdAt: true, updatedAt: true },
            orderBy: [{ role: 'asc' }, { name: 'asc' }]
        });
        res.json(staff);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 6. Assigner un staff ? une agence ------------------------
router.post('/branches/:id/staff/:staffId/assign', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_branch_manage')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const target = await prisma.staff.findUnique({ where: { id: req.params.staffId as string } });
        if (!target) return res.status(404).json({ error: 'Staff introuvable.' });

        const updated = await prisma.staff.update({
            where: { id: req.params.staffId as string },
            data: { branchId: req.params.id as string }
        });

        await prisma.auditLog.create({ data: { adminId: admin.id, action: 'ASSIGN_STAFF', details: `${target.name} (${target.role}) assignÃ© Ã  l'agence ${req.params.id}` } });
        res.json({ success: true, staff: updated });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 7. D?sassigner un staff d'une agence ---------------------
router.delete('/branches/:id/staff/:staffId/unassign', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_branch_manage')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const target = await prisma.staff.findUnique({ where: { id: req.params.staffId as string } });
        if (!target || target.branchId !== req.params.id) return res.status(400).json({ error: 'Staff non assignÃ© Ã  cette agence.' });

        // Ne pas d?sassigner si session ouverte
        const openSession = await prisma.cashSession.findFirst({ where: { tellerId: target.id, status: 'OPEN' } });
        if (openSession) return res.status(400).json({ error: 'Ce caissier a une session ouverte. ClÃ´turer la session avant dÃ©saffectation.' });

        await prisma.staff.update({ where: { id: req.params.staffId as string }, data: { branchId: null } });

        await prisma.auditLog.create({ data: { adminId: admin.id, action: 'UNASSIGN_STAFF', details: `${target.name} dÃ©saffectÃ© de l'agence ${req.params.id}` } });
        res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 8. Tellers de l'agence (avec session active) -------------
router.get('/branches/:id/tellers', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const tellers = await prisma.staff.findMany({
            where: { branchId: req.params.id as string, role: 'TELLER' },
            select: { id: true, name: true, matricule: true, status: true, updatedAt: true, cashSessions: { where: { status: 'OPEN' }, select: { id: true, openedAt: true, initialCash: true, totalCashInValue: true, totalCashOutValue: true }, take: 1 } },
            orderBy: { name: 'asc' }
        });

        res.json(tellers.map(t => ({ ...t, activeSession: t.cashSessions[0] ?? null })));
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 9. Sessions (HQ view, pagin?e) ---------------------------
router.get('/branches/:id/sessions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const { status, page = '1', limit = '30' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const where: any = { branchId: req.params.id as string };
        if (status) where.status = status as string;

        const [sessions, total] = await Promise.all([
            prisma.cashSession.findMany({
                where, orderBy: { openedAt: 'desc' }, skip, take: parseInt(limit as string),
                include: { teller: { select: { name: true, matricule: true } } }
            }),
            prisma.cashSession.count({ where })
        ]);

        res.json({ sessions, total });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 10. Op?rations Cash (pagin?e + filtres) ------------------
router.get('/branches/:id/cash-operations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const { type, tellerId, minAmount, maxAmount, dateFrom, dateTo, status, search, page = '1', limit = '50' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const where: any = { branchId: req.params.id as string };
        if (type) where.type = type as string;
        if (status) where.status = status as string;
        if (tellerId) where.tellerId = tellerId as string;
        if (minAmount) where.amount = { ...where.amount, gte: parseFloat(minAmount as string) };
        if (maxAmount) where.amount = { ...where.amount, lte: parseFloat(maxAmount as string) };
        if (dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(dateFrom as string) };
        if (dateTo) where.createdAt = { ...where.createdAt, lte: new Date(dateTo as string) };
        if (search) where.reference = { contains: search as string, mode: 'insensitive' };

        const [ops, total] = await Promise.all([
            prisma.transaction.findMany({
                where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit as string),
                include: {
                    senderWallet: { include: { user: { select: { name: true, phone: true } }, branch: { select: { name: true } } } },
                    receiverWallet: { include: { user: { select: { name: true, phone: true } }, branch: { select: { name: true } } } },
                }
            }),
            prisma.transaction.count({ where })
        ]);

        res.json({ operations: ops, total, page: parseInt(page as string) });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 11. D?tail op?ration -------------------------------------
router.get('/branches/:id/cash-operations/:txId', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const tx = await prisma.transaction.findUnique({
            where: { id: req.params.txId as string },
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } }, branch: { select: { name: true, code: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } }, branch: { select: { name: true, code: true } } } },
            }
        });
        if (!tx || tx.branchId !== req.params.id) return res.status(404).json({ error: 'OpÃ©ration introuvable pour cette agence.' });
        res.json(tx);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 12. Coffre / Vault ----------------------------------------
router.get('/branches/:id/vault', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const branch = await prisma.branch.findUnique({
            where: { id: String(req.params.id) as string },
            include: { wallet: { select: { id: true, balance: true, updatedAt: true } } }
        });
        if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });

        // 10 derniers mouvements
        const lastOps = await prisma.transaction.findMany({
            where: { branchId: branch.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { id: true, type: true, amount: true, fee: true, reference: true, createdAt: true, status: true }
        });

        res.json({
            branchId: branch.id,
            branchName: branch.name,
            branchCode: branch.code,
            physicalCash: branch.balance,
            electronicBalance: branch.wallet?.balance ?? 0,
            status: branch.status,
            lastOperations: lastOps
        });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 13. Rapprochement quotidien -------------------------------
router.get('/branches/:id/reconciliation', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const { date } = req.query;
        const day = date ? new Date(date as string) : new Date();
        day.setHours(0, 0, 0, 0);
        const dayEnd = new Date(day); dayEnd.setHours(23, 59, 59, 999);

        const branch = await prisma.branch.findUnique({ where: { id: String(req.params.id) as string }, include: { wallet: { select: { balance: true } } } });
        if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });

        // Sessions du jour
        const sessions = await prisma.cashSession.findMany({
            where: { branchId: branch.id, openedAt: { gte: day, lte: dayEnd } },
            include: { teller: { select: { name: true } } },
            orderBy: { openedAt: 'asc' }
        });

        const totalCashIn = sessions.reduce((s, x) => s + x.totalCashInValue, 0);
        const totalCashOut = sessions.reduce((s, x) => s + x.totalCashOutValue, 0);
        const openingBalance = sessions.length > 0 ? sessions[0].initialCash : branch.balance;
        const expectedBalance = openingBalance + totalCashIn - totalCashOut;
        const physicalBalance = branch.balance;
        const variance = physicalBalance - expectedBalance;

        // Sessions avec ?cart
        const sessionDiscrepancies = sessions.filter(s => (s.discrepancy ?? 0) !== 0);

        res.json({
            date: day.toISOString().split('T')[0],
            branchId: branch.id,
            branchName: branch.name,
            openingBalance,
            totalCashIn,
            totalCashOut,
            expectedBalance,
            physicalBalance,
            variance,
            varianceStatus: Math.abs(variance) < 1 ? 'OK' : 'DISCREPANCY',
            sessions,
            sessionDiscrepancies,
        });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 14. Alertes automatiques ----------------------------------
router.get('/branches/:id/alerts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const scope = await resolveAgencyScope(req.userId!, req.params.id as string);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const settings = await prisma.systemSettings.findFirst();
        const branch = await prisma.branch.findUnique({
            where: { id: String(req.params.id) as string },
            include: { wallet: { select: { balance: true } } }
        });
        if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });

        const alerts: { type: string; severity: string; message: string }[] = [];

        // Agence suspendue
        if (branch.status === 'SUSPENDED') alerts.push({ type: 'SUSPENDED', severity: 'CRITICAL', message: `L'agence ${branch.name} est SUSPENDUE. Aucune opÃ©ration financiÃ¨re autorisÃ©e.` });

        // Liquidit? physique faible (seuil: agencyWithdrawThreshold)
        const lowLiquidityThreshold = (settings?.agencyWithdrawThreshold ?? 500000) * 0.1;
        if (branch.balance < lowLiquidityThreshold) alerts.push({ type: 'LOW_LIQUIDITY', severity: branch.balance <= 0 ? 'CRITICAL' : 'HIGH', message: `LiquiditÃ© physique faible : ${branch.balance.toLocaleString()} FCFA (seuil alerte : ${lowLiquidityThreshold.toLocaleString()})` });

        // Discrepancies non r?solues
        const discrepancyCount = await prisma.cashSession.count({ where: { branchId: branch.id, discrepancy: { not: 0 }, status: 'CLOSED' } });
        if (discrepancyCount > 0) alerts.push({ type: 'CASH_DISCREPANCY', severity: 'HIGH', message: `${discrepancyCount} session(s) avec Ã©cart de caisse non rÃ©solu(es).` });

        // Sessions ouvertes depuis plus de 12h
        const staleSessions = await prisma.cashSession.count({ where: { branchId: branch.id, status: 'OPEN', openedAt: { lte: new Date(Date.now() - 12 * 3600 * 1000) } } });
        if (staleSessions > 0) alerts.push({ type: 'STALE_SESSION', severity: 'MEDIUM', message: `${staleSessions} session(s) de caisse ouverte depuis plus de 12h.` });

        res.json({ branchId: branch.id, alerts });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// -- 15. Liste staff non assign? (pour dropdown assign) -------
router.get('/staff/unassigned', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_branch_manage')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const staff = await prisma.staff.findMany({
            where: { branchId: null, role: { in: ['TELLER', 'BRANCH_MANAGER'] }, status: 'ACTIVE' },
            select: { id: true, name: true, matricule: true, role: true, email: true },
            orderBy: { name: 'asc' }
        });
        res.json(staff);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// [Deprecated] L'allocation directe vers les agences a ?t? migr?e vers /api/treasury/requests


// ============================================================
// SUPPORT & R?CLAMATIONS DESK (PROMPT 04 + 09)
// ============================================================

const hasSupportAccess = (role: string) => ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER'].includes(role);


// 5. Cr?er une R?clamation (Par un Staff Maker/Customer 360)
router.post('/users/:id/reclamation', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!user || !hasSupportAccess(user.role)) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id; // User ID
        const customer = await prisma.user.findUnique({ where: { id: customerId as string } });
        if (!customer) return res.status(404).json({ error: 'Client introuvable.' });

        const { title, description, category, priority, transactionId, branchId } = req.body;
        if (!title || !description) return res.status(400).json({ error: 'Titre et description requis.' });

        const newRec = await prisma.reclamation.create({
            data: {
                userId: customer.id,
                title,
                description,
                category: category || 'OTHER',
                priority: priority || 'NORMAL',
                transactionId: transactionId || null,
                branchId: branchId || null
            }
        });

        await prisma.auditLog.create({
            data: { adminId: user.id, action: 'CREATE_TICKET', details: `CrÃ©ation Ticket ${newRec.id} pour le client ${customer.phone}` }
        });

        res.json({ success: true, reclamation: newRec });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});
// =========================================================================

// [Deprecated] Les fonctions POST /mint et POST /fund-agent ont ?t? migr?es vers le routeur Maker/Checker /api/treasury/requests

// GET /api/admin/users
router.get('/users', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const role = req.query.role as string;
        const users = await prisma.user.findMany({
            where: role ? { role } : undefined,
            select: {
                id: true,
                name: true,
                phone: true,
                username: true,
                email: true,
                role: true,
                isActive: true,
                kycStatus: true,
                failedPinAttempts: true,
                createdAt: true,
                wallet: { select: { balance: true, currency: true } }
            },

            orderBy: { createdAt: 'desc' }
        });

        res.json(users);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// POST /api/admin/users/create-pro
router.post('/users/create-pro', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!user || user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const schema = z.object({
            phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
            name: z.string().min(2),
            role: z.enum(['AGENT', 'MERCHANT', 'ADMIN']),
            pin: z.string().min(4),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'DonnÃ©es invalides.' });

        const { phone, name, role, pin } = parsed.data;

        const existing = await prisma.user.findUnique({ where: { phone } });
        if (existing) return res.status(400).json({ error: 'Ce numÃ©ro de tÃ©lÃ©phone est dÃ©jÃ  pris.' });

        const hashedPin = await bcrypt.hash(pin, 10);
        const newUser = await prisma.user.create({
            data: {
                phone,
                name,
                pin: hashedPin,
                role,
                wallet: { create: { balance: 0, currency: 'FCFA' } }
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: user.id,
                action: 'CREATE_PRO_USER',
                details: `CrÃ©ation du compte PRO ${role} pour ${phone}`,
            }
        });

        res.json({ message: 'Compte Pro crÃ©Ã© avec succÃ¨s.', user: { id: newUser.id, name, phone, role } });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/admin/users/:id/toggle-status
router.post('/users/:id/toggle-status', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const targetUser = await prisma.user.findUnique({ where: { id: String(req.params.id) as string } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur non trouvÃ©' });
        if (targetUser.role === 'ADMIN') return res.status(400).json({ error: 'Impossible de dÃ©sactiver un Administrateur Supremo.' });

        const updated = await prisma.user.update({
            where: { id: targetUser.id },
            data: { isActive: !targetUser.isActive }
        });

        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'TOGGLE_STATUS',
                details: `Le compte ${targetUser.phone} a Ã©tÃ© passÃ© en statut ${updated.isActive ? 'ACTIF' : 'SUSPENDU'}`,
            }
        });

        res.json({ message: `Le compte est dÃ©sormais ${updated.isActive ? 'ACTIF' : 'SUSPENDU'}.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PUT /api/admin/users/:id
router.put('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const schema = z.object({
            name: z.string().min(2),
            phone: z.string().transform(val => val.replace(/\s+/g, '').replace(/^\+2410/, '+241')),
            username: z.string().optional(),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'DonnÃ©es invalides' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (targetUser.role === 'ADMIN' && admin.id !== targetUser.id) {
            return res.status(403).json({ error: 'Impossible de modifier un autre Administrateur.' });
        }

        const { name, phone, username } = parsed.data;

        // Check uniqueness if changing
        if (phone !== targetUser.phone) {
            const exists = await prisma.user.findUnique({ where: { phone } });
            if (exists) return res.status(400).json({ error: 'Ce numÃ©ro est dÃ©jÃ  utilisÃ©.' });
        }
        if (username && username !== targetUser.username) {
            const exists = await prisma.user.findUnique({ where: { username } });
            if (exists) return res.status(400).json({ error: 'Ce pseudo est dÃ©jÃ  utilisÃ©.' });
        }

        const updated = await prisma.user.update({
            where: { id: targetId },
            data: { name, phone, username: username || null }
        });

        res.json({ message: 'Profil mis Ã  jour avec succÃ¨s.', user: { id: updated.id, name: updated.name, phone: updated.phone } });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// PUT /api/admin/users/:id/branch â€” rattache (ou dÃ©tache) un compte Agent Ã  une agence.
// Sans ce rattachement, un agent n'a aucun lien avec le rÃ©seau d'agences et ses opÃ©rations
// (dÃ©pÃ´ts/retraits guichet via l'app mobile) restent invisibles des rapports d'agence.
router.put('/users/:id/branch', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const schema = z.object({ branchId: z.string().nullable() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'DonnÃ©es invalides.' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });
        if (targetUser.role !== 'AGENT') return res.status(400).json({ error: 'Seuls les comptes Agent peuvent Ãªtre rattachÃ©s Ã  une agence.' });

        if (parsed.data.branchId) {
            const branch = await prisma.branch.findUnique({ where: { id: parsed.data.branchId } });
            if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });
        }

        const updated = await prisma.user.update({
            where: { id: targetId },
            data: { branchId: parsed.data.branchId }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'ASSIGN_AGENT_BRANCH', details: `Agent ${targetUser.phone} rattachÃ© Ã  l'agence ${parsed.data.branchId || 'AUCUNE'}.` }
        });

        res.json({ message: 'Rattachement mis Ã  jour.', user: { id: updated.id, branchId: updated.branchId } });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/admin/logs
router.get('/logs', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_audit_log_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const logs = await prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 100 // On limite aux 100 derniers logs
        });

        res.json(await attachAuditActors(logs));
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/admin/v6/health - System Telemetry for SystemMonitor.tsx
router.get('/v6/health', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !hasPermission(admin, 'perm_analytics_view')) {
            return res.status(403).json({ error: 'Accès refusé. Nécessite perm_analytics_view.' });
        }

        let redisStats = { status: 'offline', hitRate: '0%', operations: 0 };
        if (require('../utils/redis').default.status === 'ready') {
            const redis = require('../utils/redis').default;
            const hits = parseInt((await redis.get('stats:redis:hits')) || '0', 10);
            const misses = parseInt((await redis.get('stats:redis:misses')) || '0', 10);
            const total = hits + misses;
            redisStats = {
                status: 'online',
                hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '100%',
                operations: total
            };
        }

        const mem = process.memoryUsage();
        const uptime = process.uptime();
        const d = Math.floor(uptime / (3600 * 24));
        const h = Math.floor(uptime % (3600 * 24) / 3600);
        const m = Math.floor(uptime % 3600 / 60);

        res.json({
            redis: redisStats,
            server: {
                uptime: `${d}d ${h}h ${m}m`,
                memory: `${Math.round(mem.rss / 1024 / 1024)} MB (RSS)`,
                cpu: 'See Render Dashboard'
            },
            errors: [
                { time: new Date().toLocaleTimeString(), type: 'En Attente Sentry', count: 0 }
            ]
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/admin/ledger
router.get('/ledger', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : cette route vÃ©rifiait `perm_system_settings_view` â€” sans rapport avec
        // le Grand Livre â€” au lieu de `perm_transaction_view`, la permission sur laquelle
        // App.tsx/Ledger.tsx gatent rÃ©ellement l'onglet cÃ´tÃ© UI. Seuls SUPER_ADMIN/ADMIN
        // possÃ¨dent la permission settings par dÃ©faut, donc BRANCH_MANAGER/TELLER/RISK/
        // SUPPORT_MAKER (qui ont bien perm_transaction_view) recevaient un 403 malgrÃ© un
        // accÃ¨s lÃ©gitime â€” et comme Dashboard.tsx enchaÃ®ne cet appel dans le MÃŠME try/catch
        // que /admin/stats, l'Ã©chec faisait disparaÃ®tre tout le tableau de bord, KPIs inclus.
        if (!admin || !hasPermission(admin, 'perm_transaction_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        // Les courbes 7j/14j et le Grand Livre (admin-web Dashboard.tsx, MacroStats.tsx,
        // Ledger.tsx) agrÃ¨gent/filtrent TOUT cÃ´tÃ© client sur ce mÃªme jeu de rÃ©sultats. Ã€
        // `take: 200`, une agence Ã  fort volume peut Ã©puiser les 200 lignes en quelques
        // heures â€” les jours prÃ©cÃ©dents retombent alors silencieusement Ã  zÃ©ro dans les
        // graphiques, et la recherche du Grand Livre ne porte que sur ces mÃªmes 200 lignes.
        // 2000 rÃ©duit fortement le risque sans le rÃ©soudre en thÃ©orie ; une vraie solution
        // nÃ©cessiterait une agrÃ©gation par plage de dates cÃ´tÃ© serveur plutÃ´t qu'une simple
        // liste tronquÃ©e â€” hors pÃ©rimÃ¨tre de ce correctif.
        const txs = await withCache('ledger:all', 30, async () => {
            return await prisma.transaction.findMany({
                orderBy: { createdAt: 'desc' },
                take: 2000,
                include: {
                    senderWallet: { include: { user: { select: { id: true, name: true, phone: true, role: true } }, systemAccount: { select: { name: true } }, branch: { select: { name: true } }, centralTreasury: true } },
                    receiverWallet: { include: { user: { select: { id: true, name: true, phone: true, role: true } }, systemAccount: { select: { name: true } }, branch: { select: { name: true } }, centralTreasury: true } },
                }
            });
        });

        res.json(txs);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId }, include: { wallet: true } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        if (targetUser.role === 'ADMIN' && admin.id !== targetUser.id) {
            return res.status(403).json({ error: 'Impossible de supprimer un autre Administrateur.' });
        }

        // Soft delete logic to preserve financial logs
        const scrambledPhone = `DEL_${targetId.substring(0, 8)}_${targetUser.phone}`;
        const scrambledUsername = targetUser.username ? `DEL_${targetId.substring(0, 8)}_${targetUser.username}` : null;
        const scrambledEmail = targetUser.email ? `DEL_${targetId.substring(0, 8)}_${targetUser.email}` : null;

        await prisma.user.update({
            where: { id: targetId },
            data: {
                phone: scrambledPhone,
                username: scrambledUsername,
                email: scrambledEmail,
                isActive: false,
                name: `[SUPPRIMÃ‰] ${targetUser.name}`
            }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'DELETE_USER', details: `ClÃ´ture dÃ©finitive du compte ${targetUser.phone}` }
        });

        res.json({ success: true, message: 'Utilisateur supprimÃ© avec succÃ¨s.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// La route POST /transactions/:id/refund (remboursement exÃ©cutÃ© unilatÃ©ralement par un
// seul SUPER_ADMIN) a Ã©tÃ© retirÃ©e : elle contournait le flux Maker/Checker dÃ©jÃ  en place
// via /refund-requests (create â†’ approve â†’ execute, voir plus bas dans ce fichier), qui
// impose qu'un second agent distinct valide l'opÃ©ration. Toute demande de remboursement
// doit dÃ©sormais passer par ce flux.

// --- V4: Mod?ration KYC ---
router.get('/users/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // Consulter la file (et les photos) est une action distincte d'approuver/rejeter â€”
        // `perm_customer_kyc_view` couvre la premiÃ¨re (TELLER/RISK/SUPPORT_MAKER, ex. vÃ©rifier
        // une piÃ¨ce au guichet), `perm_customer_kyc_validate` reste seule Ã  autoriser le PUT
        // ci-dessous. VÃ©rifier uniquement `validate` ici bloquait tous les rÃ´les voir-seul.
        if (!admin || !(hasPermission(admin, 'perm_customer_kyc_view') || hasPermission(admin, 'perm_customer_kyc_validate'))) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const filter = req.query.status as string || 'PENDING';
        const pendingList = await (prisma.user as any).findMany({
            where: { kycStatus: filter },
            select: { id: true, name: true, phone: true, kycStatus: true, idCardFront: true, idCardBack: true, selfie: true, createdAt: true, kycVendorProvider: true, kycVendorStatus: true, kycVendorCheckedAt: true }
        });

        res.json(pendingList);
    } catch (e: any) {
        res.status(500).json({ error: 'Erreur rÃ©seau (KYC List)' });
    }
});

const vipLimitSchema = z.object({
    limitType: z.enum(['customDailyLimit', 'customMonthlyLimit', 'customPerTxLimit']),
    limit: z.number().int().min(100).max(10000000),
    expiresAt: z.string().optional()
});

router.put('/users/:id/vip-limit', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // Plafond VIP : action Ã  fort impact financier, rÃ©servÃ©e strictement Ã  SUPER_ADMIN.
        if (!admin || admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const parsed = vipLimitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Plafond invalide.' });

        const targetUser = await prisma.user.findUnique({ where: { id: String(req.params.id) as string } });
        if (!targetUser) return res.status(404).json({ error: 'Introuvable' });

        // Ã‰crit dans le bon champ granulaire (journalier/mensuel/par-transaction) â€” ce
        // endpoint Ã©crivait auparavant la valeur brute en FCFA dans kycLevel (censÃ© Ãªtre
        // un simple palier 0/1/2), ce qui basculait silencieusement le client en Tier 2
        // gÃ©nÃ©rique au lieu d'appliquer le plafond demandÃ©.
        await prisma.user.update({
            where: { id: targetUser.id },
            data: {
                [parsed.data.limitType]: parsed.data.limit,
                customLimitExpiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
            }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'VIP_LIMIT_SET', details: `${parsed.data.limitType} = ${parsed.data.limit} FCFA (application immÃ©diate, sans Checker) pour ${targetUser.phone}` }
        });

        res.json({ message: 'Plafond VIP appliquÃ© avec succÃ¨s.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const kycReviewSchema = z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    reason: z.string().optional(),
}).refine(d => d.status !== 'REJECTED' || (d.reason && d.reason.trim().length >= 3), {
    message: 'Un motif est obligatoire pour rejeter un dossier KYC.',
    path: ['reason'],
});

router.put('/users/:id/kyc', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_customer_kyc_validate')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const parsed = kycReviewSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

        const targetId = req.params.id as string;
        const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
        if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable.' });

        const newLevel = parsed.data.status === 'APPROVED' ? 1 : 0;
        const reason = parsed.data.status === 'REJECTED' ? (parsed.data.reason || null) : null;

        await (prisma.user as any).update({
            where: { id: targetId },
            data: { kycStatus: parsed.data.status, kycLevel: newLevel, kycRejectReason: reason }
        });

        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: `KYC_${parsed.data.status}`,
                details: `KYC for ${targetUser.phone} set to ${parsed.data.status}` + (reason ? `. Motif: ${reason}` : '')
            }
        });

        await prisma.notification.create({
            data: parsed.data.status === 'APPROVED'
                ? { userId: targetId, title: 'VÃ©rification approuvÃ©e âœ…', body: 'Votre dossier de vÃ©rification d\'identitÃ© a Ã©tÃ© approuvÃ©. Vos limites de compte ont Ã©tÃ© mises Ã  jour.', type: 'SYSTEM' }
                : { userId: targetId, title: 'VÃ©rification rejetÃ©e', body: `Votre dossier de vÃ©rification d'identitÃ© a Ã©tÃ© rejetÃ©. Motif : ${reason}`, type: 'SYSTEM' }
        });

        res.json({ message: 'Dossier KYC traitÃ© avec succÃ¨s.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// V6 ERP: FLOAT MANAGEMENT (BRANCHES)
// ==========================================


router.post('/branches/:id/fund', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // Only SuperAdmin or Risk can inject physical Liquidity
        if (!admin || !hasPermission(admin, 'perm_audit_log_view')) {
            return res.status(403).json({ error: 'Autorisation "Injection de LiquiditÃ©" requise.' });
        }

        // Comme treasury.ts : le Circuit Breaker bloque les mouvements de fonds mais pas
        // le reste de /api/admin (staff, KYC, tableaux de bord), donc pas de gating au
        // niveau du routeur â€” sinon un verrouillage d'urgence empÃªcherait aussi les admins
        // d'opÃ©rer le reste de la plateforme pour, justement, gÃ©rer l'incident.
        const settings = await prisma.systemSettings.findFirst();
        if (settings?.circuitBreaker) {
            return res.status(403).json({ error: 'Le Circuit Breaker est activÃ©. OpÃ©rations financiÃ¨res bloquÃ©es.' });
        }

        const branchId = req.params.id as string;
        const schema = z.object({ amount: z.number().int().positive() });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Montant invalide.' });
        const amount = parsed.data.amount;

        const branch = await prisma.branch.findUnique({ where: { id: branchId } });
        if (!branch) return res.status(404).json({ error: 'Succursale introuvable' });

        const hq = await prisma.branch.findFirst({ where: { isHQ: true } });
        if (!hq) return res.status(500).json({ error: 'Caisse Centrale HQ introuvable.' });

        if (hq.id === branchId) {
            return res.status(400).json({ error: 'Impossible d\'alimenter la Caisse Centrale avec elle-mÃªme.' });
        }

        if (hq.balance < amount) {
            return res.status(400).json({ error: `Fonds insuffisants. Solde HQ : ${hq.balance.toLocaleString('fr-FR')} FCFA` });
        }

        // Garde atomique (balance: gte) sur le dÃ©bit HQ : le contrÃ´le ci-dessus lit une
        // valeur non verrouillÃ©e, donc deux injections concurrentes depuis le mÃªme HQ
        // pouvaient toutes deux le passer et faire chuter le coffre physique central sous
        // zÃ©ro (mÃªme classe de bug dÃ©jÃ  corrigÃ©e dans CashOperationService/wallet.ts).
        const [updatedHQ, updatedBranch] = await prisma.$transaction([
            prisma.branch.update({ where: { id: hq.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } }),
            prisma.branch.update({ where: { id: branchId }, data: { balance: { increment: amount } } })
        ]);

        // Audit Trail (Float Injection - Double Entry Security)
        await prisma.auditLog.create({
            data: {
                adminId: admin.id,
                action: 'FLOAT_INJECTION',
                details: `Transfert de ${amount} FCFA (HQ -> ${branch.name}). Solde HQ restant: ${updatedHQ.balance}`
            }
        });

        return res.json({ success: true, message: `LiquiditÃ© de ${amount} FCFA transfÃ©rÃ©e Ã  ${branch.name}.`, branch: updatedBranch });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// V6 ERP: TELLER TERMINAL (GUICHET)
// ==========================================

router.get('/teller/lookup/:phone', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_cash_out')) {
            return res.status(403).json({ error: 'AccÃ¨s Guichet refusÃ©.' });
        }

        // Photos KYC incluses : un client se prÃ©sentant physiquement en agence doit pouvoir
        // Ãªtre comparÃ© Ã  sa piÃ¨ce d'identitÃ© au dossier â€” avant, ce lookup ne renvoyait que
        // nom/tÃ©lÃ©phone/statut, sans aucun moyen pour le caissier de vÃ©rifier visuellement
        // l'identitÃ© de la personne en face de lui.
        const user = await prisma.user.findUnique({
            where: { phone: req.params.phone as string },
            select: { id: true, name: true, phone: true, kycStatus: true, role: true, idCardFront: true, idCardBack: true, selfie: true }
        });

        if (!user) return res.status(404).json({ error: 'Client introuvable.' });
        return res.json(user);
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// [Deprecated Teller Endpoints Removed]

// ==========================================
// V6 ERP: STAFF MANAGEMENT (HABILITATIONS)
// ==========================================

router.get('/staff', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_system_settings_view` (sans rapport) au lieu de
        // `perm_staff_view` â€” BRANCH_MANAGER, seul rÃ´le non-admin qui l'a par dÃ©faut, voyait
        // l'onglet Personnel (App.tsx, perm_staff_view) mais chaque appel y Ã©chouait en 403.
        if (!admin || !hasPermission(admin, 'perm_staff_view')) {
            return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });
        }

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
        const skip = (page - 1) * limit;

        const { q, status, unassigned, branchId, role, sortBy, order } = req.query;
        const where: any = {};
        if (q) {
            where.OR = [
                { name: { contains: q as string, mode: 'insensitive' } },
                { email: { contains: q as string, mode: 'insensitive' } },
                { matricule: { contains: q as string, mode: 'insensitive' } },
            ];
        }
        if (status) {
            // Liste sÃ©parÃ©e par virgules (ex: "ACTIVE,SUSPENDED") pour exclure un seul statut
            // (PENDING) sans devoir choisir une seule valeur exacte â€” cf. admin-web StaffAccessRights,
            // dont la recherche doit couvrir les comptes actifs ET suspendus, mais pas la file PENDING.
            const statuses = (status as string).split(',').map(s => s.trim()).filter(Boolean);
            where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
        }
        if (unassigned === 'true') where.branchId = null;
        else if (unassigned === 'false') where.branchId = { not: null };
        if (branchId) where.branchId = branchId as string;
        if (role) where.role = role as string;

        const sortField = ['name', 'createdAt', 'matricule'].includes(sortBy as string) ? (sortBy as string) : 'name';
        const sortOrder = order === 'desc' ? 'desc' : 'asc';

        const [staffList, total] = await prisma.$transaction([
            prisma.staff.findMany({
                where,
                // matricule et status manquaient ici : Page 3 ("Droits d'AccÃ¨s") dÃ©pend de
                // status==='PENDING' pour distinguer sa file d'attente, donc c'Ã©tait
                // systÃ©matiquement vide cÃ´tÃ© client (toujours undefined !== 'PENDING'), et
                // le matricule s'affichait toujours "N/A" quelle que soit la vraie valeur.
                select: { id: true, email: true, name: true, role: true, isActive: true, status: true, matricule: true, branchId: true, branch: true, createdAt: true, permissionsCustomized: true },
                orderBy: { [sortField]: sortOrder },
                skip, take: limit
            }),
            prisma.staff.count({ where })
        ]);

        return res.json({ staff: staffList, total, page, pages: Math.ceil(total / limit) || 1 });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/staff', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_audit_log_view` (consultation de logs, sans rapport) au
        // lieu de `perm_staff_manage` â€” la permission dÃ©diÃ©e dans RBAC.ts, jamais accordÃ©e par
        // dÃ©faut Ã  un rÃ´le non-admin, ce qui restreint correctement cette action Ã  SUPER_ADMIN/
        // ADMIN (ou une surcharge explicite) plutÃ´t qu'Ã  quiconque a dÃ©jÃ  consultÃ© les audit logs.
        if (!admin || !hasPermission(admin, 'perm_staff_manage')) {
            return res.status(403).json({ error: 'Seule la direction peut habiliter du personnel.' });
        }

        const schema = z.object({
            email: z.string().email(),
            name: z.string().min(2),
            password: z.string().min(6),
            role: z.enum(['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER', 'TELLER']),
            matricule: z.string().min(2),
            cni: z.string().min(2),
            phone: z.string().min(8),
            address: z.string().optional(),
            dob: z.string().optional(),
            gender: z.string().optional(),
            emergencyPhone: z.string().optional(),
            branchId: z.string().optional()
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'DonnÃ©es invalides ou incomplÃ¨tes (Matricule, CNI requis).' });

        const existing = await prisma.staff.findUnique({ where: { email: parsed.data.email } });
        if (existing) return res.status(400).json({ error: 'Cet email professionnel est dÃ©jÃ  attribuÃ©.' });

        const hash = await bcrypt.hash(parsed.data.password, 10);

        const newStaff = await prisma.staff.create({
            data: {
                email: parsed.data.email,
                name: parsed.data.name,
                password: hash,
                role: parsed.data.role,
                matricule: parsed.data.matricule,
                cni: parsed.data.cni,
                phone: parsed.data.phone,
                address: parsed.data.address || null,
                dob: parsed.data.dob || null,
                gender: parsed.data.gender || null,
                emergencyPhone: parsed.data.emergencyPhone || null,
                status: 'PENDING', // MAKER-CHECKER LOCK
                branchId: parsed.data.branchId || null,
                createdById: admin.id,
                mustChangePassword: true,
            }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'CREATE_STAFF_PENDING', details: `CrÃ©ation compte Staff en attente : ${newStaff.email} (${newStaff.role})` }
        });

        return res.json({ success: true, message: 'EmployÃ© Corporate ajoutÃ© (STATUT : EN ATTENTE DE VALIDATION).' });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.put('/staff/:id/approve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_staff_manage')) {
            return res.status(403).json({ error: 'Autorisation Maker-Checker requise pour valider un recrutement.' });
        }

        const targetId = req.params.id as string;
        const targetStaff = await prisma.staff.findUnique({ where: { id: targetId } });
        if (!targetStaff) return res.status(404).json({ error: 'Staff introuvable.' });
        if (targetStaff.status === 'ACTIVE') return res.status(400).json({ error: 'Ce compte est dÃ©jÃ  actif.' });

        // Anti-auto-approbation (Maker/Checker) : le recruteur ne peut pas valider son propre
        // recrutement â€” sauf SUPER_ADMIN (autoritÃ© ultime), pour Ã©viter une impasse totale
        // d'onboarding si un seul compte staff actif existe dans le systÃ¨me.
        if (targetStaff.createdById && targetStaff.createdById === admin.id && admin.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Le recruteur ne peut pas approuver le compte qu\'il a lui-mÃªme crÃ©Ã©.' });
        }

        await prisma.staff.update({
            where: { id: targetId },
            data: { status: 'ACTIVE', isActive: true }
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'APPROVE_STAFF', details: `Habilitation dÃ©finitive du matricule : ${targetStaff.matricule}` }
        });

        return res.json({ success: true, message: 'Habilitation bancaire approuvÃ©e avec succÃ¨s !' });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

const STAFF_ROLES = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER', 'TELLER'];

router.put('/staff/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!admin || !hasPermission(admin, 'perm_staff_manage')) {
            return res.status(403).json({ error: 'Droit institutionnel requis.' });
        }

        const targetId = req.params.id as string;
        // Allows modifying Role and BranchId
        const { role, branchId, isActive } = req.body;

        // Le changement de rÃ´le (et l'activation/dÃ©sactivation d'un compte SUPER_ADMIN) est
        // rÃ©servÃ© au SUPER_ADMIN : un RISK ne doit pas pouvoir s'auto-promouvoir ni Ã©jecter un
        // SUPER_ADMIN en le dÃ©sactivant. `role` est validÃ© par la mÃªme whitelist que la
        // crÃ©ation (POST /staff) â€” sans Ã§a, n'importe quelle chaÃ®ne Ã©tait acceptÃ©e telle
        // quelle et Ã©crite en base.
        if (role !== undefined) {
            if (admin.role !== 'SUPER_ADMIN') {
                return res.status(403).json({ error: 'Seul un SUPER_ADMIN peut modifier un rÃ´le.' });
            }
            if (targetId === admin.id) {
                return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rÃ´le.' });
            }
            if (!STAFF_ROLES.includes(role)) {
                return res.status(400).json({ error: 'RÃ´le invalide.' });
            }
        }
        if (isActive !== undefined && targetId === admin.id) {
            return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre statut d\'activation.' });
        }

        // N'Ã©crit branchId que si la clÃ© est explicitement prÃ©sente dans le body : sinon
        // `branchId || null` Ã©crasait systÃ©matiquement l'affectation existante Ã  null dÃ¨s
        // qu'un appelant ne mettait Ã  jour que le rÃ´le ou l'activation (StaffAccessRights.tsx
        // n'envoie jamais branchId), dÃ©saffectant silencieusement le staff de son agence.
        const data: any = {};
        if (role !== undefined) data.role = role;
        if (isActive !== undefined) {
            data.isActive = isActive;
            // Suspension : rÃ©voque immÃ©diatement toute session dÃ©jÃ  ouverte plutÃ´t que
            // d'attendre jusqu'Ã  12h l'expiration naturelle du token dÃ©jÃ  Ã©mis.
            if (isActive === false) data.jwtVersion = { increment: 1 };
        }
        if ('branchId' in req.body) data.branchId = branchId || null;

        const updated = await prisma.staff.update({
            where: { id: targetId },
            data
        });

        await prisma.auditLog.create({
            data: { adminId: admin.id, action: 'UPDATE_STAFF', details: `Mutation appliquÃ©e Ã  ${updated.name} (${updated.matricule})` }
        });

        return res.json({ success: true, message: 'Fiche du personnel mise Ã  jour avec succÃ¨s.', staff: updated });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});
// ==========================================
// CUSTOMER 360 - MODULE GESTION CLIENT V6
// ==========================================

router.get('/customers', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_ticket_resolve` (sans rapport avec la liste clients) au
        // lieu de `perm_customer_view` â€” la permission sur laquelle App.tsx/Users.tsx gatent
        // rÃ©ellement l'onglet cÃ´tÃ© UI (TELLER et RISK l'ont par dÃ©faut mais pas ticket_resolve).
        if (!staff || !hasPermission(staff, 'perm_customer_view')) {
            return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const { q, status, kycStatus, role } = req.query;

        // Le segment de compte (Client / Agent / Marchand) â€” auparavant fig? sur 'USER'
        // sans possibilit? de filtrer, ce qui rendait les comptes Agent/Marchand cr??s
        // via "Cr?er Compte Pro" litt?ralement invisibles dans cette liste.
        // AGENT filtrable individuellement (utilis? par l'entr?e "Agents Mongain" sous
        // Organisation Interne) mais volontairement exclu de 'ALL' : un agent est rattach?
        // ? l'organisation/agence, pas Ã  la clientÃ¨le, donc "Tous" dans l'?cran Clients &
        // Marchands ne doit pas le m?langer avec les vrais tiers externes.
        const SEGMENT_ROLES = ['USER', 'AGENT', 'MERCHANT'];
        const CLIENT_SEGMENT_ROLES = ['USER', 'MERCHANT'];
        let where: any = {};
        if (role === 'ALL') {
            where.role = { in: CLIENT_SEGMENT_ROLES };
        } else if (role && SEGMENT_ROLES.includes(role as string)) {
            where.role = role as string;
        } else {
            where.role = 'USER'; // Segment par d?faut : clients particuliers
        }
        if (q) {
            where.OR = [
                { phone: { contains: q as string } },
                { name: { contains: q as string, mode: 'insensitive' } },
                { id: { contains: q as string } }
            ];
        }
        if (status) where.accountStatus = status;
        if (kycStatus) where.kycStatus = kycStatus;

        const [customers, total] = await prisma.$transaction([
            prisma.user.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true, name: true, phone: true, role: true, kycLevel: true, kycStatus: true,
                    accountStatus: true, isActive: true, createdAt: true, branchId: true, accountNumber: true,
                    wallet: { select: { updatedAt: true } },
                    _count: { select: { riskFlags: true } }
                }
            }),
            prisma.user.count({ where })
        ]);

        return res.json({ customers, total, page, limit });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


router.post('/users/:id/logout-all', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_suspend')) {
            return res.status(403).json({ error: 'Action non autorisÃ©e.' });
        }

        const targetId = req.params.id as string;

        await prisma.$transaction([
            prisma.user.update({
                where: { id: targetId },
                data: { jwtVersion: { increment: 1 } }
            }),
            prisma.auditLog.create({
                data: { adminId: staff.id, action: 'LOGOUT_ALL_SESSIONS', details: `Invalidation forcÃ©e de toutes les sessions mobiles (Client : ${targetId}).` }
            })
        ]);

        return res.json({ success: true, message: 'Toutes les sessions de cet utilisateur ont Ã©tÃ© invalidÃ©es (Log Out universel).' });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/users/:id/risk-flags', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) {
            return res.status(403).json({ error: 'Seule la conformitÃ© et les risques peuvent affecter un Flag.' });
        }

        const targetId = req.params.id as string;
        const { type, description } = req.body;

        if (!description || description.length < 5) return res.status(400).json({ error: 'Description obligatoire (min. 5 chars).' });

        await prisma.$transaction([
            prisma.riskFlag.create({
                data: {
                    userId: targetId,
                    type: type || 'SUSPICIOUS_ACTIVITY',
                    description: description,
                    authorId: staff.id,
                    status: 'OPEN'
                }
            }),
            prisma.auditLog.create({
                data: { adminId: staff.id, action: 'ATTACH_RISK_FLAG', details: `Flag type [${type}] ajoutÃ© au Client ID ${targetId}` }
            })
        ]);

        return res.json({ success: true, message: 'Drapeau de risque enregistrÃ©.' });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/users/:id/reset-pin-request', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // SUPPORT_MAKER is allowed to help clients reset their PINs
        if (!staff || !hasPermission(staff, 'perm_ticket_view')) {
            return res.status(403).json({ error: 'Droit institutionnel requis.' });
        }

        const targetId = req.params.id as string;
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Motif de la demande client.' });

        const user = await prisma.user.findUnique({ where: { id: targetId } });
        if (!user) return res.status(404).json({ error: 'Introuvable' });

        // 4 chiffres : doit rester alignable avec resetPinSchema (auth.ts, /reset-pin),
        // qui n'accepte qu'un code Ã  4 chiffres â€” un code Ã  6 chiffres ne pourrait
        // jamais Ãªtre soumis avec succÃ¨s par le client.
        const otp = crypto.randomInt(1000, 10000).toString();

        await prisma.$transaction([
            prisma.verificationCode.upsert({
                where: { phone_purpose: { phone: user.phone, purpose: 'RESET_PIN' } },
                create: { phone: user.phone, purpose: 'RESET_PIN', code: otp, expiresAt: new Date(Date.now() + 15 * 60000) },
                update: { code: otp, expiresAt: new Date(Date.now() + 15 * 60000) }
            }),
            prisma.user.update({ where: { id: targetId }, data: { failedPinAttempts: 0 } }),
            prisma.auditLog.create({
                data: { adminId: staff.id, action: 'PIN_RESET_TRIGGER', details: `Demande rÃ©init. PIN pour ${user.phone}. Raison : ${reason}` }
            })
        ]);

        await sendSms(user.phone, `Mongain : Votre demande de rÃ©initialisation de PIN a Ã©tÃ© approuvÃ©e par le Support. OTP de sÃ©curitÃ© : ${otp}. Valide 15 minutes.`);

        return res.json({ success: true, message: 'ProcÃ©dure OTP de recouvrement dÃ©clenchÃ©e sur le tÃ©lÃ©phone du client.' });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// GET Limit Requests specific to a user
router.get('/users/:id/limit-requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        // Historique de relÃ¨vement de plafond client : donnÃ©e de conformitÃ©, rÃ©servÃ©e aux
        // mÃªmes rÃ´les que le reste du dossier Customer 360 sensible â€” un simple `if (!staff)`
        // laissait n'importe quel rÃ´le (TELLER inclus) la consulter pour n'importe quel client.
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'Interdit' });

        const requests = await prisma.settingsApproval.findMany({
            where: {
                action: 'CUSTOMER_LIMIT_INCREASE',
                payload: { contains: req.params.id as string }
            },
            orderBy: { createdAt: 'desc' },
            include: { maker: { select: { name: true, role: true } }, checker: { select: { name: true, role: true } } }
        });

        res.json(requests);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// ============================================================
// PROMPT 09 ? SUPPORT, LITIGES, FRAUD & REFUNDS
// ============================================================

// -- Create Ticket -----------------------------------------------
router.post('/reclamations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_ticket_resolve` (clÃ´turer un ticket) au lieu de
        // `perm_ticket_create` â€” la permission dÃ©diÃ©e Ã  cette action dans RBAC.ts.
        if (!staff || !hasPermission(staff, 'perm_ticket_create')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { title, description, category, priority, userId, transactionId, branchId, tellerId } = req.body;
        if (!title || !description || !userId) return res.status(400).json({ error: 'title, description et userId sont obligatoires.' });

        // Calcul SLA deadline
        const settings = await prisma.systemSettings.findFirst();
        const slaHours: Record<string, number> = {
            LOW: (settings as any)?.slaLowHours ?? 72,
            NORMAL: (settings as any)?.slaNormalHours ?? 48,
            HIGH: (settings as any)?.slaHighHours ?? 24,
            CRITICAL: (settings as any)?.slaCriticalHours ?? 4,
        };
        const p = priority || 'NORMAL';
        const slaDeadline = new Date(Date.now() + slaHours[p] * 3600 * 1000);

        const ticket = await prisma.reclamation.create({
            data: { title, description, category: category || 'OTHER', priority: p, userId, transactionId, branchId, tellerId, slaDeadline }
        });

        await prisma.auditLog.create({ data: { adminId: staff.id, action: 'CREATE_TICKET', details: `Ticket ${ticket.id.substring(0, 8)} crÃ©Ã© catÃ©gorie [${category}] SLA deadline : ${slaDeadline.toISOString()}` } });
        res.status(201).json(ticket);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// ============================================================
// FRAUD CASES (Acc?s RISK / COMPLIANCE / SUPER_ADMIN uniquement)
// ============================================================

router.post('/fraud-cases', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) return res.status(403).json({ error: 'RÃ©servÃ© Ã©quipe Risk/Compliance.' });

        const { userId, type, riskLevel, description, linkedTransactionIds, reclamationId } = req.body;
        if (!userId || !description) return res.status(400).json({ error: 'userId et description requis.' });

        const fraudCase = await prisma.fraudCase.create({
            data: {
                userId,
                analystId: staff.id,
                type: type || 'SUSPICIOUS_ACTIVITY',
                riskLevel: riskLevel || 'MEDIUM',
                description,
                linkedTransactionIds: JSON.stringify(linkedTransactionIds || []),
                reclamationId: reclamationId || null
            }
        });

        await prisma.auditLog.create({ data: { adminId: staff.id, action: 'OPEN_FRAUD_CASE', details: `Dossier fraude ${fraudCase.id.substring(0, 8)} ouvert Â· Type: ${type} Â· NiveauRisque: ${riskLevel}` } });
        res.status(201).json(fraudCase);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/fraud-cases', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) return res.status(403).json({ error: 'AccÃ¨s limitÃ©.' });

        const { status, riskLevel, page = '1', limit = '50' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const where: any = {};
        if (status) where.status = status as string;
        if (riskLevel) where.riskLevel = riskLevel as string;

        const [cases, total] = await Promise.all([
            prisma.fraudCase.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip, take: parseInt(limit as string),
                include: {
                    user: { select: { name: true, phone: true } },
                    analyst: { select: { name: true } }
                }
            }),
            prisma.fraudCase.count({ where })
        ]);

        res.json({ cases, total });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/fraud-cases/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) return res.status(403).json({ error: 'AccÃ¨s limitÃ©.' });

        const fc = await prisma.fraudCase.findUnique({
            where: { id: String(req.params.id) as string },
            include: { user: { select: { name: true, phone: true, kycLevel: true, accountStatus: true } }, analyst: { select: { name: true, role: true } } }
        });
        if (!fc) return res.status(404).json({ error: 'Dossier introuvable.' });
        res.json(fc);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.patch('/fraud-cases/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) return res.status(403).json({ error: 'AccÃ¨s limitÃ©.' });

        const { status, riskLevel, decision, analystId } = req.body;
        const data: any = {};
        if (status) data.status = status;
        if (riskLevel) data.riskLevel = riskLevel;
        if (decision) data.decision = decision;
        if (analystId) data.analystId = analystId;
        if (status === 'CLOSED') data.closedAt = new Date();

        const updated = await prisma.fraudCase.update({ where: { id: String(req.params.id) as string }, data });
        await prisma.auditLog.create({ data: { adminId: staff.id, action: 'UPDATE_FRAUD_CASE', details: `Fraud ${updated.id.substring(0, 8)}: statut: ${status} Â· dÃ©cision: ${decision}` } });
        res.json({ success: true, fraudCase: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ============================================================
// REFUND REQUESTS ? Anti-double-refund, Maker/Checker, TX inverse
// ============================================================

router.post('/refund-requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_ticket_resolve` (sans rapport) au lieu de
        // `perm_refund_request`, la permission Maker dÃ©diÃ©e pour cette action (voir RBAC.ts).
        if (!staff || !hasPermission(staff, 'perm_refund_request')) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const { transactionId, userId, amount, refundType, reason, description, reclamationId } = req.body;
        if (!transactionId || !userId || !amount || !reason) return res.status(400).json({ error: 'transactionId, userId, amount, reason sont obligatoires.' });

        // Valider la transaction d'origine (READ-ONLY)
        const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
        if (!tx) return res.status(404).json({ error: 'Transaction originale introuvable.' });
        if (amount > tx.amount) return res.status(400).json({ error: `Montant remboursable max: ${tx.amount} FCFA.` });

        // Anti-double-refund: @unique sur transactionId ? la contrainte DB rejettera automatiquement
        const refund = await prisma.refundRequest.create({
            data: { transactionId, userId, requesterId: staff.id, amount, refundType: refundType || 'FULL', reason, description: description || '', reclamationId: reclamationId || null }
        });

        await prisma.auditLog.create({ data: { adminId: staff.id, action: 'CREATE_REFUND_REQUEST', details: `RefundReq ${refund.id.substring(0, 8)}: TX ${transactionId} Â· ${amount} FCFA Â· Type: ${refundType}` } });
        res.status(201).json(refund);
    } catch (e: any) {
        if (e.code === 'P2002') return res.status(409).json({ error: 'Un remboursement pour cette transaction existe dÃ©jÃ . Double remboursement interdit.' });
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/refund-requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_ticket_resolve` (sans rapport) au lieu d'autoriser Ã  la
        // fois le Maker (crÃ©e la demande) et le Checker (l'approuve) Ã  consulter la liste.
        if (!staff || !(hasPermission(staff, 'perm_refund_request') || hasPermission(staff, 'perm_refund_approve'))) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const { status, page = '1', limit = '50' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const where: any = {};
        if (status) where.status = status as string;

        const [refunds, total] = await Promise.all([
            prisma.refundRequest.findMany({
                where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit as string),
                include: {
                    user: { select: { name: true, phone: true } },
                    requester: { select: { name: true, role: true } },
                    approver: { select: { name: true, role: true } }
                }
            }),
            prisma.refundRequest.count({ where })
        ]);

        res.json({ refunds, total });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.patch('/refund-requests/:id/approve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_refund_approve')) return res.status(403).json({ error: 'Seul Finance/SuperAdmin peut approuver.' });

        const refund = await prisma.refundRequest.findUnique({ where: { id: String(req.params.id) as string } });
        if (!refund) return res.status(404).json({ error: 'Demande introuvable.' });

        // Anti auto-approbation: le Maker ne peut pas ?tre le Checker (sauf SUPER_ADMIN)
        if (refund.requesterId === staff.id && staff.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Le demandeur ne peut pas approuver sa propre demande (rÃ¨gle Maker/Checker).' });
        }
        if (refund.status !== 'REQUESTED' && refund.status !== 'UNDER_REVIEW') return res.status(400).json({ error: 'Statut incompatible pour approbation.' });

        const { action, rejectionReason } = req.body;
        const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        const updated = await prisma.refundRequest.update({
            where: { id: String(req.params.id) as string },
            data: { status: newStatus, approverId: staff.id, rejectionReason: rejectionReason || null }
        });

        await prisma.auditLog.create({ data: { adminId: staff.id, action: `REFUND_${newStatus}`, details: `RefundReq ${updated.id.substring(0, 8)}: ${newStatus}. Motif rejet: ${rejectionReason || 'N/A'}` } });
        res.json({ success: true, refund: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/refund-requests/:id/execute', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_refund_approve')) return res.status(403).json({ error: 'Seul Finance/SuperAdmin peut exÃ©cuter un remboursement.' });

        const settings = await prisma.systemSettings.findFirst();
        if (settings?.circuitBreaker) {
            return res.status(403).json({ error: 'Le Circuit Breaker est activÃ©. OpÃ©rations financiÃ¨res bloquÃ©es.' });
        }

        const refund = await prisma.refundRequest.findUnique({ where: { id: String(req.params.id) as string } });
        if (!refund) return res.status(404).json({ error: 'Demande introuvable.' });
        if (refund.status !== 'APPROVED') return res.status(400).json({ error: 'La demande doit Ãªtre APPROVED avant exÃ©cution.' });

        // Retrouver la TX originale et le wallet du client
        const originalTx = await prisma.transaction.findUnique({ where: { id: refund.transactionId } });
        if (!originalTx) return res.status(404).json({ error: 'Transaction originale introuvable.' });
        if (!originalTx.receiverWalletId) return res.status(400).json({ error: 'Transaction originale sans portefeuille bÃ©nÃ©ficiaire â€” remboursement impossible.' });

        const userWallet = await prisma.wallet.findUnique({ where: { userId: refund.userId } });
        if (!userWallet) return res.status(404).json({ error: 'Wallet client introuvable.' });

        const counterpartWallet = await prisma.wallet.findUnique({ where: { id: originalTx.receiverWalletId } });
        if (!counterpartWallet) return res.status(404).json({ error: 'Portefeuille contrepartie introuvable.' });
        if (counterpartWallet.balance < refund.amount) {
            return res.status(400).json({ error: 'Le portefeuille contrepartie n\'a plus assez de fonds pour couvrir ce remboursement.' });
        }

        // ExÃ©cution atomique : dÃ©biter la contrepartie, crÃ©diter le wallet client + marquer
        // le refund EXECUTED. NE JAMAIS effacer la TX originale â€” crÃ©er une NOUVELLE Ã©criture
        // TX inverse. Transaction interactive (pas le simple tableau `$transaction([...])`
        // utilisÃ© avant) afin de pouvoir rÃ©clamer atomiquement le statut APPROVED->EXECUTED :
        // le check `refund.status !== 'APPROVED'` ci-dessus lit une valeur non verrouillÃ©e,
        // donc deux appels /execute concurrents sur la mÃªme demande (double-clic, retry
        // rÃ©seau) pouvaient tous deux le passer et payer le remboursement deux fois. La garde
        // atomique (balance: gte) protÃ¨ge en plus contre deux remboursements diffÃ©rents
        // dÃ©bitant la mÃªme contrepartie en parallÃ¨le.
        await prisma.$transaction(async (tx) => {
            const claim = await tx.refundRequest.updateMany({
                where: { id: refund.id, status: 'APPROVED' },
                data: { status: 'EXECUTED', executedAt: new Date() }
            });
            if (claim.count === 0) throw new Error('Cette demande a dÃ©jÃ  Ã©tÃ© exÃ©cutÃ©e.');

            await tx.wallet.update({ where: { id: counterpartWallet.id, balance: { gte: refund.amount } }, data: { balance: { decrement: refund.amount } } });
            await tx.wallet.update({ where: { id: userWallet.id }, data: { balance: { increment: refund.amount } } });
            await tx.transaction.create({
                data: {
                    amount: refund.amount,
                    status: 'COMPLETED',
                    receiverWalletId: userWallet.id,
                    senderWalletId: counterpartWallet.id,
                    reference: 'REFUND-' + (originalTx.reference || originalTx.id.substring(0, 8)),
                }
            });
            await tx.auditLog.create({ data: { adminId: staff.id, action: 'EXECUTE_REFUND', details: `Refund ${refund.id.substring(0, 8)} : ${refund.amount} FCFA crÃ©ditÃ©s sur wallet ${userWallet.id}, dÃ©bitÃ©s du wallet ${counterpartWallet.id}. TX originale ${refund.transactionId} NON modifiÃ©e.` } });
            // Sans Ã§a, le client remboursÃ© n'a aucun moyen de savoir que l'argent est arrivÃ©
            // en dehors d'ouvrir son historique et de le remarquer par hasard.
            await tx.notification.create({
                data: { userId: refund.userId, title: 'Remboursement reÃ§u', body: `Vous avez Ã©tÃ© remboursÃ© de ${refund.amount.toLocaleString('fr-FR')} FCFA.`, type: 'TRANSACTION' }
            });
        });

        res.json({ success: true, message: `Remboursement de ${refund.amount} FCFA exÃ©cutÃ©. TX originale prÃ©servÃ©e.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// ============================================================
// PROMPT 13 ? CUSTOMER 360 : ROUTES ADMIN ENRICHIES
// ============================================================

// -- GET /api/admin/users/:id/360 ----------------------------
router.get('/users/:id/360', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        // RÃ©gression : un unique flag `isSensitive` sur `perm_customer_360_basic` gatait wallet,
        // photos KYC ET notes de risque/gel Ã  la fois â€” or `perm_customer_360_basic` est
        // accordÃ©e par dÃ©faut Ã  TOUS les rÃ´les non-admin (TELLER, BRANCH_MANAGER inclus), ce
        // qui rendait ce contrÃ´le inopÃ©rant : Customer360.tsx masque bien wallet/KYC/motif de
        // gel cÃ´tÃ© UI pour TELLER/BRANCH_MANAGER, mais le backend les envoyait quand mÃªme dans
        // la rÃ©ponse JSON brute (visible depuis l'onglet rÃ©seau du navigateur). Chaque
        // catÃ©gorie utilise dÃ©sormais sa propre permission dÃ©diÃ©e (RBAC.ts).
        const canViewWallet = hasPermission(staff, 'perm_customer_wallet_view');
        const canViewKyc = hasPermission(staff, 'perm_customer_kyc_view');
        const canViewRisk = hasPermission(staff, 'perm_customer_flag');
        const canViewAnySensitive = canViewWallet || canViewKyc || canViewRisk;

        const user = await prisma.user.findUnique({
            where: { id: customerId },
            select: {
                id: true,
                name: true,
                phone: true,
                username: true,
                accountNumber: true,
                email: canViewAnySensitive ? true : false,
                role: true,
                isActive: true,
                accountStatus: true,
                createdAt: true,
                updatedAt: true,
                kycLevel: true,
                kycStatus: true,
                idCardFront: canViewKyc ? true : false,
                idCardBack: canViewKyc ? true : false,
                selfie: canViewKyc ? true : false,
                failedPinAttempts: true,
                lockedUntil: true,
                jwtVersion: true,
                // Motif de gel et description des alertes de risque : notes de conformitÃ© en
                // clair, jamais destinÃ©es Ã  un rÃ´le guichet (TELLER) ou d'agence
                // (BRANCH_MANAGER) â€” dÃ©sormais masquÃ©es comme le reste des champs sensibles.
                freezeReason: canViewRisk ? true : false,
                frozenUntil: canViewRisk ? true : false,
                customDailyLimit: canViewWallet ? true : false,
                customMonthlyLimit: canViewWallet ? true : false,
                customPerTxLimit: canViewWallet ? true : false,
                customLimitExpiresAt: canViewWallet ? true : false,
                wallet: canViewWallet ? {
                    select: { id: true, balance: true, currency: true, dailySpent: true, monthlySpent: true, createdAt: true }
                } : false,
                riskFlags: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: canViewRisk
                        ? { id: true, type: true, status: true, description: true, createdAt: true, author: { select: { name: true } } }
                        : { id: true, type: true, status: true, createdAt: true },
                },
                reclamations: {
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: { id: true, title: true, status: true, priority: true, category: true, createdAt: true }
                }
            }
        });

        if (!user) return res.status(404).json({ error: 'Client introuvable.' });

        // Recent Transactions (last 10)
        let recentTx: any[] = [];
        if (canViewWallet && user.wallet) {
            recentTx = await prisma.transaction.findMany({
                where: { OR: [{ senderWalletId: (user as any).wallet.id }, { receiverWalletId: (user as any).wallet.id }] },
                orderBy: { createdAt: 'desc' },
                take: 10,
                select: { id: true, reference: true, amount: true, fee: true, type: true, status: true, createdAt: true, branchId: true }
            });
        }

        // Audit (last 20 related entries)
        const auditLogs = await attachAuditActors(await prisma.auditLog.findMany({
            where: { details: { contains: customerId } },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { id: true, action: true, details: true, createdAt: true, adminId: true }
        }));

        // Compteurs rÃ©els (indÃ©pendants du `take: 5` sur riskFlags/reclamations ci-dessus,
        // qui ne fournit qu'un aperÃ§u) â€” Ã©vite que l'AperÃ§u sous-Ã©value silencieusement le
        // niveau de risque d'un client au-delÃ  de 5 flags/tickets.
        const [openRiskFlagsCount, reclamationsCount] = await Promise.all([
            prisma.riskFlag.count({ where: { userId: customerId, status: 'OPEN' } }),
            prisma.reclamation.count({ where: { userId: customerId } })
        ]);

        // Score de fiabilitÃ© tontine â€” usage interne UNIQUEMENT (aide Ã  la dÃ©cision d'un
        // opÃ©rateur avant d'accepter ce client dans un nouveau groupe, ou pour prioriser un
        // rappel amiable). Ceci n'est PAS un score de crÃ©dit et ne doit JAMAIS servir Ã  dÃ©cider
        // d'un prÃªt ou d'une ligne de crÃ©dit â€” le microcrÃ©dit est une activitÃ© rÃ©glementÃ©e hors
        // du pÃ©rimÃ¨tre dÃ©cidÃ© pour cette fonctionnalitÃ© (voir la validation utilisateur :
        // "Juste calculer un score interne, sans prÃªter"). GatÃ©e par perm_tontine_view comme le
        // reste de la lecture admin des tontines (admin.tontines.ts).
        let tontineReliability: { totalCycles: number; paidCycles: number; partialOrMissedCycles: number; penaltiesCount: number; scorePercent: number | null } | null = null;
        if (hasPermission(staff, 'perm_tontine_view')) {
            const [totalCycles, paidCycles, penaltiesCount] = await Promise.all([
                prisma.tontineContribution.count({ where: { participant: { userId: customerId } } }),
                prisma.tontineContribution.count({ where: { participant: { userId: customerId }, status: 'PAID' } }),
                prisma.tontineContribution.count({ where: { participant: { userId: customerId }, penaltyAppliedAt: { not: null } } }),
            ]);
            tontineReliability = {
                totalCycles,
                paidCycles,
                partialOrMissedCycles: totalCycles - paidCycles,
                penaltiesCount,
                // null tant qu'aucun historique n'existe â€” distinct de 0%, qui affirmerait
                // Ã  tort une mauvaise fiabilitÃ© pour un client n'ayant simplement jamais
                // participÃ© Ã  une tontine.
                scorePercent: totalCycles > 0 ? Math.round((paidCycles / totalCycles) * 100) : null,
            };
        }

        res.json({ user, recentTx, auditLogs, openRiskFlagsCount, reclamationsCount, tontineReliability });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/block -------------------------
router.post('/users/:id/block', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©. (RISK ou SUPER_ADMIN requis)' });

        const { reason } = req.body;
        if (!reason || reason.trim().length < 5) return res.status(400).json({ error: 'Motif obligatoire (min 5 caractÃ¨res).' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });
        if (target.accountStatus === 'SUSPENDED') return res.status(400).json({ error: 'Le compte est dÃ©jÃ  suspendu.' });

        const before = target.accountStatus;

        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { accountStatus: 'SUSPENDED', isActive: false, freezeReason: reason }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'BLOCK_ACCOUNT',
                    details: `[CRM360] Compte ${target.phone} (${customerId}) BLOQUÃ‰. Avant : ${before}. Raison : ${reason}. Par : ${staff.name} (${staff.role})`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'Compte suspendu',
                    body: 'Votre compte Mongain a Ã©tÃ© temporairement suspendu. Contactez le support pour plus d\'informations.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: `Compte de ${target.name} suspendu.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/unblock -----------------------
router.post('/users/:id/unblock', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { reason } = req.body;
        if (!reason || reason.trim().length < 5) return res.status(400).json({ error: 'Motif de dÃ©blocage obligatoire.' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { accountStatus: 'ACTIVE', isActive: true, freezeReason: null, frozenUntil: null }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'UNBLOCK_ACCOUNT',
                    details: `[CRM360] Compte ${target.phone} (${customerId}) DÃ‰BLOQUÃ‰. Raison : ${reason}. Par : ${staff.name} (${staff.role})`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'Compte rÃ©activÃ©',
                    body: 'Votre compte Mongain a Ã©tÃ© rÃ©activÃ©. Vous pouvez maintenant effectuer des transactions.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: `Compte de ${target.name} rÃ©activÃ©.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/flag --------------------------
router.post('/users/:id/flag', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : vÃ©rifiait `perm_customer_360_basic` (accordÃ©e par dÃ©faut Ã  tous les
        // rÃ´les non-admin, donc inopÃ©rante) au lieu de `perm_customer_flag`, la permission
        // dÃ©diÃ©e dans RBAC.ts (que TELLER, notamment, n'a pas par dÃ©faut).
        if (!staff || !hasPermission(staff, 'perm_customer_flag')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { type, description } = req.body;
        const validTypes = ['SUSPICIOUS_ACTIVITY', 'AML_ALERT', 'FRAUD_REPORT', 'IDENTITY_THEFT', 'ANTI_FRACTIONING', 'OTHER'];
        if (!description) return res.status(400).json({ error: 'Description obligatoire.' });
        if (type && !validTypes.includes(type)) return res.status(400).json({ error: 'Type de flag invalide.' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        const flag = await prisma.riskFlag.create({
            data: {
                userId: customerId,
                authorId: staff.id,
                type: type || 'SUSPICIOUS_ACTIVITY',
                description,
                status: 'OPEN'
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'FLAG_CUSTOMER',
                details: `[CRM360] Flag ${flag.type} crÃ©Ã© sur ${target.phone} (${customerId}). Description : ${description}`
            }
        });

        res.json({ success: true, flag });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/transactions -------------------
router.get('/users/:id/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const { type, status, page = '1', limit = '25' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const user = await prisma.user.findUnique({ where: { id: customerId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Client ou wallet introuvable.' });

        const where: any = { OR: [{ senderWalletId: user.wallet.id }, { receiverWalletId: user.wallet.id }] };
        if (type) where.type = type as string;
        if (status) where.status = status as string;

        const [txs, total] = await Promise.all([
            prisma.transaction.findMany({
                where, orderBy: { createdAt: 'desc' }, skip, take: parseInt(limit as string),
                include: {
                    // `id` est indispensable ici : Customer360.tsx compare
                    // `t.senderWallet?.user?.id === userId` pour dÃ©terminer le sens de la
                    // transaction (entrant/sortant) et qui afficher comme contrepartie. Sans
                    // lui, cette comparaison est toujours `undefined === userId` (faux), donc
                    // TOUTE transaction sortante s'affichait comme entrante, avec le client
                    // lui-mÃªme affichÃ© comme contrepartie au lieu du vrai destinataire.
                    senderWallet: { include: { user: { select: { id: true, name: true, phone: true } } } },
                    receiverWallet: { include: { user: { select: { id: true, name: true, phone: true } } } }
                }
            }),
            prisma.transaction.count({ where })
        ]);

        res.json({ txs, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/cash-ops -----------------------
router.get('/users/:id/cash-ops', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const user = await prisma.user.findUnique({ where: { id: customerId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Client ou wallet introuvable.' });

        const walletId = user.wallet.id;
        const now = new Date();
        const d24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const d7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [cashIns, cashOuts] = await Promise.all([
            prisma.transaction.findMany({
                where: { receiverWalletId: walletId, type: 'CASH_IN', status: 'COMPLETED' },
                orderBy: { createdAt: 'desc' },
                take: 50,
                select: { id: true, amount: true, fee: true, reference: true, createdAt: true, branchId: true, tellerId: true }
            }),
            prisma.transaction.findMany({
                where: { senderWalletId: walletId, OR: [{ reference: { startsWith: 'COUT-' } }, { reference: { startsWith: 'CASH_OUT' } }, { type: 'CASH_OUT' }], status: 'COMPLETED' },
                orderBy: { createdAt: 'desc' },
                take: 50,
                select: { id: true, amount: true, fee: true, reference: true, createdAt: true, branchId: true, tellerId: true }
            })
        ]);

        // Anti-fractioning metrics
        const cashOuts24h = cashOuts.filter(t => new Date(t.createdAt) >= d24h);
        const cashOuts7d = cashOuts.filter(t => new Date(t.createdAt) >= d7d);
        const branches24h = [...new Set(cashOuts24h.map(t => t.branchId).filter(Boolean))].length;
        const totalOut24h = cashOuts24h.reduce((s, t) => s + t.amount, 0);
        const totalOut7d = cashOuts7d.reduce((s, t) => s + t.amount, 0);
        const fees7d = cashOuts7d.reduce((s, t) => s + t.fee, 0);

        res.json({
            cashIns,
            cashOuts,
            antiFractioning: {
                totalOut24h,
                totalOut7d,
                countLast24h: cashOuts24h.length,
                countLast7d: cashOuts7d.length,
                branchesUsed24h: branches24h,
                avgPerOp24h: cashOuts24h.length ? Math.round(totalOut24h / cashOuts24h.length) : 0,
                feesPaid7d: fees7d,
                flagged: cashOuts24h.length >= 3 || branches24h >= 2
            }
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/security -----------------------
router.get('/users/:id/security', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const user = await prisma.user.findUnique({
            where: { id: customerId },
            select: {
                id: true, phone: true, name: true,
                failedPinAttempts: true, lockedUntil: true,
                jwtVersion: true, accountStatus: true,
                isActive: true, freezeReason: true, frozenUntil: true, updatedAt: true
            }
        });
        if (!user) return res.status(404).json({ error: 'Client introuvable.' });

        const isLocked = user.lockedUntil ? user.lockedUntil > new Date() : false;

        // Security-related audit events
        const securityLogs = await attachAuditActors(await prisma.auditLog.findMany({
            where: {
                details: { contains: customerId },
                action: { in: ['BLOCK_ACCOUNT', 'UNBLOCK_ACCOUNT', 'RESET_PIN', 'REVOKE_SESSIONS', 'UNLOCK_ACCOUNT', 'TOGGLE_STATUS', 'FLAG_CUSTOMER'] }
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: { action: true, details: true, createdAt: true, adminId: true }
        }));

        res.json({ ...user, isLocked, securityLogs });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/unlock-account ----------------
router.post('/users/:id/unlock-account', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Motif requis.' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { failedPinAttempts: 0, lockedUntil: null }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'UNLOCK_ACCOUNT',
                    details: `[CRM360] DÃ©verrouillage PIN pour ${target.phone} (${customerId}). Raison : ${reason}. Par : ${staff.name}`
                }
            })
        ]);

        res.json({ success: true, message: 'Compte dÃ©verrouillÃ©, le client peut maintenant retenter son PIN.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/revoke-sessions ---------------
router.post('/users/:id/revoke-sessions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©. (RISK ou SUPER_ADMIN requis)' });

        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Motif requis.' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        // Increment jwtVersion ? invalidates ALL existing tokens
        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { jwtVersion: { increment: 1 } }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'REVOKE_SESSIONS',
                    details: `[CRM360] RÃ©vocation de toutes les sessions pour ${target.phone} (${customerId}). Raison : ${reason}. Par : ${staff.name}`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'Sessions rÃ©voquÃ©es',
                    body: 'Toutes vos sessions actives ont Ã©tÃ© invalidÃ©es par un administrateur. Veuillez vous reconnecter.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: 'Toutes les sessions de l\'utilisateur ont Ã©tÃ© rÃ©voquÃ©es.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/audit --------------------------
router.get('/users/:id/audit', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const { page = '1', limit = '30' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const [rawLogs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where: { details: { contains: customerId } },
                orderBy: { createdAt: 'desc' },
                skip, take: parseInt(limit as string),
                select: { id: true, action: true, details: true, createdAt: true, adminId: true }
            }),
            prisma.auditLog.count({ where: { details: { contains: customerId } } })
        ]);
        const logs = await attachAuditActors(rawLogs);

        res.json({ logs, total, page: parseInt(page as string), pages: Math.ceil(total / parseInt(limit as string)) });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/reclamations -------------------
router.get('/users/:id/reclamations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const isSensitive = hasPermission(staff, 'perm_customer_360_basic');
        const reclamations = await prisma.reclamation.findMany({
            where: { userId: customerId },
            orderBy: { createdAt: 'desc' },
            include: {
                // Notes internes (support/conformitÃ©) masquÃ©es aux rÃ´les guichet/agence
                // (TELLER, BRANCH_MANAGER) â€” mÃªme filtre que la route client (reclamation.ts),
                // absent ici jusqu'Ã  prÃ©sent alors que cette route (perm_customer_view) reste
                // accessible Ã  des rÃ´les bien plus larges que ceux censÃ©s voir ces notes.
                notes: {
                    where: isSensitive ? undefined : { isInternal: false },
                    orderBy: { createdAt: 'asc' },
                    select: { id: true, content: true, isInternal: true, authorName: true, createdAt: true },
                },
                assignee: { select: { name: true, role: true } }
            }
        });

        res.json(reclamations);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- GET /api/admin/users/:id/limits-view --------------------
router.get('/users/:id/limits-view', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const [user, settings] = await Promise.all([
            prisma.user.findUnique({ where: { id: customerId } }),
            prisma.systemSettings.findFirst()
        ]);
        if (!user) return res.status(404).json({ error: 'Client introuvable.' });

        const { LimitEngine } = await import('../services/LimitEngine');
        const computedLimits = await LimitEngine.getApplicableLimits(user, settings);

        const tierName = user.kycLevel === 0 ? 'TIER 0 (Standard)' : user.kycLevel === 1 ? 'TIER 1 (VÃ©rifiÃ©)' : 'TIER 2 (Premium)';

        res.json({
            customerId,
            tierName,
            kycLevel: user.kycLevel,
            kycStatus: user.kycStatus,
            globalLimit: 10000000, // MAXIMUM_ALLOWED_LIMIT
            kycLimitDaily: computedLimits.baseDaily,
            kycLimitMonthly: computedLimits.baseMonthly,
            kycLimitPerTx: computedLimits.basePerTx,
            customDailyLimit: user.customDailyLimit,
            customMonthlyLimit: user.customMonthlyLimit,
            customPerTxLimit: user.customPerTxLimit,
            customLimitExpiresAt: user.customLimitExpiresAt,
            isCustomActive: computedLimits.isCustomActive,
            effectiveDaily: computedLimits.effectiveDaily,
            effectiveMonthly: computedLimits.effectiveMonthly,
            effectivePerTx: computedLimits.effectivePerTx
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/limit-request (Maker/Checker) -
router.post('/users/:id/limit-request', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const customerId = req.params.id as string;
        const { limitType, requestedValue, reason, expiresAt } = req.body;

        const validTypes = ['customDailyLimit', 'customMonthlyLimit', 'customPerTxLimit'];
        if (!validTypes.includes(limitType)) return res.status(400).json({ error: 'Type de limite invalide.' });
        if (!requestedValue || !reason) return res.status(400).json({ error: 'Montant et raison requis.' });
        if (requestedValue > 10000000) return res.status(400).json({ error: 'DÃ©passement du plafond rÃ©glementaire COBAC (10M FCFA).' });

        // Check no PENDING request already exists for this customer + type
        const existingPending = await prisma.settingsApproval.findFirst({
            where: {
                action: 'CUSTOMER_LIMIT_INCREASE',
                makerId: staff.id,
                status: 'PENDING',
                payload: { contains: customerId }
            }
        });
        if (existingPending) return res.status(400).json({ error: 'Une demande est dÃ©jÃ  en attente pour ce client.' });

        const approval = await prisma.settingsApproval.create({
            data: {
                makerId: staff.id,
                action: 'CUSTOMER_LIMIT_INCREASE',
                payload: JSON.stringify({ customerId, limitType, requestedValue, expiresAt: expiresAt || null }),
                reason
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'REQUEST_LIMIT_CHANGE',
                details: `[CRM360] Demande de modification ${limitType} Ã  ${requestedValue} FCFA pour client ${customerId}. Raison: ${reason}`
            }
        });

        res.json({ success: true, approvalId: approval.id, message: 'Demande soumise. En attente de validation Maker/Checker.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});


// ============================================================
// PROMPT 17 ? CUSTOMER 360 : ROUTES ENRICHIES (FREEZE, UNFREEZE, RESET-PIN, REFUND)
// ============================================================

const FREEZE_REASONS = ['SUSPECTED_FRAUD', 'AML_REVIEW', 'SECURITY_ISSUE', 'LEGAL_REQUEST', 'CUSTOMER_REQUEST', 'ACCOUNT_COMPROMISE', 'OTHER'];

// -- POST /api/admin/users/:id/freeze ------------------------
router.post('/users/:id/freeze', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©. (RISK ou SUPER_ADMIN requis)' });

        const { freezeReason, comment } = req.body;
        if (!freezeReason || !FREEZE_REASONS.includes(freezeReason)) {
            return res.status(400).json({ error: `Motif de gel invalide. Valeurs acceptÃ©es : ${FREEZE_REASONS.join(', ')}` });
        }
        if (freezeReason === 'OTHER' && (!comment || comment.trim().length < 10)) {
            return res.status(400).json({ error: 'Un commentaire (min 10 caractÃ¨res) est requis pour le motif OTHER.' });
        }

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });
        if (target.accountStatus === 'FROZEN') return res.status(400).json({ error: 'Le compte est dÃ©jÃ  gelÃ©.' });
        if (target.accountStatus === 'CLOSED') return res.status(400).json({ error: 'Impossible de geler un compte fermÃ©.' });

        const freezeNote = freezeReason === 'OTHER' ? comment : freezeReason;
        const beforeStatus = target.accountStatus;

        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { accountStatus: 'FROZEN', isActive: false, freezeReason: freezeNote }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'FREEZE_ACCOUNT',
                    details: `[CRM360/FREEZE] Compte ${target.phone} (${customerId}) GELÃ‰. Avant : ${beforeStatus}. Motif : ${freezeReason}. Note : ${freezeNote}. Par : ${staff.name} (${staff.role})`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'Compte gelÃ©',
                    body: 'Votre compte Mongain a Ã©tÃ© temporairement gelÃ©. Contactez le support pour plus d\'informations.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: `Compte de ${target.name} gelÃ© (FROZEN). Motif : ${freezeReason}.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/unfreeze ----------------------
router.post('/users/:id/unfreeze', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { justification } = req.body;
        if (!justification || justification.trim().length < 10) {
            return res.status(400).json({ error: 'Justification du dÃ©gel obligatoire (min 10 caractÃ¨res).' });
        }

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });
        if (target.accountStatus !== 'FROZEN') return res.status(400).json({ error: `Le compte n'est pas gelÃ© (statut : ${target.accountStatus}).` });

        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { accountStatus: 'ACTIVE', isActive: true, freezeReason: null, frozenUntil: null }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'UNFREEZE_ACCOUNT',
                    details: `[CRM360/UNFREEZE] Compte ${target.phone} (${customerId}) DÃ‰GELÃ‰. Motif gel initial : ${target.freezeReason || 'N/A'}. Justification dÃ©gel : ${justification}. Par : ${staff.name} (${staff.role})`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'Compte dÃ©gelÃ©',
                    body: 'Votre compte Mongain a Ã©tÃ© rÃ©activÃ©. Vous pouvez maintenant effectuer des transactions.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: `Compte de ${target.name} dÃ©gelÃ© et rÃ©activÃ©.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/reset-pin ---------------------
// R?GLE: Le PIN n'est JAMAIS retourn?. On invalide les tentatives et sessions.
router.post('/users/:id/reset-pin', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_freeze')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©. (RISK ou SUPER_ADMIN requis)' });

        const { reason } = req.body;
        if (!reason || reason.trim().length < 5) return res.status(400).json({ error: 'Motif obligatoire (min 5 caractÃ¨res).' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        // Invalidate PIN lock + bump jwtVersion to revoke all active sessions
        // PIN hash is NEVER exposed ? client must re-create PIN via mobile app
        await prisma.$transaction([
            prisma.user.update({
                where: { id: customerId },
                data: { failedPinAttempts: 0, lockedUntil: null, jwtVersion: { increment: 1 } }
            }),
            prisma.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'RESET_PIN',
                    details: `[CRM360/RESET_PIN] RÃ©initialisation PIN demandÃ©e pour ${target.phone} (${customerId}). Sessions rÃ©voquÃ©es. PIN NON EXPOSÃ‰. Raison : ${reason}. Par : ${staff.name} (${staff.role})`
                }
            }),
            prisma.notification.create({
                data: {
                    userId: customerId,
                    title: 'RÃ©initialisation de votre PIN',
                    body: 'Une rÃ©initialisation de votre PIN a Ã©tÃ© dÃ©clenchÃ©e par le support. Veuillez vous reconnecter et crÃ©er un nouveau PIN.',
                    type: 'SECURITY'
                }
            })
        ]);

        res.json({ success: true, message: 'PIN rÃ©initialisÃ©. Toutes les sessions rÃ©voquÃ©es. Le client doit crÃ©er un nouveau PIN via l\'application.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/refund-request ----------------
// MAKER: Cr?e une demande de remboursement. CHECKER approuve via Settings.
router.post('/users/:id/refund-request', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { transactionId, amount, reason } = req.body;
        if (!transactionId || !amount || !reason) {
            return res.status(400).json({ error: 'transactionId, amount et reason sont requis.' });
        }
        if (amount <= 0) return res.status(400).json({ error: 'Le montant doit Ãªtre positif.' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId }, include: { wallet: true } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        // Verify the transaction belongs to this customer and is COMPLETED
        const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
        if (!tx) return res.status(404).json({ error: 'Transaction introuvable.' });
        if (tx.status !== 'COMPLETED') return res.status(400).json({ error: 'Seules les transactions COMPLETED peuvent Ãªtre remboursÃ©es.' });
        const walletId = target.wallet?.id;
        const isTxOwned = walletId && (tx.senderWalletId === walletId || tx.receiverWalletId === walletId);
        if (!isTxOwned) {
            return res.status(403).json({ error: 'Cette transaction n\'appartient pas Ã  ce client.' });
        }
        if (amount > tx.amount) {
            return res.status(400).json({ error: `Le montant de remboursement (${amount}) ne peut pas dÃ©passer le montant original (${tx.amount}).` });
        }

        // Prevent duplicate refund requests â€” 'PENDING' n'existe pas dans le cycle de vie
        // rÃ©el de RefundRequest (REQUESTED, UNDER_REVIEW, APPROVED, EXECUTED, REJECTED, voir
        // schema.prisma), donc cette vÃ©rification ne matchait jamais rien, et la crÃ©ation
        // ci-dessous plaÃ§ait la demande dans un statut que ni l'Ã©cran Support Center ni la
        // route d'approbation ne reconnaissent : la demande restait bloquÃ©e sans bouton
        // d'action possible, sans jamais aboutir Ã  un remboursement rÃ©el.
        const existing = await prisma.refundRequest.findFirst({
            where: { transactionId, status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'] } }
        });
        if (existing) return res.status(400).json({ error: 'Une demande de remboursement est dÃ©jÃ  en cours pour cette transaction.' });

        const refund = await prisma.refundRequest.create({
            data: {
                transactionId,
                userId: customerId,
                requesterId: staff.id,
                amount: parseFloat(amount),
                refundType: 'FULL',
                reason,
                description: reason
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'REQUEST_REFUND',
                details: `[CRM360/REFUND] Demande de remboursement ${refund.id.substring(0, 8)} crÃ©Ã©e. TX : ${transactionId}. Montant : ${amount} FCFA. Client : ${customerId}. Reason : ${reason}. TX ORIGINALE NON MODIFIÃ‰E.`
            }
        });

        res.json({ success: true, refundId: refund.id, message: 'Demande de remboursement soumise au Checker.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- POST /api/admin/users/:id/support-note ------------------
// Permet au support d'ajouter une note interne au profil d'un client.
router.post('/users/:id/support-note', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { content, reclamationId } = req.body;
        if (!content || content.trim().length < 3) return res.status(400).json({ error: 'Contenu de la note requis (min 3 caractÃ¨res).' });

        const customerId = req.params.id as string;
        const target = await prisma.user.findUnique({ where: { id: customerId } });
        if (!target) return res.status(404).json({ error: 'Client introuvable.' });

        // If tied to a reclamation, add as internal note there
        if (reclamationId) {
            const rec = await prisma.reclamation.findUnique({ where: { id: reclamationId } });
            if (!rec || rec.userId !== customerId) return res.status(404).json({ error: 'RÃ©clamation introuvable pour ce client.' });

            const note = await prisma.reclamationNote.create({
                data: {
                    reclamationId,
                    content,
                    isInternal: true,
                    authorId: staff.id,
                    authorName: `${staff.name} (${staff.role})`
                }
            });
            await prisma.auditLog.create({ data: { adminId: staff.id, action: 'ADD_SUPPORT_NOTE', details: `[CRM360/SUPPORT] Note interne ajoutÃ©e sur ticket ${reclamationId} de client ${customerId}.` } });
            return res.json({ success: true, note });
        }

        // Standalone internal note via AuditLog
        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'INTERNAL_NOTE',
                details: `[CRM360/SUPPORT] Note interne pour client ${customerId}: ${content}`
            }
        });

        res.json({ success: true, message: 'Note interne enregistrÃ©e dans le journal.' });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- PATCH /api/admin/users/:id/reclamation/:recId/status ----
// Permet au support de changer le statut d'un ticket de r?clamation.
router.patch('/users/:id/reclamation/:recId/status', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_customer_360_basic')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const { status, comment } = req.body;
        const validStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
        if (!validStatuses.includes(status)) return res.status(400).json({ error: `Statut invalide. Options: ${validStatuses.join(', ')}` });

        const customerId = req.params.id as string;
        const reclamationId = req.params.recId as string;

        const rec = await prisma.reclamation.findUnique({ where: { id: reclamationId } });
        if (!rec || rec.userId !== customerId) return res.status(404).json({ error: 'RÃ©clamation introuvable.' });

        await prisma.$transaction(async (tx) => {
            await tx.reclamation.update({ where: { id: reclamationId }, data: { status } });
            if (comment) {
                await tx.reclamationNote.create({
                    data: {
                        reclamationId,
                        content: `[Statut: ${status}] ${comment}`,
                        isInternal: true,
                        authorId: staff.id,
                        authorName: `${staff.name} (${staff.role})`
                    }
                });
            }
            await tx.auditLog.create({
                data: {
                    adminId: staff.id,
                    action: 'UPDATE_TICKET_STATUS',
                    details: `[CRM360/SUPPORT] Ticket ${reclamationId} mis Ã  ${status}. Comment : ${comment || 'N/A'}. Par : ${staff.name}`
                }
            });
        });

        res.json({ success: true, message: `Ticket mis Ã  jour : ${status}` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ============================================================
// PROMPT 18 ? SUPPORT CENTRAL & GESTION DES R?CLAMATIONS
// ============================================================

router.get('/reclamations/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // RÃ©gression : n'autorisait que `perm_ticket_resolve` â€” TELLER et RISK, qui n'ont que
        // `perm_ticket_view` (lecture seule) par dÃ©faut, voyaient l'onglet Support (gatÃ© sur
        // perm_ticket_view cÃ´tÃ© App.tsx) mais chaque appel y Ã©chouait en 403.
        if (!staff || !(hasPermission(staff, 'perm_ticket_view') || hasPermission(staff, 'perm_ticket_resolve'))) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const [
            open, inProgress, waitingCustomer, slaBreached, critical, refundPending, fraudCases
        ] = await Promise.all([
            prisma.reclamation.count({ where: { status: 'OPEN' } }),
            prisma.reclamation.count({ where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } }),
            prisma.reclamation.count({ where: { status: 'WAITING_CUSTOMER' } }),
            prisma.reclamation.count({ where: { slaBreached: true, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
            prisma.reclamation.count({ where: { priority: 'CRITICAL', status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
            prisma.refundRequest.count({ where: { status: 'REQUESTED' } }),
            prisma.fraudCase.count({ where: { status: { in: ['OPEN', 'INVESTIGATION'] } } }),
        ]);

        res.json({ open, inProgress, waitingCustomer, slaBreached, critical, refundPending, fraudCases });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/reclamations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !(hasPermission(staff, 'perm_ticket_view') || hasPermission(staff, 'perm_ticket_resolve'))) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const { status, priority, category, query, slaBreached, limit = '100' } = req.query;
        const where: any = {};
        if (status) where.status = status as string;
        if (priority) where.priority = priority as string;
        if (category) where.category = category as string;
        if (slaBreached === 'true') where.slaBreached = true;
        if (query) {
            where.OR = [
                { id: { startsWith: query as string } },
                { title: { contains: query as string, mode: 'insensitive' } },
                { description: { contains: query as string, mode: 'insensitive' } },
                { user: { OR: [{ name: { contains: query as string, mode: 'insensitive' } }, { phone: { contains: query as string } }] } }
            ];
        }

        const tickets = await prisma.reclamation.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit as string),
            include: {
                user: { select: { name: true, phone: true } },
                assignee: { select: { name: true } }
            }
        });

        // Compute real-time SLA breach if not resolved
        const now = Date.now();
        const enriched = tickets.map(t => {
            let isBreached = t.slaBreached;
            if (!isBreached && t.slaDeadline && !['RESOLVED', 'CLOSED'].includes(t.status)) {
                if (t.slaDeadline.getTime() < now) isBreached = true;
            }
            return { ...t, slaBreached: isBreached };
        });

        res.json({ tickets: enriched });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/reclamations/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !(hasPermission(staff, 'perm_ticket_view') || hasPermission(staff, 'perm_ticket_resolve'))) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const ticket = await prisma.reclamation.findUnique({
            where: { id: String(req.params.id) as string },
            include: {
                user: { select: { name: true, phone: true, kycLevel: true, accountStatus: true } },
                assignee: { select: { name: true, role: true } },
                notes: { orderBy: { createdAt: 'asc' } }
            }
        });

        if (!ticket) return res.status(404).json({ error: 'Ticket introuvable.' });

        let transactionDetails = null;
        if (ticket.transactionId) {
            transactionDetails = await prisma.transaction.findUnique({
                where: { id: ticket.transactionId },
                select: { id: true, reference: true, amount: true, fee: true, status: true, type: true, createdAt: true }
            });
        }

        let branchDetails = null;
        if (ticket.branchId) {
            branchDetails = await prisma.branch.findUnique({
                where: { id: ticket.branchId },
                select: { id: true, name: true, code: true, phone: true }
            });
        }

        res.json({ ...ticket, transactionDetails, branchDetails });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.post('/reclamations/:id/notes', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        // `perm_support_note` est la permission dÃ©diÃ©e Ã  cette action (RBAC.ts) â€” tenue par
        // BRANCH_MANAGER/TELLER/SUPPORT_MAKER, qui n'ont pas forcÃ©ment `perm_ticket_resolve`.
        if (!staff || !(hasPermission(staff, 'perm_support_note') || hasPermission(staff, 'perm_ticket_resolve'))) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const { content, isInternal } = req.body;
        if (!content) return res.status(400).json({ error: 'Note vide interdite.' });

        const rec = await prisma.reclamation.findUnique({ where: { id: String(req.params.id) as string } });
        if (!rec) return res.status(404).json({ error: 'Ticket introuvable.' });

        const note = await prisma.reclamationNote.create({
            data: {
                reclamationId: rec.id,
                content,
                isInternal: isInternal ?? true,
                authorId: staff.id,
                authorName: `${staff.name} (${staff.role})`
            }
        });

        // Si note externe (rÃ©ponse au client), update le statut du ticket vers WAITING_CUSTOMER
        let updatedRec = rec;
        if (isInternal === false && rec.status !== 'RESOLVED' && rec.status !== 'CLOSED') {
            updatedRec = await prisma.reclamation.update({ where: { id: rec.id }, data: { status: 'WAITING_CUSTOMER', assigneeId: rec.assigneeId || staff.id } });
            // Sans Ã§a, le client n'a aucun moyen de savoir que le support a rÃ©pondu Ã  son
            // ticket, en dehors d'aller vÃ©rifier l'Ã©cran par hasard.
            await prisma.notification.create({
                data: { userId: rec.userId, title: 'RÃ©ponse du support', body: `Le support a rÃ©pondu Ã  votre ticket Â« ${rec.title} Â».`, type: 'SYSTEM' }
            });
        } else if (!rec.assigneeId) {
            updatedRec = await prisma.reclamation.update({ where: { id: rec.id }, data: { status: 'IN_PROGRESS', assigneeId: staff.id } });
        }

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'ADD_TICKET_NOTE',
                details: `[SUPPORT] Note ajoutÃ©e ticket ${rec.id.substring(0, 8)}. Interne : ${isInternal}.`
            }
        });

        // Renvoie le statut/assignation Ã  jour pour que le panneau ne reste pas figÃ© sur
        // l'ancien Ã©tat (WAITING_CUSTOMER/IN_PROGRESS dÃ©clenchÃ©s automatiquement ci-dessus).
        res.json({ success: true, note, status: updatedRec.status, assigneeId: updatedRec.assigneeId });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.patch('/reclamations/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_ticket_resolve')) return res.status(403).json({ error: 'AccÃ¨s non autorisÃ©.' });

        const { status, priority, category, assigneeId } = req.body;
        const rec = await prisma.reclamation.findUnique({ where: { id: String(req.params.id) as string } });
        if (!rec) return res.status(404).json({ error: 'Ticket introuvable.' });

        const data: any = {};
        if (status) {
            data.status = status;
            if (status === 'RESOLVED') data.resolvedAt = new Date();
            if (status === 'CLOSED') data.closedAt = new Date();
            if (status === 'IN_PROGRESS' && !rec.assigneeId) data.assigneeId = staff.id;
        }
        if (priority) data.priority = priority;
        if (category) data.category = category;
        if (assigneeId) data.assigneeId = assigneeId;

        const updated = await prisma.reclamation.update({ where: { id: rec.id }, data });

        await prisma.auditLog.create({
            data: {
                adminId: staff.id,
                action: 'UPDATE_TICKET',
                details: `[SUPPORT] Ticket ${rec.id.substring(0, 8)} MAJ: status=${status || rec.status} prio=${priority || rec.priority}.`
            }
        });

        // Add an automatic internal note about status change
        if (status && status !== rec.status) {
            await prisma.reclamationNote.create({
                data: {
                    reclamationId: rec.id,
                    content: `[SystÃ¨me] Statut passÃ© de ${rec.status} Ã  ${status}.`,
                    isInternal: true,
                    authorId: staff.id,
                    authorName: `System (${staff.name})`
                }
            });

            if (status === 'RESOLVED') {
                await prisma.notification.create({
                    data: { userId: rec.userId, title: 'Ticket rÃ©solu âœ…', body: `Votre ticket Â« ${rec.title} Â» a Ã©tÃ© marquÃ© comme rÃ©solu.`, type: 'SYSTEM' }
                });
            }
        }

        res.json({ success: true, ticket: updated });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ============================================================
// API MANAGEMENT â€” Gestion des intÃ©grations marchands tiers
// ============================================================

const API_ADMIN_ROLES = ['SUPER_ADMIN', 'COMPLIANCE_CHECKER', 'RISK'];

// POST /api/admin/api-integrations ? G?n?re une nouvelle cl? API (Maker)
router.post('/api-integrations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId! } });
        if (!staff || !API_ADMIN_ROLES.includes(staff.role)) {
            return res.status(403).json({ error: 'AccÃ¨s rÃ©servÃ© Ã  l\'administration.' });
        }

        const { merchantPhone, appName, environment, webhookUrl, permissions, description } = req.body;
        if (!merchantPhone || !appName) {
            return res.status(400).json({ error: 'TÃ©lÃ©phone marchand et nom d\'app requis.' });
        }

        const merchant = await prisma.user.findUnique({ where: { phone: merchantPhone } });
        if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
        if (!['MERCHANT', 'AGENT'].includes(merchant.role)) {
            return res.status(400).json({ error: 'L\'utilisateur n\'est pas un Marchand ou Agent autorisÃ© Ã  recevoir des clÃ©s API.' });
        }

        // G?n?rer le secret en clair (une seule opportunit? de le voir)
        const rawSecret = `sk_${environment === 'LIVE' ? 'live' : 'test'}_${require('crypto').randomBytes(24).toString('hex')}`;
        const secretHash = await require('bcryptjs').hash(rawSecret, 12);
        const publicKey = `pk_${environment === 'LIVE' ? 'live' : 'test'}_${require('crypto').randomBytes(16).toString('hex')}`;

        const integration = await prisma.apiIntegration.create({
            data: {
                merchantId: merchant.id,
                appName,
                environment: environment || 'TEST',
                publicKey,
                secretHash,
                webhookUrl: webhookUrl || null,
                isActive: true,
                permissions: permissions || 'PAYMENTS',
                description: description || null,
            }
        });

        await prisma.apiLog.create({
            data: {
                integrationId: integration.id,
                action: 'GENERATE',
                actorId: staff.id,
                ipAddress: req.ip ? String(req.ip) : null
            }
        });

        await prisma.auditLog.create({
            data: {
                adminId: req.userId!,
                action: 'API_KEY_GENERATED',
                details: JSON.stringify({ integrationId: integration.id, merchantId: merchant.id, appName, environment: environment || 'TEST', actor: staff.name })
            }
        });

        // Secret retourn? UNE SEULE FOIS ? jamais stock? en clair
        return res.status(201).json({
            success: true,
            message: 'ClÃ© API gÃ©nÃ©rÃ©e. Copiez le secret maintenant, il ne sera plus affichÃ©.',
            data: {
                id: integration.id,
                publicKey: integration.publicKey,
                rawSecret,    // ONLY returned here, never stored
                appName: integration.appName,
                environment: integration.environment,
                permissions: integration.permissions,
                merchantName: merchant.name,
                merchantPhone: merchant.phone,
                createdAt: integration.createdAt
            }
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/admin/api-integrations ? Liste toutes les int?grations (sans les secrets)
router.get('/api-integrations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId! } });
        if (!staff || !API_ADMIN_ROLES.includes(staff.role)) {
            return res.status(403).json({ error: 'AccÃ¨s rÃ©servÃ©.' });
        }

        const { merchantId, environment, isActive, page = '1', limit = '25' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const where: any = {};
        if (merchantId) where.merchantId = merchantId;
        if (environment) where.environment = environment;
        if (isActive !== undefined) where.isActive = isActive === 'true';

        const [integrations, total] = await Promise.all([
            prisma.apiIntegration.findMany({
                where,
                include: {
                    merchant: { select: { id: true, name: true, phone: true, role: true } },
                    logs: { orderBy: { createdAt: 'desc' }, take: 5, select: { action: true, actorId: true, createdAt: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit as string)
            }),
            prisma.apiIntegration.count({ where })
        ]);

        // NEVER expose secretHash
        const safe = integrations.map(({ secretHash: _redacted, ...rest }) => ({
            ...rest,
            secretHash: '????????????????????????????????'
        }));

        return res.json({ data: safe, total, page: parseInt(page as string) });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PATCH /api/admin/api-integrations/:id ? Activer/D?sactiver ou changer d'environnement
router.patch('/api-integrations/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId! } });
        if (!staff || !API_ADMIN_ROLES.includes(staff.role)) {
            return res.status(403).json({ error: 'AccÃ¨s rÃ©servÃ©.' });
        }

        const integration = await prisma.apiIntegration.findUnique({ where: { id: String(req.params.id) } });
        if (!integration) return res.status(404).json({ error: 'IntÃ©gration introuvable.' });

        const { isActive, environment, webhookUrl, permissions, description } = req.body;
        const updates: any = {};
        if (isActive !== undefined) updates.isActive = isActive;
        if (environment) updates.environment = environment;
        if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
        if (permissions) updates.permissions = permissions;
        if (description !== undefined) updates.description = description;

        const updated = await prisma.apiIntegration.update({
            where: { id: integration.id },
            data: updates
        });

        const action = isActive !== undefined
            ? (isActive ? 'ACTIVATE' : 'DEACTIVATE')
            : environment ? 'ENV_CHANGE' : 'UPDATE';

        await prisma.apiLog.create({
            data: { integrationId: integration.id, action, actorId: staff.id, ipAddress: req.ip ? String(req.ip) : null }
        });

        await prisma.auditLog.create({
            data: {
                adminId: req.userId!,
                action: `API_KEY_${action}`,
                details: JSON.stringify({ integrationId: integration.id, updates, actor: staff.name })
            }
        });

        const { secretHash: _redacted, ...safe } = updated;
        return res.json({ success: true, data: safe });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/admin/api-integrations/:id/rotate ? Rotation du secret
router.post('/api-integrations/:id/rotate', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId! } });
        if (!staff || !['SUPER_ADMIN'].includes(staff.role)) {
            return res.status(403).json({ error: 'Rotation rÃ©servÃ©e au SUPER_ADMIN.' });
        }

        const integration = await prisma.apiIntegration.findUnique({ where: { id: String(req.params.id) } });
        if (!integration) return res.status(404).json({ error: 'IntÃ©gration introuvable.' });

        const rawSecret = `sk_${integration.environment === 'LIVE' ? 'live' : 'test'}_${require('crypto').randomBytes(24).toString('hex')}`;
        const secretHash = await require('bcryptjs').hash(rawSecret, 12);

        await prisma.apiIntegration.update({
            where: { id: integration.id },
            data: { secretHash, rotatedAt: new Date() }
        });

        await prisma.apiLog.create({
            data: { integrationId: integration.id, action: 'ROTATE', actorId: staff.id, ipAddress: req.ip ? String(req.ip) : null }
        });

        await prisma.auditLog.create({
            data: {
                adminId: req.userId!,
                action: 'API_KEY_ROTATED',
                details: JSON.stringify({ integrationId: integration.id, actor: staff.name, rotatedAt: new Date().toISOString() })
            }
        });

        return res.json({
            success: true,
            message: 'Secret rÃ©gÃ©nÃ©rÃ©. Copiez le nouveau secret maintenant, il ne sera plus affichÃ©.',
            data: { rawSecret }
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// JOURNAL TECHNIQUE DES ERREURS (ErrorLog)
// ==========================================
// Removed ERROR_LOG_ROLES in favor of perm_audit_log_view

router.get('/error-logs', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_audit_log_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, parseInt(req.query.limit as string) || 30);
        const { source, resolved } = req.query;
        const where: any = {};
        if (source) where.source = source as string;
        if (resolved === 'true') where.resolved = true;
        else if (resolved === 'false') where.resolved = false;

        const [logs, total, sources] = await prisma.$transaction([
            prisma.errorLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
            prisma.errorLog.count({ where }),
            prisma.errorLog.findMany({ distinct: ['source'], select: { source: true } }),
        ]);

        return res.json({ logs, total, page, pages: Math.ceil(total / limit) || 1, sources: sources.map(s => s.source) });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.put('/error-logs/:id/resolve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
        if (!staff || !hasPermission(staff, 'perm_audit_log_view')) return res.status(403).json({ error: 'AccÃ¨s refusÃ©.' });

        await prisma.errorLog.update({ where: { id: req.params.id as string }, data: { resolved: true } });
        return res.json({ success: true });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;










