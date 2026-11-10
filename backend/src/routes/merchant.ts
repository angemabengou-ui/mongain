import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import { startOfDayInTimezone } from '../utils/timezone';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = express.Router();

// Erreur de validation métier (montant/compte source invalides, solde insuffisant) portée
// par createMerchantPayoutRequest ci-dessous — un statut HTTP dédié plutôt qu'un simple
// `throw new Error(...)`, pour que les DEUX appelants (cette route mobile, et
// routes/merchant-portal.ts POST /withdraw-to-agency côté géant) retombent sur le bon code
// HTTP (400) sans dupliquer la logique de validation.
export class PayoutValidationError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// Logique métier factorée hors de la route mobile ci-dessous pour être réutilisée TELLE
// QUELLE par le portail web des marchands géants (routes/merchant-portal.ts,
// POST /withdraw-to-agency, derrière authMerchantPortal) : un géant garde role='MERCHANT'
// (voir schema.prisma), donc MerchantPayoutRequest — déjà générique (sourceAccount
// SALES/COMMISSION, exécuté manuellement par le staff via admin.merchants.ts sans jamais
// filtrer par merchantTier) — est exactement le mécanisme "retrait vers agence" existant à
// réutiliser plutôt que d'inventer un nouveau modèle/une nouvelle logique de débit.
export async function createMerchantPayoutRequest(
    user: { id: string; wallet?: { balance: number } | null; commissionWallet?: { balance: number } | null },
    body: any
) {
    const { sourceAccount, amount, note } = body || {};
    if (sourceAccount !== 'SALES' && sourceAccount !== 'COMMISSION') {
        throw new PayoutValidationError(400, "sourceAccount doit être 'SALES' ou 'COMMISSION'.");
    }
    // Le FCFA n'a aucune sous-unité — arrondi ici, sinon l'écriture Prisma échoue sur un
    // montant décimal (MerchantPayoutRequest.amount est Int).
    const parsedAmount = Math.round(Number(amount));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new PayoutValidationError(400, 'Montant invalide.');
    }

    const available = sourceAccount === 'SALES' ? (user.wallet?.balance || 0) : (user.commissionWallet?.balance || 0);
    if (parsedAmount > available) {
        throw new PayoutValidationError(400, 'Solde insuffisant sur le compte sélectionné.');
    }

    return prisma.merchantPayoutRequest.create({
        data: {
            merchantId: user.id,
            sourceAccount,
            amount: parsedAmount,
            note: note ? String(note).trim() : null
        }
    });
}

async function loadMerchant(userId: string | undefined) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true, commissionWallet: true } });
    if (!user || user.role !== 'MERCHANT') return null;
    return user;
}

