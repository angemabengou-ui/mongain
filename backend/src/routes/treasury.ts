import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { hasPermission } from '../services/RBAC';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

/**
 * MONGain V6 : CORE TREASURY ENGINE
 * - Routes protégées par SUPER_ADMIN.
 * - Séparation stricte Maker/Checker.
 * - Idempotence et Transactions Atomiques
 */

// 0. Récupérer l'Overview Global de Trésorerie
router.get('/overview', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!admin || !hasPermission(admin, 'perm_treasury_view')) {
            return res.status(403).json({ error: 'Accès refusé. Permission perm_treasury_view manquante.' });
        }

        const [branches, pendingReqs, centralTreasury, systemWallets] = await Promise.all([
            prisma.branch.findMany({ include: { wallet: true } }),
            prisma.treasuryRequest.count({ where: { status: 'PENDING' } }),
            getCentralTreasury(),
            // Comptes techniques (Passerelle PVit, Corporate, Coffre Tontine, ...) : ce sont
            // des contreparties comptables internes, pas de l'argent détenu par un client —
            // sans cette exclusion, ils gonflaient silencieusement "Portefeuilles Clients"
            // (ex: la Passerelle Externe est pré-provisionnée à ~1 milliard FCFA à sa
            // création, indissociable d'un vrai solde client dans le calcul précédent).
            prisma.wallet.findMany({ where: { user: { role: 'ADMIN' } }, select: { id: true, balance: true } })
        ]);

        const reserveBalance = centralTreasury.wallet.balance;
        // Le Siège n'est plus qu'une agence normale depuis la séparation de la Trésorerie
        // Centrale : sa liquidité (électronique et physique) compte désormais comme celle
        // de n'importe quelle autre agence, plus d'exclusion spéciale.
        const totalAgencyElectronic = branches.reduce((acc, b) => acc + (b.wallet?.balance || 0), 0);
        const totalPhysicalVault = branches.reduce((acc, b) => acc + (b.balance || 0), 0);

        const systemAccountsBalance = systemWallets.reduce((acc, w) => acc + (w.balance || 0), 0);

        // Sum of all wallets excluding Central Treasury, Branch wallets and system accounts
        const exclusions = [
            ...branches.map(b => b.walletId).filter(Boolean),
            centralTreasury.walletId,
            ...systemWallets.map(w => w.id)
        ];

        const clientWalletsAgg = await prisma.wallet.aggregate({
            where: { id: { notIn: exclusions as string[] } },
            _sum: { balance: true }
        });
        const clientWalletsBalance = clientWalletsAgg._sum.balance || 0;

        const totalMoneySupply = reserveBalance + totalAgencyElectronic + clientWalletsBalance + systemAccountsBalance;

        res.json({
            moneySupply: totalMoneySupply,
            reserveBalance,
            totalAgencyElectronic,
            totalPhysicalVault,
            clientWalletsBalance,
            systemAccountsBalance,
            pendingRequestsCount: pendingReqs,
            escrowBalance: 0 // Mock feature for Escrow until implemented
        });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 1. Lister les requêtes de Trésorerie
