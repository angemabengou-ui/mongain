import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';

const router = Router();

// ==========================================
// Wealth Management (Staking Vaults)
// ==========================================

const DEFAULT_APY = 0.05; // 5% base yield

// Create a Staking Vault (Lock Funds)
router.post('/stake', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amount, lockMonths } = req.body;

        const stakeAmount = parseFloat(amount);
        const duration = parseInt(lockMonths);

        if (isNaN(stakeAmount) || stakeAmount < 10000) {
            return res.status(400).json({ error: "Le montant minimum de dépôt est de 10,000 FCFA." });
        }
        if (isNaN(duration) || duration < 1 || duration > 60) {
            return res.status(400).json({ error: "Durée de blocage invalide (entre 1 et 60 mois)." });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            include: { wallet: true }
        });

        if (!user || !user.wallet) return res.status(401).json({ error: "Utilisateur non valide." });
        if (user.wallet.balance < stakeAmount) return res.status(400).json({ error: "Solde insuffisant." });

        let apy = DEFAULT_APY;
        if (duration >= 12) apy = 0.08; // 8% for 1 year+

        const lockedUntil = new Date();
        lockedUntil.setMonth(lockedUntil.getMonth() + duration);

        await prisma.$transaction(async (tx) => {
            // Debit Wallet
            await tx.wallet.update({
                where: { id: user.wallet!.id, balance: { gte: stakeAmount } },
                data: { balance: { decrement: stakeAmount } }
            });

            // Create Vault
            await tx.stakingVault.create({
                data: {
                    userId: user.id,
                    amount: stakeAmount,
                    apy: apy,
                    lockedUntil: lockedUntil,
                    status: 'ACTIVE'
                }
            });

            // Transaction Log (Wealth Management System) -> we consider it left the main wallet 
            // into an undefined/held state (or we could route it to CentralTreasury). Let's log it.
            const ref = `STK.V_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

            // Get Treasury to hold the stakes
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });

            if (treasury) {
                // Move funds to treasury for backend Yield generation
                await tx.wallet.update({
                    where: { id: treasury.walletId },
                    data: { balance: { increment: stakeAmount } }
                });

                await tx.transaction.create({
                    data: {
                        amount: stakeAmount,
                        status: 'COMPLETED',
                        reference: ref,
                        senderWalletId: user.wallet!.id,
                        receiverWalletId: treasury.walletId,
                        fee: 0
                    }
                });
            } else {
                throw new Error("Erreur système: Trésorerie d'investissement introuvable.");
            }
        });

        res.status(201).json({ success: true, message: `Dépôt de ${stakeAmount} FCFA verrouillé à ${apy * 100}% d'intérêt annuel.` });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Get My Vaults
router.get('/vaults', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const vaults = await prisma.stakingVault.findMany({
            where: { userId: req.userId },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, vaults });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