router.get('/stats', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        // Minuit dans le fuseau configuré (Africa/Libreville par défaut, UTC+1), pas minuit
        // heure serveur (UTC sur Render) — sinon une vente entre 00h00 et 00h59 heure locale
        // gabonaise disparaissait de "todaySales" jusqu'au lendemain (comptée sur J-1 côté UTC).
        const settings = await getSystemSettings();
        const today = startOfDayInTimezone(settings?.timezone || 'Africa/Libreville');

        const salesFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { not: { startsWith: 'REWARD-' } } };

        // La commission part désormais sur commissionWallet (voir wallet.ts /client-initiated-withdraw
        // et merchantService.ts). Repli sur l'ancien filtre REWARD- (wallet principal) pour les
        // commissions historiques créditées avant cette séparation, sinon elles disparaîtraient
        // des totaux "all-time" du jour au lendemain.
        const legacyRewardFilter = { receiverWalletId: user.wallet!.id, status: 'COMPLETED', reference: { startsWith: 'REWARD-' } };
        const commissionFilter = user.commissionWallet ? { receiverWalletId: user.commissionWallet.id, status: 'COMPLETED' } : null;

        const [todaySales, allTimeSales, todayLegacyRewards, allTimeLegacyRewards, todayCommission, allTimeCommission] = await Promise.all([
            prisma.transaction.aggregate({ where: { ...salesFilter, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
            prisma.transaction.aggregate({ where: salesFilter, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: { ...legacyRewardFilter, createdAt: { gte: today } }, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: legacyRewardFilter, _sum: { amount: true } }),
            commissionFilter ? prisma.transaction.aggregate({ where: { ...commissionFilter, createdAt: { gte: today } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: 0 } }),
            commissionFilter ? prisma.transaction.aggregate({ where: commissionFilter, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: 0 } })
        ]);

        return res.json({
            balance: user.wallet!.balance,
            commissionBalance: user.commissionWallet?.balance || 0,
            todaySalesAmount: todaySales._sum.amount || 0,
            todaySalesCount: todaySales._count.id || 0,
            allTimeSalesAmount: allTimeSales._sum.amount || 0,
            todayCommission: (todayLegacyRewards._sum.amount || 0) + (todayCommission._sum.amount || 0),
            allTimeCommission: (allTimeLegacyRewards._sum.amount || 0) + (allTimeCommission._sum.amount || 0)
        });

    } catch (error: any) {
        return res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.get('/transactions', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const category = (req.query.category as string) || undefined;
        const walletIds = category === 'COMMISSION'
            ? [user.commissionWallet?.id].filter(Boolean) as string[]
            : category === 'SALES'
                ? [user.wallet!.id]
                : [user.wallet!.id, user.commissionWallet?.id].filter(Boolean) as string[];

        const txs = await prisma.transaction.findMany({
            where: {
                OR: walletIds.flatMap(id => [{ receiverWalletId: id }, { senderWalletId: id }])
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                senderWallet: { include: { user: { select: { name: true, phone: true } } } },
                receiverWallet: { include: { user: { select: { name: true, phone: true } } } }
            }
        });

        res.json(txs);
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// Nouveau flux de retrait dédié — le marchand demande à sortir de l'argent de l'un de ses
// deux soldes ; le débit réel n'a lieu qu'à l'exécution côté staff (admin.merchants.ts),
// pas ici (ce contrôle est purement informatif, pour éviter une demande manifestement
// impossible dès la saisie).
router.post('/payouts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const payout = await createMerchantPayoutRequest(user, req.body);
        res.json({ success: true, data: payout });
    } catch (error: any) {
        if (error instanceof PayoutValidationError) {
            return res.status(error.status).json({ error: error.message });
        }
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.get('/payouts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await loadMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Accès refusé.' });

        const payouts = await prisma.merchantPayoutRequest.findMany({
            where: { merchantId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        res.json(payouts);
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// ==========================================
// AFFILIATIONS (MARCHAND GÉANT <-> MARCHAND) — CÔTÉ MARCHAND AFFILIÉ, MOBILE
// ==========================================
// Consentement explicite requis : un géant (routes/merchant-portal.ts) ne peut pas suivre les
// versements d'un marchand sans que celui-ci l'accepte depuis son mobile — voir
// schema.prisma, MerchantAffiliation. authMiddleware (pas authMerchantPortal) : ce marchand
// répond depuis l'app mobile normale, il n'a pas de session portail.

router.get('/affiliations', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const affiliations = await prisma.merchantAffiliation.findMany({
            where: { merchantId: req.userId },
            orderBy: { createdAt: 'desc' },
            include: { giant: { select: { name: true, phone: true } } }
        });

        res.json({ success: true, affiliations });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

router.post('/affiliations/:id/respond', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { accept } = req.body;
        if (typeof accept !== 'boolean') {
            return res.status(400).json({ error: 'Le paramètre accept (booléen) est requis.' });
        }

        const affiliationId = req.params.id as string;
        const affiliation = await prisma.merchantAffiliation.findUnique({
            where: { id: affiliationId },
            include: { giant: { select: { id: true, name: true, pushToken: true } } }
        });

        if (!affiliation) return res.status(404).json({ error: 'Affiliation introuvable.' });
        // 403 (pas 404) : la ligne existe bien, mais n'appartient pas à ce marchand — cohérent
        // avec le flux de test attendu (mauvais utilisateur -> 403).
        if (affiliation.merchantId !== req.userId) return res.status(403).json({ error: 'Accès refusé.' });
        if (affiliation.status !== 'PENDING') return res.status(400).json({ error: 'Cette demande a déjà été traitée.' });

        const updated = await prisma.merchantAffiliation.update({
            where: { id: affiliation.id },
            data: { status: accept ? 'ACCEPTED' : 'REJECTED', respondedAt: new Date() }
        });

        const title = accept ? 'Affiliation acceptée' : 'Affiliation refusée';
        const body = `Le marchand a ${accept ? 'accepté' : 'refusé'} votre demande d'affiliation.`;
        await prisma.notification.create({ data: { userId: affiliation.giant.id, title, body, type: 'INFO' } });
        if (affiliation.giant.pushToken) {
            await sendPush(affiliation.giant.pushToken, title, body);
        }

        res.json({ success: true, affiliation: updated });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

// PATCH /api/merchant/affiliations/:id/auto-pay
// Permet au petit marchand d'activer/désactiver le prélèvement automatique pour une affiliation
router.patch('/affiliations/:id/auto-pay', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { autoPayEnabled } = req.body;
        if (typeof autoPayEnabled !== 'boolean') {
            return res.status(400).json({ error: 'Le paramètre autoPayEnabled (booléen) est requis.' });
        }

        const affiliationId = req.params.id as string;
        const affiliation = await prisma.merchantAffiliation.findUnique({
            where: { id: affiliationId },
        });

        if (!affiliation) return res.status(404).json({ error: 'Affiliation introuvable.' });
        if (affiliation.merchantId !== req.userId) return res.status(403).json({ error: 'Accès refusé.' });
        if (affiliation.status !== 'ACCEPTED') return res.status(400).json({ error: 'Cette affiliation n\'est pas active.' });

        const updated = await prisma.merchantAffiliation.update({
            where: { id: affiliation.id },
            data: { autoPayEnabled }
        });

        res.json({ success: true, affiliation: updated });
    } catch (error: any) {
        res.status(500).json({ error: friendlyErrorMessage(error) });
    }
});

export default router;
