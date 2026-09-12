import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { notifyParentOfChildSpend, sendPush } from './wallet';

const router = Router();

// ==========================================
// V17: Buy Now Pay Later (BNPL & Micro-Credit)
// ==========================================

const MAX_BNPL_AMOUNT = 50000;
const DEFAULT_BNPL_INTEREST = 0.05; // 5% flat fee de repli si non configuré côté admin

// Anti-abus sur ces deux rails de mouvement de fonds (même raisonnement que wallet.ts
// moneyMovementLimiter) : keyGenerator PAR COMPTE, pas par IP par défaut, pour ne pas
// pénaliser collectivement les nombreux comptes distincts partageant la même IP publique
// (CGNAT des opérateurs mobiles gabonais). 30 requêtes/15 min couvre largement l'usage réel
// (un emprunt BNPL est déjà limité à une dette active à la fois, un remboursement se fait au
// plus quelques fois par session) tout en bloquant un script en boucle.
const moneyMovementLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyGenerator: (req) => (req as AuthRequest).userId || 'anonymous',
    message: { error: 'Trop d\'opérations BNPL en peu de temps. Veuillez réessayer plus tard.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/apply', authMiddleware, moneyMovementLimiter, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amountXaf, months, pin, idempotencyKey } = req.body;
        // Le FCFA n'a aucune sous-unité — arrondi ici, sinon l'écriture Prisma échoue sur un
        // montant décimal (BnplContract.totalAmount/remaining sont Int).
        const requestedAmount = Math.round(parseFloat(amountXaf));
        const duration = parseInt(months);

        if (isNaN(requestedAmount) || requestedAmount <= 0 || requestedAmount > MAX_BNPL_AMOUNT) {
            return res.status(400).json({ error: `Montant BNPL invalide. Maximum autorisé: ${MAX_BNPL_AMOUNT} F.` });
        }
        if (isNaN(duration) || duration < 1 || duration > 4) {
            return res.status(400).json({ error: "Durée d'amortissement BNPL invalide (1 à 4 mois max)." });
        }
        if (!pin) return res.status(400).json({ error: "Code PIN requis" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE' || !user.wallet) return res.status(403).json({ error: "Impossible d'emprunter sur ce compte." });

        // Restriction Comptes Enfant : souscrire à une avance BNPL engage une dette réelle (frais
        // inclus), ce qui ne fait pas partie des fonctionnalités approuvées pour un compte
        // enfant. Le mobile masque déjà le bouton correspondant, mais un masquage d'UI seul
        // n'est jamais une garantie — c'est ce contrôle serveur qui constitue le véritable
        // point d'application.
        if (user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });

        if (user.kycLevel < 1) {
            return res.status(403).json({ error: "Validation KYC Premium requise pour débloquer le crédit." });
        }

        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const settings = await getSystemSettings();
        const bnplInterest = settings.bnplInterest || DEFAULT_BNPL_INTEREST;
        const fee = Math.round(requestedAmount * bnplInterest);
        const totalOwed = requestedAmount + fee;

        const nextPayment = new Date();
        nextPayment.setMonth(nextPayment.getMonth() + 1);

        const isNew = await prisma.$transaction(async (tx) => {
            // Idempotence : un double-tap ou un retry réseau avec la même idempotencyKey ne
            // doit JAMAIS débloquer un second crédit pour une seule demande — sans ce garde,
            // le client recevait deux décaissements (et deux dettes) pour un seul geste.
            // Vérifié avant toute lecture/écriture, même convention que
            // CashOperationService.executeCashIn.
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return false;
            }

            // Verrou advisory scopé à l'utilisateur (même technique que agency.ts /sessions/open) :
            // aucune ligne BnplContract n'existe encore à ce stade pour un `SELECT ... FOR UPDATE`,
            // donc rien n'empêchait nativement deux transactions concurrentes de lire toutes deux
            // "aucune dette active" avant qu'aucune n'ait committé. Le contrôle "une seule dette
            // active à la fois" était fait hors transaction (avant même son ouverture) : un
            // double-tap sur "Emprunter" débloquait deux crédits BNPL actifs simultanés, doublant
            // l'exposition au-delà du plafond KYC prévu pour ce produit de microcrédit.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${user.id}))`;

            const existingDebt = await tx.bnplContract.findFirst({
                where: { userId: user.id, status: 'ACTIVE' }
            });
            if (existingDebt) {
                throw new Error("Vous devez rembourser votre dette BNPL en cours avant d'emprunter à nouveau.");
            }

            // Plafonds AML/KYC — l'octroi d'un crédit était le seul mouvement de fonds de ce
            // fichier à ne passer par aucun contrôle de plafond.
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, requestedAmount, settings);

            // Unify Treasury provider
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });
            if (!treasury) throw new Error("Les fonds de la trésorerie centrale sont inaccessibles.");
            if (treasury.wallet.balance < requestedAmount) throw new Error("Réserve système insuffisante.");

            // Create Debt Contract
            await tx.bnplContract.create({
                data: {
                    userId: user.id,
                    totalAmount: totalOwed,
                    remaining: totalOwed,
                    months: duration,
                    nextPaymentDate: nextPayment,
                    status: 'ACTIVE'
                }
            });

            // Disbursement
            await tx.wallet.update({
                where: { id: treasury.wallet.id, balance: { gte: requestedAmount } },
                data: { balance: { decrement: requestedAmount } }
            });

            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: requestedAmount } }
            });

            await tx.transaction.create({
                data: {
                    type: 'SYSTEM',
                    amount: requestedAmount,
                    status: 'COMPLETED',
                    reference: generateReference('BNPL_IN'),
                    fee: 0,
                    senderWalletId: treasury.wallet.id,
                    receiverWalletId: user.wallet!.id,
                    idempotencyKey
                }
            });

            await tx.notification.create({
                data: {
                    userId: user.id,
                    title: 'Crédit BNPL Approuvé',
                    body: `Félicitations, votre avance de ${requestedAmount} FCFA a été virée. Reste à devoir: ${totalOwed} FCFA.`,
                    type: 'SYSTEM'
                }
            });
            return true;
        });

        // Push sauté pour un rejeu idempotent (isNew === false) : déjà envoyé lors du tout
        // premier passage de cette idempotencyKey.
        if (isNew) {
            await sendPush(user.pushToken, 'Crédit BNPL Approuvé', `Félicitations, votre avance de ${requestedAmount} FCFA a été virée. Reste à devoir: ${totalOwed} FCFA.`);
        }

        res.status(201).json({ success: true, message: "Micro-crédit BNPL débloqué !", amount: requestedAmount });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

