import express from 'express';
import { io } from '../index';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { getCentralTreasury } from '../services/centralTreasury';
import { getSystemAccount } from '../services/systemAccounts';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

// GET /api/credit/eligibility
router.get('/eligibility', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || user.accountStatus !== 'ACTIVE') {
            return res.status(403).json({ eligible: false, message: 'Compte inactif.' });
        }

        // Algo IA de décision simple : KYC 1+ et Points de fidélité > 100
        const isEligible = user.kycLevel >= 1 && user.loyaltyPoints >= 100;

        let maxAmount = 0;
        if (isEligible) {
            maxAmount = 50000 + (user.loyaltyPoints * 50); // E.g., 100 points = 55,000 FCFA
            if (maxAmount > 500000) maxAmount = 500000; // Cap at 500k
        }

        // Taux fixe V14
        const interestRate = 0.05;

        res.json({
            eligible: isEligible,
            maxAmount,
            interestRate,
            loyaltyPoints: user.loyaltyPoints
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/credit/active
router.get('/active', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const loans = await prisma.loan.findMany({
            where: { userId: req.userId, status: 'ACTIVE' }
        });
        res.json(loans);
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/credit/apply
router.post('/apply', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { amount } = req.body;
        if (!amount || amount < 5000) {
            return res.status(400).json({ error: 'Montant minimum: 5000 FCFA' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({
                where: { id: req.userId },
                include: { wallet: true }
            });
            if (!user) throw new Error('Utilisateur non trouvé');
            if (user.kycLevel < 1) throw new Error('KYC Niveau 1 requis pour le crédit.');

            const activeLoans = await tx.loan.count({
                where: { userId: req.userId, status: 'ACTIVE' }
            });
            if (activeLoans > 0) throw new Error('Vous avez déjà un crédit en cours.');

            const maxAmount = 50000 + (user.loyaltyPoints * 50);
            if (amount > maxAmount) {
                throw new Error(`Montant non autorisé. Vous êtes éligible jusqu'à ${maxAmount} FCFA.`);
            }

            const interestRate = 0.05;
            const totalOwed = amount + (amount * interestRate);

            // 1. Création du contrat de prêt
            const loan = await tx.loan.create({
                data: {
                    userId: user.id,
                    amount,
                    interestRate,
                    totalOwed
                }
            });

            // 2. Déduction depuis la Trésorerie Centrale (Bank-level Fractional Reserve)
            const treasury = await getCentralTreasury(tx);
            if (treasury.wallet.balance < amount) {
                throw new Error('Liquidité centrale insuffisante pour octroyer ce micro-crédit.');
            }
            await tx.wallet.update({
                where: { id: treasury.walletId },
                data: { balance: { decrement: amount } }
            });

            // 3. Créditer le compte du client
            const updatedWallet = await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { increment: amount } }
            });

            // 4. Ledger entry (TRACE)
            await tx.transaction.create({
                data: {
                    amount,
                    fee: 0, // le coût est géré en "totalOwed" (Intérêts) plus tard au remboursement
                    type: 'CREDIT_ISSUANCE',
                    senderWalletId: treasury.walletId,
                    receiverWalletId: user.wallet!.id,
                }
            });

            return { loan, wallet: updatedWallet, userPhone: user.phone };
        }, { isolationLevel: 'Serializable' });

        // Push Local Notification (V14 Bypass Socket)
        io.to(`user_${result.userPhone}`).emit('global_push', {
            title: 'Mongain Credit 🎉',
            body: `Votre prêt de ${amount.toLocaleString('fr-FR')} FCFA a été approuvé et viré sur votre compte !`
        });

        res.json({ success: true, loan: result.loan, balance: result.wallet.balance });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/credit/repay
router.post('/repay', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const { loanId } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const loan = await tx.loan.findUnique({
                where: { id: loanId },
                include: { user: { include: { wallet: true } } }
            });
            if (!loan || loan.userId !== req.userId || loan.status !== 'ACTIVE') {
                throw new Error('Prêt introuvable ou déjà soldé.');
            }

            const wallet = loan.user.wallet;
            if (!wallet || wallet.balance < loan.totalOwed) {
                throw new Error('Solde insuffisant pour rembourser la dette.');
            }

            // Déduction du solde client
            const updatedWallet = await tx.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: loan.totalOwed } }
            });

            // Remboursement vers la Trésorerie + Intérêts vers Corporate
            const treasury = await getCentralTreasury(tx);
            const corporate = await getSystemAccount('CORPORATE');

            const principal = loan.amount;
            const interest = loan.totalOwed - loan.amount;

            // Retour du principal au coffre central
            await tx.wallet.update({
                where: { id: treasury.walletId },
                data: { balance: { increment: principal } }
            });
            // Les intérêts vont au compte de revenu Mongain Corporate
            if (interest > 0) {
                await tx.wallet.update({
                    where: { id: corporate.walletId },
                    data: { balance: { increment: interest } }
                });
            }

            // Clôture du prêt
            const closedLoan = await tx.loan.update({
                where: { id: loanId },
                data: { status: 'PAID' }
            });

            // Ledger
            await tx.transaction.create({
                data: {
                    amount: principal,
                    fee: interest, // Ledger trace for accounting
                    type: 'CREDIT_REPAYMENT',
                    senderWalletId: wallet.id,
                    receiverWalletId: treasury.walletId
                }
            });

            return { closedLoan, wallet: updatedWallet, userPhone: loan.user.phone };
        }, { isolationLevel: 'Serializable' });

        io.to(`user_${result.userPhone}`).emit('global_push', {
            title: 'Remboursement Confirmé ✅',
            body: `Merci ! Votre micro-crédit a été intégralement soldé.`
        });

        res.json({ success: true, balance: result.wallet.balance });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
