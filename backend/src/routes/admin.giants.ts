import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';
import { startOfMonthInTimezone, startOfWeekInTimezone } from '../utils/timezone';
import { getSystemSettings } from './settings';

const router = express.Router();

async function loadStaffWithPerm(userId: string | undefined, perm: Parameters<typeof hasPermission>[1]) {
    const staff = await prisma.staff.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } });
    if (!staff || !hasPermission(staff, perm)) return null;
    return staff;
}

// ==========================================
// SUPERVISION PRÉSIDENTIELLE — GRANDS COMMERÇANTS
// ==========================================
// Vue du Président (staff SUPER_ADMIN, ou tout staff ayant la permission requise) sur les
// ENTRÉES et SORTIES d'argent de tous les grands commerçants (merchantTier === 'GIANT').
//
// Il n'existe pas de type de transaction "taxe" dédié : une taxe est un transfert COMPLETED
// du wallet d'un marchand affilié (MerchantAffiliation ACCEPTED) vers le wallet du géant —
// paiement manuel depuis le mobile ou prélèvement automatique (cron.ts
// executeAffiliationAutoPay). C'est la même définition que computeComplianceStatus dans
// merchant-portal.ts. Toute autre entrée sur le wallet du géant est une "autre entrée" ;
// tout débit de ce wallet (paie employés, retrait agence, transferts...) est une "sortie".

type Period = { from: Date; to: Date };

function parseDay(value: unknown): Date | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const d = new Date(`${value}T00:00:00.000Z`);
    return isNaN(d.getTime()) ? null : d;
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (bornes incluses). Par défaut : du début du mois en cours
// (fuseau système) jusqu'à maintenant.
function resolvePeriod(query: any, timezone: string): Period | { error: string } {
    const from = query.from ? parseDay(query.from) : startOfMonthInTimezone(timezone);
    const toDay = query.to ? parseDay(query.to) : null;
    if (!from || (query.to && !toDay)) return { error: 'Dates invalides (format attendu : AAAA-MM-JJ).' };
    const to = toDay ? new Date(toDay.getTime() + 24 * 60 * 60 * 1000 - 1) : new Date();
    if (from > to) return { error: 'La date de début doit précéder la date de fin.' };
    return { from, to };
}

const pairKey = (sender: string | null, receiver: string) => `${sender}->${receiver}`;

/**
 * Agrège, pour un ensemble de géants, les entrées/sorties de leur wallet principal sur la
 * période, la part "taxes" des entrées, et le nombre d'affiliés en retard de paiement sur
 * leur période attendue en cours (même règle que computeComplianceStatus).
 */