// BNPL Repay
router.post('/repay', authMiddleware, moneyMovementLimiter, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amountXaf, pin, idempotencyKey } = req.body;
        // Le FCFA n'a aucune sous-unité — arrondi ici, sinon l'écriture Prisma échoue sur un
        // montant décimal (BnplContract.remaining est Int).
        const repayAmount = Math.round(parseFloat(amountXaf));

        if (isNaN(repayAmount) || repayAmount <= 0) return res.status(400).json({ error: "Montant invalide" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || !user.wallet) return res.status(403).json({ error: "Validation échouée" });

        // Restriction Comptes Enfant : la gestion d'une dette BNPL ne fait pas partie des
        // fonctionnalités approuvées pour un compte enfant (voir /apply ci-dessus). Le mobile
        // masque déjà le bouton correspondant, mais seul ce contrôle serveur constitue une
        // vraie barrière (un masquage d'UI seul n'en est jamais une).
        if (user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });

        // Vérifié AVANT d'entrer dans la transaction : un `return res.status(...)` depuis
        // l'intérieur du callback `$transaction` ne l'interrompt pas (il ne fait que résoudre
        // la promesse interne avec l'objet Response) — le code après continuait de s'exécuter
        // et renvoyait une seconde réponse HTTP (`ERR_HTTP_HEADERS_SENT`) même après un PIN refusé.
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        // Atomic Repay
        let effectiveRepayAmount = 0;
        const isNew = await prisma.$transaction(async (tx) => {
            // Idempotence : un double-tap ou un retry réseau avec la même idempotencyKey ne
            // doit JAMAIS re-débiter le client pour un seul remboursement — sans ce garde, sa
            // dette était amortie une seconde fois pour un seul geste, au prix d'un double
            // débit de son wallet. Vérifié avant toute lecture/écriture, même convention que
            // CashOperationService.executeCashIn.
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) {
                    effectiveRepayAmount = dup.amount;
                    return false;
                }
            }

            const debt = await tx.bnplContract.findFirst({
                where: { userId: user.id, status: 'ACTIVE' }
            });
            if (!debt) throw new Error("Aucune dette BNPL active.");

            const effectiveRepay = Math.min(repayAmount, debt.remaining);
            effectiveRepayAmount = effectiveRepay;

            if (user.wallet!.balance < effectiveRepay) throw new Error("Solde insuffisant pour le remboursement.");

            // Pull to Treasury
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });

            await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: effectiveRepay } },
                data: { balance: { decrement: effectiveRepay } }
            });

            await tx.wallet.update({
                where: { id: treasury!.wallet.id },
                data: { balance: { increment: effectiveRepay } }
            });

            await tx.transaction.create({
                data: {
                    type: 'SYSTEM',
                    amount: effectiveRepay,
                    status: 'COMPLETED',
                    reference: generateReference('BNPL_OUT'),
                    fee: 0,
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: treasury!.wallet.id,
                    idempotencyKey
                }
            });

            // Amortization tracking
            const newRemaining = debt.remaining - effectiveRepay;
            await tx.bnplContract.update({
                where: { id: debt.id },
                data: {
                    remaining: newRemaining,
                    status: newRemaining <= 0 ? 'CLOSED' : 'ACTIVE'
                }
            });
            return true;
        });

        // Notification sautée pour un rejeu idempotent (isNew === false) : déjà envoyée lors
        // du tout premier passage de cette idempotencyKey.
        if (isNew) {
            await notifyParentOfChildSpend(user.id, effectiveRepayAmount, 'remboursement BNPL');
        }

        res.json({ success: true, message: "Remboursement enregistré." });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
