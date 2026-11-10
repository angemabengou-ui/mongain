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
// DASHBOARD PRÉSIDENT — RECETTES DES GRANDS COMMERÇANTS
// ==========================================
// Vue du Président (rôle PRESIDENT, permission perm_president_view — voir RBAC.ts) sur les
// RECETTES de tous les grands commerçants (merchantTier === 'GIANT'). Volontairement limitée
// à l'argent qui ENTRE : ni sorties, ni frais, ni soldes, ni références/types techniques de
// transaction ne sont renvoyés par ces routes.
//
// Une recette est tout transfert COMPLETED reçu sur le wallet du géant. Parmi elles, une
// "taxe" est un versement d'un marchand affilié (MerchantAffiliation ACCEPTED) — paiement
// manuel ou prélèvement automatique (cron.ts executeAffiliationAutoPay), même définition que
// computeComplianceStatus dans merchant-portal.ts.

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
 * Recettes de la période pour un ensemble de géants : total encaissé, part "taxes" versée
 * par les affiliés, et affiliés en retard sur leur période attendue en cours (même règle que
 * computeComplianceStatus).
 */
async function computeGiantRevenue(giantIds: string[] | null, period: Period, timezone: string) {
    const giants = await prisma.user.findMany({
        where: { role: 'MERCHANT', merchantTier: 'GIANT', ...(giantIds ? { id: { in: giantIds } } : {}) },
        select: {
            id: true, name: true, phone: true,
            wallet: { select: { id: true } },
            giantAffiliations: {
                where: { status: 'ACCEPTED' },
                select: {
                    id: true, expectedFrequency: true, expectedAmount: true,
                    merchant: { select: { id: true, name: true, phone: true, wallet: { select: { id: true } } } },
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

    const [inflows, taxPairs, recentTaxTxs] = giantWalletIds.length === 0 ? [[], [], []] : await Promise.all([
        prisma.transaction.groupBy({
            by: ['receiverWalletId'],
            where: { ...inPeriod, receiverWalletId: { in: giantWalletIds } },
            _sum: { amount: true },
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
                expectedFrequency: a.expectedFrequency,
                expectedAmount: a.expectedAmount,
                taxPaid: tax?._sum.amount || 0,
                taxCount: tax?._count._all || 0,
                compliance,
            };
        });

        const taxIn = affiliates.reduce((s, a) => s + a.taxPaid, 0);
        const totalIn = inRow?._sum.amount || 0;
        return {
            id: g.id,
            name: g.name,
            phone: g.phone,
            walletId: walletId || null,
            affiliates,
            affiliateCount: affiliates.length,
            lateCount: affiliates.filter(a => a.compliance === 'LATE').length,
            totalIn,
            inCount: inRow?._count._all || 0,
            taxIn,
            taxCount: affiliates.reduce((s, a) => s + a.taxCount, 0),
            otherIn: totalIn - taxIn,
        };
    });
}

/**
 * GET /api/admin/giants/overview?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Recettes de TOUS les grands commerçants sur la période, avec totaux.
 */
router.get('/overview', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_president_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const period = resolvePeriod(req.query, timezone);
        if ('error' in period) return res.status(400).json({ error: period.error });

        const giants = await computeGiantRevenue(null, period, timezone);
        const sum = (f: (g: typeof giants[number]) => number) => giants.reduce((s, g) => s + f(g), 0);

        res.json({
            period: { from: period.from, to: period.to },
            totals: {
                giantCount: giants.length,
                affiliateCount: sum(g => g.affiliateCount),
                lateCount: sum(g => g.lateCount),
                totalIn: sum(g => g.totalIn),
                inCount: sum(g => g.inCount),
                taxIn: sum(g => g.taxIn),
                taxCount: sum(g => g.taxCount),
                otherIn: sum(g => g.otherIn),
            },
            giants: giants.map(({ affiliates, walletId, ...g }) => g),
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

/**
 * GET /api/admin/giants/:id?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 * Recettes d'un grand commerçant : affiliés (montant versé, à jour ou non) et liste des
 * encaissements de la période.
 */
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await loadStaffWithPerm(req.userId, 'perm_president_view');
        if (!staff) return res.status(403).json({ error: 'Accès refusé.' });

        const settings = await getSystemSettings();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const period = resolvePeriod(req.query, timezone);
        if ('error' in period) return res.status(400).json({ error: period.error });

        const [giant] = await computeGiantRevenue([req.params.id as string], period, timezone);
        if (!giant) return res.status(404).json({ error: 'Grand commerçant introuvable.' });

        const MAX_PAYMENTS = 500;
        const rows = giant.walletId ? await prisma.transaction.findMany({
            where: { status: 'COMPLETED', createdAt: { gte: period.from, lte: period.to }, receiverWalletId: giant.walletId },
            orderBy: { createdAt: 'desc' },
            take: MAX_PAYMENTS + 1,
            select: {
                id: true, amount: true, createdAt: true,
                senderWallet: { select: { user: { select: { id: true, name: true, phone: true } } } },
            },
        }) : [];
        const affiliateUserIds = new Set(giant.affiliates.map(a => a.merchantId));

        const payments = rows.slice(0, MAX_PAYMENTS).map(t => {
            const payer = t.senderWallet?.user;
            return {
                id: t.id,
                date: t.createdAt,
                amount: t.amount,
                isTax: !!payer && affiliateUserIds.has(payer.id),
                payer: payer ? { name: payer.name, phone: payer.phone } : null,
            };
        });

        const { walletId, ...rest } = giant;
        res.json({
            period: { from: period.from, to: period.to },
            giant: rest,
            payments,
            truncated: rows.length > MAX_PAYMENTS,
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
