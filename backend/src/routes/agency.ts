import express from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { CashOperationService } from '../services/CashOperationService';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';
import { generateReference } from '../utils/reference';

const router = express.Router();

// Middleware strict pour s'assurer que c'est un agent d'agence
//
// Un SUPER_ADMIN de siège n'a généralement pas de branchId propre (compte HQ) et doit
// pouvoir agir sur N'IMPORTE QUELLE agence : plutôt que de le bloquer comme les rôles
// opérationnels (TELLER/BRANCH_MANAGER, intrinsèquement rattachés à leur succursale), on
// lui permet de préciser explicitement `branchId` (body ou query) à chaque appel.
const agencyMiddleware = async (req: AuthRequest, res: any, next: any) => {
    try {
        const user = await prisma.staff.findUnique({ where: { id: req.userId }, include: { branch: true } });
        if (!user || !user.isActive) {
            return res.status(403).json({ error: 'Accès restreint aux agents en succursale actifs.' });
        }

        if (user.role === 'SUPER_ADMIN') {
            const explicitBranchId = (req.body && req.body.branchId) || (req.query && req.query.branchId);
            (req as any).branchId = user.branchId || explicitBranchId || undefined;
        } else {
            if (!user.branchId) {
                return res.status(403).json({ error: 'Accès restreint aux agents en succursale actifs.' });
            }
            (req as any).branchId = user.branchId;
        }

        (req as any).staff = user;
        next();
    } catch (e: any) {
        console.error('Erreur agencyMiddleware:', e);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
};

router.use(authMiddleware);
router.use(agencyMiddleware);

// Un SUPER_ADMIN sans branchId propre doit préciser explicitement quelle agence il
// cible (body.branchId ou ?branchId=). Les autres rôles ont toujours un branchId
// résolu par agencyMiddleware et ne sont jamais bloqués ici.
const requireBranchId = (req: AuthRequest, res: any, next: any) => {
    if (!(req as any).branchId) {
        return res.status(400).json({ error: 'branchId requis (précisez l\'agence ciblée).' });
    }
    next();
};

// =========================================================================
// SESSIONS DE CAISSE
// =========================================================================

// 1. Démarrer une session (OVERLAP protection)
router.post('/sessions/open', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        if (!hasPermission(staff, 'perm_cash_session_open')) {
            return res.status(403).json({ error: 'Vous n\'avez pas les droits d\'ouverture de session.' });
        }

        const branchId = (req as any).branchId;
        const initialCash = parseFloat(req.body.initialCash) || 0;

        // Check-then-create sans verrou : deux ouvertures concurrentes pour le même teller
        // (double-tap, retry réseau) passaient toutes deux le `findFirst` avant qu'aucune
        // n'ait créé sa ligne, produisant deux CashSession OPEN simultanées. Pas de contrainte
        // unique possible côté schéma (un teller a légitimement plusieurs sessions CLOSED dans
        // le temps, seul un OPEN à la fois est interdit) — verrou advisory Postgres scopé à la
        // transaction (auto-libéré au commit/rollback) pour sérialiser par teller à la place.
        // Sans ce verrou, CashOperationService.executeCashIn/executeCashOut et POST
        // /sessions/close (findFirst non ordonné) pouvaient chacun sélectionner une session
        // OPEN différente, fragmentant le suivi de caisse et laissant l'une des deux bloquée
        // OPEN indéfiniment (jamais sélectionnée à la clôture).
        let session;
        try {
            session = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.userId!}))`;
                const active = await tx.cashSession.findFirst({
                    where: { tellerId: req.userId, status: 'OPEN' }
                });
                if (active) throw new Error('DUPLICATE_SESSION');

                return tx.cashSession.create({
                    data: {
                        branchId,
                        tellerId: req.userId!,
                        initialCash,
                        status: 'OPEN'
                    }
                });
            });
        } catch (e: any) {
            if (e.message === 'DUPLICATE_SESSION') return res.status(400).json({ error: 'Vous avez déjà une session de caisse ouverte.' });
            throw e;
        }

        await prisma.auditLog.create({
            data: { adminId: req.userId!, action: 'OPEN_SESSION', details: `Ouverture caisse agence. Initial: ${initialCash}` }
        });

        res.json({ success: true, session });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 2. Clôturer une session avec rapprochement
router.post('/sessions/close', async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        if (!hasPermission(staff, 'perm_cash_session_close')) {
            return res.status(403).json({ error: 'Vous n\'avez pas les droits de clôture de session.' });
        }

        const finalCashDeclared = parseFloat(req.body.finalCash);
        if (isNaN(finalCashDeclared)) return res.status(400).json({ error: 'Final cash invalide.' });

        const active = await prisma.cashSession.findFirst({
            where: { tellerId: req.userId, status: 'OPEN' }
        });
        if (!active) return res.status(400).json({ error: 'Aucune session de caisse active.' });

        // Calcul Rapprochement
        // finalCash = initial + cashIn(cash in physical) - cashOut(cash given away)
        const expectedCash = active.initialCash + active.totalCashInValue - active.totalCashOutValue;
        const discrepancy = finalCashDeclared - expectedCash;
        const reason = req.body.reason || (discrepancy !== 0 ? 'ECART NON JUSTIFIÉ' : null);

        // Réclamation atomique avant toute écriture dérivée : un double-clic sur "Clôturer"
        // (le bouton n'a pas de garde `disabled` côté TellerTerminal.tsx) lançait deux requêtes
        // qui trouvaient toutes deux la même session encore OPEN via le `findFirst` ci-dessus,
        // et créaient chacune leur propre ReconciliationCase pour le MÊME écart — même pattern
        // que la course sur /sessions/open (voir commentaire ci-dessus).
        const claim = await prisma.cashSession.updateMany({
            where: { id: active.id, status: 'OPEN' },
            data: {
                status: 'CLOSED',
                closedAt: new Date(),
                finalCash: finalCashDeclared,
                discrepancy,
                discrepancyReason: discrepancy !== 0 ? reason : null
            }
        });
        if (claim.count === 0) return res.status(400).json({ error: 'Cette session vient d\'être clôturée.' });
        const closed = await prisma.cashSession.findUnique({ where: { id: active.id } });

        // Un écart déclaré ici était enregistré sur la session (discrepancy/discrepancyReason)
        // mais aucun ReconciliationCase n'était JAMAIS créé nulle part dans le code — la page
        // "Réconciliation" du portail admin (GET /reconciliation ci-dessous, et treasury.ts qui
        // liste/résout des ReconciliationCase) restait donc éternellement vide, même après des
        // clôtures avec des écarts non justifiés.
        if (discrepancy !== 0) {
            await prisma.reconciliationCase.create({
                data: {
                    reference: generateReference('REC'),
                    branchId: active.branchId,
                    expectedAmount: expectedCash,
                    reportedAmount: finalCashDeclared,
                    difference: discrepancy,
                    status: 'UNDER_REVIEW',
                    investigation: reason,
                }
            });
        }

        await prisma.auditLog.create({
            data: { adminId: req.userId!, action: 'CLOSE_SESSION', details: `Clôture caisse. Ecart: ${discrepancy}` }
        });

        res.json({ success: true, session: closed });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 3. Obtenir mes sessions ou celles de mon agence
router.get('/sessions', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        const branchId = (req as any).branchId;

        let whereClause: any = { branchId };
        if (!hasPermission(staff, 'perm_branch_manage')) {
            whereClause.tellerId = req.userId; // Teller ne voit que les siennes
        }

        const sessions = await prisma.cashSession.findMany({
            where: whereClause,
            include: { teller: { select: { name: true } } },
            orderBy: { openedAt: 'desc' }
        });

        res.json(sessions);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 4. Obtenir les infos globales de l'agence (Dashboard)
router.get('/info', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const branchId = (req as any).branchId;
        const [branch, myActiveSession] = await Promise.all([
            prisma.branch.findUnique({
                where: { id: branchId },
                include: {
                    wallet: true,
                    staff: { select: { id: true, name: true, role: true } },
                    targetTreasuryRequests: { orderBy: { createdAt: 'desc' }, take: 20 },
                    sessions: { orderBy: { openedAt: 'desc' }, take: 10, include: { teller: { select: { id: true, name: true } } } }
                }
            }),
            // Recherche dédiée, indépendante du `take: 10` ci-dessus : BranchDashboard.tsx
            // dérivait jusqu'ici "ma session active" en cherchant dans ces 10 dernières
            // sessions DE TOUTE L'AGENCE — dans une agence à forte activité (10+ ouvertures
            // par d'autres caissiers depuis la mienne), ma propre session, pourtant bien
            // ouverte, sortait de cette fenêtre. L'écran affichait alors "guichet fermé" à
            // tort, et une tentative de réouverture échouait avec un message déroutant
            // ("vous avez déjà une session ouverte") pour un caissier qui voyait, lui, un
            // formulaire d'OUVERTURE.
            prisma.cashSession.findFirst({
                where: { tellerId: req.userId, status: 'OPEN' },
                include: { teller: { select: { id: true, name: true } } }
            })
        ]);
        if (!branch) return res.status(404).json({ error: 'Agence introuvable.' });

        res.json({ ...branch, myActiveSession });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// =========================================================================
// OPERATIONS FINANCIERES (CASH-IN & CASH-OUT)
// =========================================================================

// 4. Cash-In (Dépôt) — avec idempotence + branchId/tellerId
// 4. Cash-In (Dépôt) — via CashOperationService
router.post('/cash-in', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        if (!hasPermission(staff, 'perm_cash_in')) {
            return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à faire des dépôts.' });
        }
        const branchId = (req as any).branchId;
        const { userPhone, amount, idempotencyKey, clientPhone } = req.body;
        const phone = userPhone || clientPhone;

        // `parseFloat(undefined)` / `parseFloat("abc")` renvoient NaN, que le contrôle
        // `amount <= 0` de CashOperationService laisse passer (NaN <= 0 vaut false en JS) —
        // un corps de requête sans `amount` (ou invalide) échouait alors plus loin sur une
        // erreur Prisma technique et incompréhensible pour le caissier, au lieu d'un message
        // de validation clair ici.
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }

        const transaction = await CashOperationService.executeCashIn({
            amount: parsedAmount,
            clientPhone: phone,
            tellerId: req.userId!,
            branchId,
            idempotencyKey,
            io: req.app.get('io')
        });

        res.json({ success: true, message: 'Cash-In exécuté avec succès.', transaction });
    } catch (e: any) { res.status(400).json({ error: friendlyErrorMessage(e) }); }
});

// 5. Cash-Out (Retrait Guichet) — via CashOperationService
router.post('/cash-out', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        if (!hasPermission(staff, 'perm_cash_out')) {
            return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à valider des retraits.' });
        }
        const branchId = (req as any).branchId;
        const { userPhone, amount, idempotencyKey, clientPhone } = req.body;
        const phone = userPhone || clientPhone;

        // Même garde qu'en Cash-In ci-dessus (voir commentaire) : NaN passait le contrôle
        // `amount <= 0` de CashOperationService.
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Montant invalide.' });
        }

        const transaction = await CashOperationService.executeCashOut({
            amount: parsedAmount,
            clientPhone: phone,
            tellerId: req.userId!,
            branchId,
            idempotencyKey
        });

        res.json({ success: true, message: 'Cash-Out autorisé, veuillez remettre les espèces au client.', transaction, fee: transaction.fee });
    } catch (e: any) { res.status(400).json({ error: friendlyErrorMessage(e) }); }
});

// 5bis. Cash-Out par Code Secret — le client génère un code (POST /api/wallet/generate-withdraw-code),
// l'agent le saisit ici avec le téléphone du client pour valider et exécuter le retrait.
router.post('/cash-out-code', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        if (!hasPermission(staff, 'perm_cash_out')) {
            return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à valider des retraits par code.' });
        }
        const branchId = (req as any).branchId;
        const { clientPhone, code, idempotencyKey } = req.body;
        if (!clientPhone || !code) return res.status(400).json({ error: 'Téléphone client et code requis.' });

        const client = await prisma.user.findUnique({ where: { phone: clientPhone } });
        if (!client) return res.status(404).json({ error: 'Client introuvable.' });

        const verif = await prisma.verificationCode.findUnique({ where: { phone_purpose: { phone: client.phone, purpose: 'WITHDRAW_CODE' } } });
        if (!verif || verif.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Code expiré ou introuvable. Demandez au client d\'en générer un nouveau.' });
        }

        const [storedCode, storedAmount] = verif.code.split(':');
        if (storedCode !== String(code)) return res.status(400).json({ error: 'Code incorrect.' });

        const amount = parseFloat(storedAmount);
        if (!amount || amount <= 0) return res.status(400).json({ error: 'Code invalide (montant illisible).' });

        // Réclamé (supprimé) AVANT d'exécuter le retrait, pas après : la version précédente
        // lisait le code (`findUnique` ci-dessus, sans verrou), exécutait le Cash-Out, PUIS
        // supprimait le code — deux appels concurrents pour le même code (deux agents, ou un
        // simple retry réseau sans idempotencyKey, optionnel) passaient tous deux la lecture
        // avant qu'aucun n'ait supprimé, et déclenchaient chacun un décaissement complet. Prisma
        // lève une erreur (P2025) si la ligne a déjà été supprimée par l'appel concurrent — seul
        // le premier arrivé peut donc exécuter le retrait.
        try {
            await prisma.verificationCode.delete({ where: { phone_purpose: { phone: client.phone, purpose: 'WITHDRAW_CODE' } } });
        } catch {
            return res.status(400).json({ error: 'Ce code a déjà été utilisé ou a expiré.' });
        }

        const transaction = await CashOperationService.executeCashOut({
            amount,
            clientPhone: client.phone,
            tellerId: req.userId!,
            branchId,
            idempotencyKey
        });

        res.json({ success: true, message: 'Retrait par code validé, veuillez remettre les espèces au client.', transaction, fee: transaction.fee });
    } catch (e: any) { res.status(400).json({ error: friendlyErrorMessage(e) }); }
});

// =========================================================================
// MANAGER OPERATIONS (FUNDING & RECONCILIATION)
// =========================================================================

// 6. Demande de Financement (Treasury Request)
router.post('/treasury-requests', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        const branchId = (req as any).branchId;
        if (!hasPermission(staff, 'perm_branch_manage')) return res.status(403).json({ error: 'Seul le Manager (perm_branch_manage) peut demander un financement.' });

        const schema = z.object({ amount: z.number().positive(), reason: z.string().min(3) });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

        const request = await prisma.treasuryRequest.create({
            data: {
                reference: 'REQ-' + Date.now(),
                type: 'ALLOCATION',
                amount: parsed.data.amount,
                reason: parsed.data.reason,
                makerId: req.userId!,
                targetBranchId: branchId,
                status: 'PENDING'
            }
        });
        res.json({ success: true, request });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 7. Vue Rapprochement (Reconciliation de fin de journée)
router.get('/reconciliation', requireBranchId, async (req: AuthRequest, res) => {
    try {
        const staff = (req as any).staff;
        const branchId = (req as any).branchId;
        if (!hasPermission(staff, 'perm_branch_manage')) return res.status(403).json({ error: 'Seul le Manager (perm_branch_manage) peut consulter la réconciliation.' });

        // Sessions CLOSED, pas OPEN : une session encore ouverte n'a ni `finalCash` déclaré ni
        // `discrepancy` calculé (les deux ne sont posés qu'à la clôture, voir POST
        // /sessions/close ci-dessus) — le rapprochement "de fin de journée" ne porte de sens
        // que sur des caisses déjà clôturées, dont on peut comparer l'écart réellement déclaré.
        const sessions = await prisma.cashSession.findMany({
            where: { branchId, status: 'CLOSED' },
            include: { teller: { select: { name: true } } },
            orderBy: { closedAt: 'desc' },
            take: 30
        });

        const discrepancyReport = sessions.map(s => {
            const expectedCash = s.initialCash + s.totalCashInValue - s.totalCashOutValue;
            return {
                sessionId: s.id,
                tellerName: s.teller.name,
                initialCash: s.initialCash,
                cashIn: s.totalCashInValue,
                cashOut: s.totalCashOutValue,
                expectedCash,
                // Auparavant absents de la réponse malgré le nom "discrepancyReport" : la
                // vue ne montrait jamais l'écart réellement déclaré par le caissier.
                finalCash: s.finalCash,
                discrepancy: s.discrepancy,
                discrepancyReason: s.discrepancyReason,
                closedAt: s.closedAt
            };
        });

        res.json({ success: true, discrepancyReport });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

export default router;