async function computeGiantFlows(giantIds: string[] | null, period: Period, timezone: string) {
    const giants = await prisma.user.findMany({
        where: { role: 'MERCHANT', merchantTier: 'GIANT', ...(giantIds ? { id: { in: giantIds } } : {}) },
        select: {
            id: true, name: true, phone: true, accountStatus: true, createdAt: true,
            wallet: { select: { id: true, balance: true } },
            giantAffiliations: {
                where: { status: 'ACCEPTED' },
                select: {
                    id: true, expectedFrequency: true, expectedAmount: true, autoPayEnabled: true, createdAt: true,
                    merchant: { select: { id: true, name: true, phone: true, accountStatus: true, wallet: { select: { id: true } } } },
                },
            },
        },
        orderBy: { name: 'asc' },
    });

    const giantWalletIds = giants.map(g => g.wallet?.id).filter((id): id is string => !!id);
    const affiliateWalletIds = Array.from(new Set(giants.flatMap(g =>
        g.giantAffiliations.map(a => a.merchant.wallet?.id).filter((id): id is string => !!id))));

    const inPeriod = { status: 'COMPLETED', createdAt: { gte: period.from, lte: period.to } };
    const monthStart = startOfMonthInTimezone(timezone);
    const weekStart = startOfWeekInTimezone(timezone);
    const windowStart = monthStart < weekStart ? monthStart : weekStart;

    const [inflows, outflows, taxPairs, recentTaxTxs] = giantWalletIds.length === 0 ? [[], [], [], []] : await Promise.all([
        prisma.transaction.groupBy({
            by: ['receiverWalletId'],
            where: { ...inPeriod, receiverWalletId: { in: giantWalletIds } },
            _sum: { amount: true },
            _count: { _all: true },
        }),
        prisma.transaction.groupBy({
            by: ['senderWalletId'],
            where: { ...inPeriod, senderWalletId: { in: giantWalletIds } },
            _sum: { amount: true, fee: true },
            _count: { _all: true },
        }),
        affiliateWalletIds.length === 0 ? [] : prisma.transaction.groupBy({
            by: ['senderWalletId', 'receiverWalletId'],
            where: { ...inPeriod, receiverWalletId: { in: giantWalletIds }, senderWalletId: { in: affiliateWalletIds } },
            _sum: { amount: true },
            _count: { _all: true },
        }),
        // Paiements depuis le début de la plus ancienne fenêtre de conformité (mois/semaine en
        // cours), pour savoir quel affilié a déjà payé sur sa période attendue.
        affiliateWalletIds.length === 0 ? [] : prisma.transaction.findMany({
            where: { status: 'COMPLETED', createdAt: { gte: windowStart }, receiverWalletId: { in: giantWalletIds }, senderWalletId: { in: affiliateWalletIds } },
            select: { senderWalletId: true, receiverWalletId: true, createdAt: true },
        }),
    ]);

    const inByWallet = new Map(inflows.map(r => [r.receiverWalletId, r]));
    const outByWallet = new Map(outflows.map(r => [r.senderWalletId, r]));
    const taxByPair = new Map(taxPairs.map(r => [pairKey(r.senderWalletId, r.receiverWalletId), r]));
    const lastPaidByPair = new Map<string, Date>();
    for (const t of recentTaxTxs) {
        const key = pairKey(t.senderWalletId, t.receiverWalletId);
        const prev = lastPaidByPair.get(key);
        if (!prev || t.createdAt > prev) lastPaidByPair.set(key, t.createdAt);
    }

    return giants.map(g => {
        const walletId = g.wallet?.id;
        const inRow = walletId ? inByWallet.get(walletId) : undefined;
        const outRow = walletId ? outByWallet.get(walletId) : undefined;

        const affiliates = g.giantAffiliations.map(a => {
            const merchantWalletId = a.merchant.wallet?.id;
            const key = merchantWalletId && walletId ? pairKey(merchantWalletId, walletId) : null;
            const tax = key ? taxByPair.get(key) : undefined;
            const lastPaid = key ? lastPaidByPair.get(key) : undefined;
            const currentWindow = a.expectedFrequency === 'WEEKLY' ? weekStart : monthStart;
            const compliance: 'OK' | 'LATE' | null = !a.expectedFrequency || !key
                ? null
                : (lastPaid && lastPaid >= currentWindow ? 'OK' : 'LATE');
            return {
                affiliationId: a.id,
                merchantId: a.merchant.id,
                name: a.merchant.name,
                phone: a.merchant.phone,
                accountStatus: a.merchant.accountStatus,
                expectedFrequency: a.expectedFrequency,
                expectedAmount: a.expectedAmount,
                autoPayEnabled: a.autoPayEnabled,
                since: a.createdAt,
                taxPaid: tax?._sum.amount || 0,
                taxCount: tax?._count._all || 0,
                compliance,
            };
        });

        const taxIn = affiliates.reduce((s, a) => s + a.taxPaid, 0);
        const totalIn = inRow?._sum.amount || 0;
        const totalOut = outRow?._sum.amount || 0;
        return {
            id: g.id,
            name: g.name,
            phone: g.phone,
            accountStatus: g.accountStatus,
            createdAt: g.createdAt,
            walletId: walletId || null,
            balance: g.wallet?.balance || 0,
            affiliates,
            affiliateCount: affiliates.length,
            lateCount: affiliates.filter(a => a.compliance === 'LATE').length,
            taxIn,
            taxCount: affiliates.reduce((s, a) => s + a.taxCount, 0),
            otherIn: totalIn - taxIn,
            totalIn,
            inCount: inRow?._count._all || 0,
            totalOut,
            feesOut: outRow?._sum.fee || 0,
            outCount: outRow?._count._all || 0,
            net: totalIn - totalOut,
        };
    });
}

