import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';
import { withCache } from '../utils/redis';

const router = express.Router();

// Extrait de la route ci-dessous pour être réellement consommé par credit.ts
// (computeCreditEligibility) — jusqu'ici ce score n'était qu'un affichage analytics
// admin-only ("MOCK ALGORITHM"), jamais lu par aucune décision de prêt réelle. Reste un
// algorithme volontairement simple (KYC, statut de compte, solde) : pas un scoring crédit
// bancaire complet, mais un signal réel de mieux que rien, appliqué de façon identique ici et
// dans GET / ci-dessous (plus de risque de divergence entre l'affichage admin et la décision).
export function computeUserScore(user: { kycLevel: number; accountStatus: string; wallet?: { balance: number } | null }): number {
    let score = 500; // Base Score

    if (user.kycLevel === 1) score += 100;
    if (user.kycLevel === 2) score += 250;

    if (user.accountStatus === 'FROZEN') score -= 300;
    if (user.accountStatus === 'SUSPENDED') score -= 200;

    const balance = user.wallet?.balance || 0;
    if (balance > 100000) score += 100; // High balance adds trust
    else if (balance === 0) score -= 50;

    return score;
}

// GET /api/admin/v6/scoring
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId } });
        if (!admin || !hasPermission(admin, 'perm_analytics_view')) {
            return res.status(403).json({ error: 'Accès refusé. Privilèges manquants.' });
        }

        // Cache the intensive scoring query for 60 seconds
        const scoringData = await withCache('scoring:users', 60, async () => {
            const users = await prisma.user.findMany({
                take: 50,
                orderBy: { createdAt: 'desc' },
                include: {
                    wallet: true,
                }
            });

            return users.map((user: any) => {
                // Algorithme simple (KYC, statut de compte, solde) — désormais réellement
                // consommé par credit.ts (computeCreditEligibility) en plus de cet affichage
                // admin, voir computeUserScore ci-dessus.
                const score = computeUserScore(user);

                let tier = 'Monitoring';
                if (score >= 700) tier = 'Trusted';
                else if (score < 400) tier = 'High Risk';

                return {
                    id: user.id,
                    name: user.name,
                    phone: user.phone,
                    status: user.accountStatus,
                    score,
                    tier
                };
            });
        });

        res.json(scoringData);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