router.get('/requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        // Même whitelist que POST /requests ci-dessous — sans elle, tout staff actif (y
        // compris TELLER) lisait la liquidité et le calendrier d'approvisionnement de
        // toutes les agences, une information directement exploitable pour un vol physique.
        const admin = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, isActive: true, permissions: true, permissionsCustomized: true } });
        if (!admin || admin.isActive === false || !hasPermission(admin, 'perm_treasury_view')) {
            return res.status(403).json({ error: 'Accès refusé. Permission perm_treasury_view manquante.' });
        }

        const requests = await prisma.treasuryRequest.findMany({
            include: {
                maker: { select: { name: true, role: true } },
                checker: { select: { name: true, role: true } },
                targetBranch: { select: { name: true, code: true, balance: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json(requests);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 2. Créer une Demande (ISSUANCE, ALLOCATION, RETURN) [MAKER]
router.post('/requests', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const maker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, branchId: true, permissions: true, permissionsCustomized: true } });
        if (!maker) {
            return res.status(403).json({ error: 'Compte introuvable.' });
        }

        const schema = z.object({
            type: z.enum(['ISSUANCE', 'ALLOCATION', 'RETURN', 'ADJUSTMENT', 'REVERSAL']),
            amount: z.number().positive(),
            reason: z.string().min(3),
            comment: z.string().optional(),
            targetBranchId: z.string().optional(),
            targetWalletId: z.string().optional()
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Données invalides', details: parsed.error });

        const { type, amount, reason, comment, targetBranchId, targetWalletId } = parsed.data;

        // RBAC Dynamique en fonction du TYPE d'action demandée
        if (type === 'ISSUANCE' && !hasPermission(maker, 'perm_treasury_mint')) {
            return res.status(403).json({ error: 'Création monétaire interdite. Permission perm_treasury_mint requise.' });
        }
        if ((type === 'ALLOCATION' || type === 'RETURN' || type === 'ADJUSTMENT' || type === 'REVERSAL') && !hasPermission(maker, 'perm_treasury_allocate')) {
            return res.status(403).json({ error: 'Gestion des flux interdite. Permission perm_treasury_allocate requise.' });
        }

        // Treasury Policies check
        const settings = await prisma.systemSettings.findFirst();
        if (settings?.circuitBreaker) {
            return res.status(403).json({ error: 'Le Circuit Breaker est activé. Opérations financières bloquées.' });
        }

        if (type === 'ISSUANCE') {
            if (amount > (settings?.maxMintAmount || 1000000000)) {
                return res.status(400).json({ error: `La création de monnaie est plafonnée à ${settings?.maxMintAmount} par requête.` });
            }
        }

        // Contrôles spécifiques au type — depuis la séparation de la Trésorerie Centrale,
        // le Siège n'est qu'une agence normale et peut légitimement être ciblé par une
        // Allocation/un Retour comme n'importe quelle autre (plus d'auto-ciblage possible :
        // la Trésorerie Centrale n'a plus d'id d'agence).
        if (type === 'ALLOCATION') {
            if (!targetBranchId && !targetWalletId) return res.status(400).json({ error: 'Une cible (Agence ou Portefeuille) est requise pour une Allocation.' });

            const centralTreasury = await getCentralTreasury();
            if (centralTreasury.wallet.balance < amount) {
                return res.status(400).json({ error: "Fonds centraux insuffisants pour cette allocation." });
            }
        }

        if (type === 'RETURN') {
            // Seule une agence peut retourner. On vérifie si l'utilisateur est le manager et qu'il cible sa propre agence.
            if (maker.role === 'BRANCH_MANAGER' && maker.branchId !== targetBranchId) {
                return res.status(403).json({ error: 'Vous ne pouvez initier un retour que pour votre propre agence.' });
            }
            if (!targetBranchId) return res.status(400).json({ error: 'L\'agence d\'origine est requise pour un retour.' });
        }

        const ref = `${type.substring(0, 3)}-${Date.now()}`;

        const request = await prisma.treasuryRequest.create({
            data: {
                reference: ref,
                type,
                amount,
                reason,
                comment,
                makerId: maker.id,
                targetBranchId,
                targetWalletId,
                status: 'PENDING'
            }
        });

        await prisma.auditLog.create({
            data: { adminId: maker.id, action: 'CREATE_TREASURY_REQ', details: `Création demande ${type} de ${amount} FCFA (Ref: ${ref})` }
        });

        res.json({ success: true, request });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 3. Approuver et Exécuter (CHECKER) [IDEMPOTENT & ATOMIQUE]
router.post('/requests/:id/approve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const checker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!checker || !hasPermission(checker, 'perm_treasury_approve')) {
            return res.status(403).json({ error: 'Vous n\'avez pas les droits d\'approbation (perm_treasury_approve).' });
        }

        const requestId = req.params.id as string;

        // Utiliser une transaction explicite stricte pour lock et idempotence
        const executed = await prisma.$transaction(async (tx) => {
            const request = await tx.treasuryRequest.findUnique({
                where: { id: requestId },
                include: { targetBranch: { include: { wallet: true } }, maker: true }
            });

            if (!request) throw new Error('Demande introuvable.');

            // ANTI-AUTO APPROVAL STRICT (sauf SUPER_ADMIN, autorité ultime — évite une
            // impasse totale si un seul compte staff actif existe dans le système)
            if (request.makerId === checker.id && checker.role !== 'SUPER_ADMIN') {
                throw new Error('Principe de sûreté enfreint : Un Maker ne peut pas s\'approuver.');
            }

            // IDEMPOTENCE
            if (request.status !== 'PENDING') {
                throw new Error(`Cette demande a déjà été traitée (Statut: ${request.status}).`);
            }

            // SETTINGS CHECK
            const settings = await tx.systemSettings.findFirst();
            if (settings?.circuitBreaker) throw new Error("Circuit Breaker actif, opération interdite.");

            if (request.amount > (settings?.treasuryApprovalThreshold || 5000000)) {
                if (checker.role !== 'SUPER_ADMIN') {
                    throw new Error(`Pour les montants > ${settings?.treasuryApprovalThreshold}, seul le SUPER_ADMIN peut approuver.`);
                }
            }

            // Réclamation atomique AVANT exécution (même pattern que le CRON Tontine) : si
            // deux appels d'approbation concurrents (double-clic, retry réseau) arrivent pour
            // la même demande, le check `request.status !== 'PENDING'` ci-dessus lit une valeur
            // non verrouillée et peut passer dans les deux appels. Seul celui dont l'updateMany
            // matche encore le statut PENDING gagne le droit d'exécuter le mouvement de fonds ;
            // l'autre voit count=0 et échoue proprement au lieu de mint/allouer deux fois.
            const claim = await tx.treasuryRequest.updateMany({
                where: { id: request.id, status: 'PENDING' },
                data: { status: 'EXECUTED', checkerId: checker.id, executedAt: new Date() }
            });
            if (claim.count === 0) {
                throw new Error('Cette demande a déjà été traitée.');
            }

            // ==================
            // EXÉCUTION LOGIQUE
            // ==================

            // Depuis la séparation, la Trésorerie Centrale n'est plus une Branch : plus
            // besoin de garde anti-auto-ciblage ici, le Siège est une agence normale.
            const reserve = await getCentralTreasury(tx);

            // 🛑 PESSIMISTIC LOCKING GLOBAL ET DÉTERMINISTE
            // On collecte tous les portefeuilles impliqués dans l'opération, on filtre les doublons,
            // on trie les IDs pour éviter tout deadlock, puis on les verrouille.
            const lockIds = [reserve.wallet!.id];
            if (request.targetBranch && request.targetBranch.walletId) lockIds.push(request.targetBranch.walletId);
            if (request.targetWalletId) lockIds.push(request.targetWalletId);

            const uniqueSortedLockIds = Array.from(new Set(lockIds)).sort();
            for (const id of uniqueSortedLockIds) {
                await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${id} FOR UPDATE;`;
            }

            if (request.type === 'ISSUANCE') {
                // Création pure vers la réserve Centrale
                await tx.wallet.update({
                    where: { id: reserve.wallet!.id },
                    data: { balance: { increment: request.amount } }
                });

                await tx.transaction.create({
                    data: {
                        amount: request.amount,
                        receiverWalletId: reserve.wallet!.id,
                        status: 'COMPLETED',
                        reference: request.reference,
                        type: request.type
                    }
                });
            }
            else if (request.type === 'ALLOCATION') {
                // Réserve -> Agence (ou Wallet Pro)
                if (reserve.wallet!.balance < request.amount) {
                    throw new Error("Fonds centraux (Réserve) insuffisants pour exécuter cette allocation.");
                }

                // Débit central — garde atomique (balance: gte) : le contrôle ci-dessus lit
                // une valeur non verrouillée, donc deux allocations concurrentes puisant dans
                // la même Réserve pouvaient toutes deux le passer et faire chuter le solde
                // central sous zéro.
                await tx.wallet.update({
                    where: { id: reserve.wallet!.id, balance: { gte: request.amount } },
                    data: { balance: { decrement: request.amount } }
                });

                if (request.targetBranch && request.targetBranch.walletId) {
                    await tx.wallet.update({
                        where: { id: request.targetBranch.walletId },
                        data: { balance: { increment: request.amount } }
                    });

                    await tx.transaction.create({
                        data: {
                            amount: request.amount,
                            senderWalletId: reserve.wallet!.id,
                            receiverWalletId: request.targetBranch.walletId,
                            status: 'COMPLETED',
                            reference: request.reference,
                            type: request.type
                        }
                    });
                } else if (request.targetWalletId) {
                    await tx.wallet.update({
                        where: { id: request.targetWalletId },
                        data: { balance: { increment: request.amount } }
                    });
                    await tx.transaction.create({
                        data: {
                            amount: request.amount,
                            senderWalletId: reserve.wallet!.id,
                            receiverWalletId: request.targetWalletId,
                            status: 'COMPLETED',
                            reference: request.reference,
                            type: request.type
                        }
                    });
                } else {
                    throw new Error("Cible d'allocation invalide ou manquante.");
                }
            }
            else if (request.type === 'RETURN') {
                // Agence -> Réserve
                if (!request.targetBranch || !request.targetBranch.walletId) throw new Error("Cible Agence invalide.");

                const branchWalletInfo = await tx.wallet.findUnique({ where: { id: request.targetBranch.walletId } });
                if (!branchWalletInfo || branchWalletInfo.balance < request.amount) {
                    throw new Error("Monnaie électronique insuffisante dans l'agence pour ce retour.");
                }

                // Garde atomique (balance: gte) : même raisonnement que le débit central
                // ci-dessus, appliqué ici au wallet de l'agence source du retour.
                await tx.wallet.update({
                    where: { id: request.targetBranch.walletId, balance: { gte: request.amount } },
                    data: { balance: { decrement: request.amount } }
                });

                await tx.wallet.update({
                    where: { id: reserve.wallet!.id },
                    data: { balance: { increment: request.amount } }
                });

                await tx.transaction.create({
                    data: {
                        amount: request.amount,
                        senderWalletId: request.targetBranch.walletId,
                        receiverWalletId: reserve.wallet!.id,
                        status: 'COMPLETED',
                        reference: request.reference,
                        type: request.type
                    }
                });
            }
            else if (request.type === 'ADJUSTMENT' || request.type === 'REVERSAL') {
                if (request.targetBranch && request.targetBranch.walletId) {
                    // Le ledger enregistre ce mouvement comme venant de la Réserve
                    // (senderWalletId: reserve) : il faut donc réellement débiter la Réserve,
                    // sinon la créance de l'agence est créditée sans aucune contrepartie
                    // débitée nulle part — de la monnaie électronique créée à partir de rien.
                    if (reserve.wallet!.balance < request.amount) {
                        throw new Error("Fonds centraux (Réserve) insuffisants pour cet ajustement.");
                    }
                    await tx.wallet.update({
                        where: { id: reserve.wallet!.id, balance: { gte: request.amount } },
                        data: { balance: { decrement: request.amount } }
                    });
                    await tx.wallet.update({
                        where: { id: request.targetBranch.walletId },
                        data: { balance: { increment: request.amount } }
                    });
                    await tx.transaction.create({
                        data: { amount: request.amount, senderWalletId: reserve.wallet!.id, receiverWalletId: request.targetBranch.walletId, status: 'COMPLETED', reference: request.reference, type: request.type }
                    });
                } else if (!request.targetBranch && !request.targetWalletId) {
                    await tx.wallet.update({
                        where: { id: reserve.wallet!.id },
                        data: { balance: { increment: request.amount } }
                    });
                    await tx.transaction.create({
                        data: { amount: request.amount, receiverWalletId: reserve.wallet!.id, status: 'COMPLETED', reference: request.reference, type: request.type }
                    });
                } else if (request.targetWalletId) {
                    // Même raisonnement que ci-dessus : la Réserve est enregistrée comme
                    // expéditeur, elle doit donc être réellement débitée.
                    if (reserve.wallet!.balance < request.amount) {
                        throw new Error("Fonds centraux (Réserve) insuffisants pour cet ajustement.");
                    }
                    await tx.wallet.update({
                        where: { id: reserve.wallet!.id, balance: { gte: request.amount } },
                        data: { balance: { decrement: request.amount } }
                    });
                    await tx.wallet.update({
                        where: { id: request.targetWalletId },
                        data: { balance: { increment: request.amount } }
                    });
                    await tx.transaction.create({
                        data: { amount: request.amount, receiverWalletId: request.targetWalletId, senderWalletId: reserve.wallet!.id, status: 'COMPLETED', reference: request.reference, type: request.type }
                    });
                } else {
                    // Cas non couvert par les 3 branches ci-dessus : `targetBranch` existe mais
                    // sans `walletId` (agence créée sans wallet configuré). Sans ce garde-fou,
                    // le `claim` juste au-dessus marquait déjà la demande EXECUTED et l'audit
                    // log s'écrivait plus bas SANS AUCUN mouvement de fonds réel — un ajustement
                    // "exécuté avec succès" qui ne faisait en réalité rien, de façon
                    // irréversible (statut non-PENDING, ré-approbation impossible). Le throw ici
                    // fait échouer toute la transaction, y compris le `claim` : la demande
                    // redevient PENDING pour être corrigée puis réessayée.
                    throw new Error("Cible d'ajustement invalide : l'agence ciblée n'a pas de portefeuille configuré.");
                }
            }

            await tx.auditLog.create({
                data: {
                    adminId: checker.id,
                    action: 'EXECUTE_TREASURY_REQ',
                    details: `Exécution stricte ${request.reference} : ${request.amount} FCFA.`
                }
            });

            // Le statut a déjà été fixé de façon atomique par le `claim` ci-dessus.
            return { ...request, status: 'EXECUTED', checkerId: checker.id, executedAt: new Date() };
        });

        res.json({ success: true, request: executed });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 4. Rejeter (CHECKER) [IMMUABLE]
router.post('/requests/:id/reject', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const checker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!checker || !hasPermission(checker, 'perm_treasury_approve')) {
            return res.status(403).json({ error: 'Vous n\'avez pas les droits de rejet (perm_treasury_approve).' });
        }

        const requestId = req.params.id as string;
        const { rejectionReason } = req.body;

        if (!rejectionReason || rejectionReason.length < 5) return res.status(400).json({ error: 'Motif de rejet valide requis.' });

        const request = await prisma.treasuryRequest.findUnique({ where: { id: requestId } });
        if (!request) return res.status(404).json({ error: 'Introuvable.' });
        if (request.status !== 'PENDING') return res.status(400).json({ error: 'Action impossible sur une demande non-PENDING.' });

        const updatedReq = await prisma.treasuryRequest.update({
            where: { id: requestId },
            data: { status: 'REJECTED', checkerId: checker.id, rejectionReason, executedAt: new Date() }
        });

        await prisma.auditLog.create({
            data: { adminId: checker.id, action: 'REJECT_TREASURY_REQ', details: `Rejet de ${request.reference}. Motif: ${rejectionReason}` }
        });

        res.json({ success: true, request: updatedReq });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 4bis. Annuler sa propre demande PENDING [MAKER] — jusqu'ici une demande créée par erreur
// (mauvais montant, mauvaise cible) n'avait aucune issue : ni approuvable proprement par
// son propre auteur (anti-auto-approbation), ni retirable — elle restait PENDING à vie ou
// devait être rejetée par un tiers pour une erreur qui n'était pas la sienne. CANCELLED
// est un statut déjà prévu au schéma (commentaire de TreasuryRequest.status) mais jamais
// écrit par aucune route jusqu'ici.
router.post('/requests/:id/cancel', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const staff = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true } });
        if (!staff) return res.status(403).json({ error: 'Compte introuvable.' });

        const requestId = req.params.id as string;
        const { reason } = req.body;

        const request = await prisma.treasuryRequest.findUnique({ where: { id: requestId } });
        if (!request) return res.status(404).json({ error: 'Introuvable.' });
        if (request.status !== 'PENDING') return res.status(400).json({ error: 'Action impossible sur une demande non-PENDING.' });

        // Seul l'auteur peut retirer sa propre demande ; SUPER_ADMIN peut débloquer une
        // demande orpheline (ex: maker parti) — même escape hatch que l'anti-auto-approbation.
        if (request.makerId !== staff.id && staff.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Seul l\'auteur de la demande (ou un SUPER_ADMIN) peut l\'annuler.' });
        }

        const claim = await prisma.treasuryRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: { status: 'CANCELLED', rejectionReason: reason ? String(reason).trim() : null, executedAt: new Date() }
        });
        if (claim.count === 0) return res.status(400).json({ error: 'Cette demande vient d\'être traitée.' });

        await prisma.auditLog.create({
            data: { adminId: staff.id, action: 'CANCEL_TREASURY_REQ', details: `Annulation de ${request.reference} par son auteur.${reason ? ` Motif : ${reason}` : ''}` }
        });

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 5. Voir la liquidité des agences
router.get('/agencies-liquidity', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const checker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!checker || !hasPermission(checker, 'perm_analytics_view')) return res.status(403).json({ error: 'Accès refusé. (perm_analytics_view requis)' });

        const settings = await prisma.systemSettings.findFirst();
        const branches = await prisma.branch.findMany({ include: { wallet: true, sessions: true } });

        const result = branches.map(b => {
            const low = settings?.agencyLowLiquidityThreshold || 15000000;
            const crit = settings?.agencyCriticalLiquidity || 5000000;
            const bal = b.wallet?.balance || 0;

            let status = 'HEALTHY';
            if (bal <= crit) status = 'CRITICAL';
            else if (bal <= low) status = 'LOW';

            return {
                id: b.id, name: b.name, code: b.code, isActive: b.isActive,
                electronicBalance: bal, physicalVault: b.balance, status
            };
        });

        res.json(result);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 6. Voir le registre des Mismatches (Reconciliation)
router.get('/reconciliation', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const checker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!checker || !hasPermission(checker, 'perm_audit_log_view')) return res.status(403).json({ error: 'Accès refusé. (perm_audit_log_view requis)' });

        const cases = await prisma.reconciliationCase.findMany({
            include: { branch: { select: { name: true, code: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json(cases);
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

// 7. Résoudre ou mettre à jour un cas de Réconciliation
router.post('/reconciliation/:id/resolve', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const checker = await prisma.staff.findUnique({ where: { id: req.userId }, select: { id: true, role: true, permissions: true, permissionsCustomized: true } });
        if (!checker || !hasPermission(checker, 'perm_audit_log_view')) return res.status(403).json({ error: 'Accès refusé. (perm_audit_log_view requis)' });

        const { resolution, newStatus } = req.body;
        const recId = req.params.id as string;

        const updated = await prisma.reconciliationCase.update({
            where: { id: recId },
            data: { resolution, status: newStatus || 'RESOLVED', managerId: checker.id, resolvedAt: newStatus === 'RESOLVED' ? new Date() : null }
        });

        await prisma.auditLog.create({
            data: { adminId: checker.id, action: 'RESOLVE_RECONCILIATION', details: `Résolution du cas ${recId}. Statut => ${newStatus}` }
        });

        res.json({ success: true, case: updated });
    } catch (e: any) { res.status(500).json({ error: friendlyErrorMessage(e) }); }
});

export default router;