/**
 * GET /api/admin/giants/overview?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Entrées / sorties / taxes de TOUS les grands commerçants sur la période, avec totaux.
 */
router.get('/overview', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_analytics_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const period = resolvePeriod(req.query, timezone);
        if ('error' in period) return res.status(400).json({ error: period.error });

        const giants = await computeGiantFlows(null, period, timezone);
        const sum = (f: (g: typeof giants[number]) => number) => giants.reduce((s, g) => s + f(g), 0);
        const affiliateCount = sum(g => g.affiliateCount);
        const trackedCount = giants.reduce((s, g) => s + g.affiliates.filter(a => a.compliance !== null).length, 0);
        const lateCount = sum(g => g.lateCount);

        res.json({
            period: { from: period.from, to: period.to },
            totals: {
                giantCount: giants.length,
                affiliateCount,
                taxIn: sum(g => g.taxIn),
                taxCount: sum(g => g.taxCount),
                otherIn: sum(g => g.otherIn),
                totalIn: sum(g => g.totalIn),
                totalOut: sum(g => g.totalOut),
                feesOut: sum(g => g.feesOut),
                net: sum(g => g.net),
                balance: sum(g => g.balance),
                lateCount,
                complianceRate: trackedCount > 0 ? Math.round(((trackedCount - lateCount) / trackedCount) * 100) : null,
            },
            giants: giants.map(({ affiliates, walletId, ...g }) => g),
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * GET /api/admin/giants/:id?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Détail d'un grand commerçant : affiliés (taxe payée, conformité) et journal des
 * mouvements entrants/sortants de la période.
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_merchant_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const period = resolvePeriod(req.query, timezone);
        if ('error' in period) return res.status(400).json({ error: period.error });

        const [giant] = await computeGiantFlows([req.params.id as string], period, timezone);
        if (!giant) return res.status(404).json({ error: 'Grand commerçant introuvable.' });

        const MAX_MOVEMENTS = 500;
        const rows = giant.walletId ? await prisma.transaction.findMany({
            where: {
                status: 'COMPLETED',
                createdAt: { gte: period.from, lte: period.to },
                OR: [{ receiverWalletId: giant.walletId }, { senderWalletId: giant.walletId }],
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_MOVEMENTS + 1,
            select: {
                id: true, amount: true, fee: true, type: true, reference: true, createdAt: true,
                senderWalletId: true, receiverWalletId: true,
                senderWallet: { select: { user: { select: { id: true, name: true, phone: true } } } },
                receiverWallet: { select: { user: { select: { id: true, name: true, phone: true } } } },
            },
        }) : [];
        const affiliateUserIds = new Set(giant.affiliates.map(a => a.merchantId));

        const movements = rows.slice(0, MAX_MOVEMENTS).map(t => {
            const direction = t.receiverWalletId === giant.walletId ? 'IN' : 'OUT';
            const counterparty = direction === 'IN' ? t.senderWallet?.user : t.receiverWallet?.user;
            const isTax = direction === 'IN' && !!counterparty && affiliateUserIds.has(counterparty.id);
            return {
                id: t.id,
                date: t.createdAt,
                direction,
                category: isTax ? 'TAX' : direction,
                type: t.type,
                amount: t.amount,
                fee: t.fee,
                reference: t.reference,
                counterparty: counterparty ? { name: counterparty.name, phone: counterparty.phone } : null,
            };
        });

        const { walletId, ...rest } = giant;
        res.json({
            period: { from: period.from, to: period.to },
            giant: rest,
            movements,
            truncated: rows.length > MAX_MOVEMENTS,
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
