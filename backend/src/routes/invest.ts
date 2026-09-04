import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';
import { sendPush } from './wallet';

const router = Router();

// ==========================================
// Wealth Management (Staking Vaults)
// ==========================================

const DEFAULT_APY = 0.05; // 5% base yield

// Create a Staking Vault (Lock Funds)
router.post('/stake', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });
        const { amount, lockMonths, pin } = req.body;

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

        // Seule route de débit réel du fichier sans code PIN jusqu'ici — contrairement à tous
        // les autres rails sortants (crypto.ts, bnpl.ts, b2b.ts, biller.ts...), un jeton de
        // session volé (téléphone déverrouillé, session détournée) suffisait à bloquer les
        // fonds de la victime jusqu'à 5 ans sans jamais connaître son code PIN.
        if (!pin) return res.status(400).json({ error: "Code PIN requis." });
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        if (user.wallet.balance < stakeAmount) return res.status(400).json({ error: "Solde insuffisant." });

        let apy = DEFAULT_APY;
        if (duration >= 12) apy = 0.08; // 8% for 1 year+

        const lockedUntil = new Date();
        lockedUntil.setMonth(lockedUntil.getMonth() + duration);

        const settings = await getSystemSettings();

        await prisma.$transaction(async (tx) => {
            // Plafonds AML/KYC — comme tout autre débit réel du wallet personnel
            // (wallet.ts, market.ts, crypto.ts...), absent ici jusqu'à présent : un client
            // Tier 0 pouvait bloquer un montant arbitraire en un seul virement vers ce
            // produit d'épargne, sans passer par aucun contrôle de plafond journalier/mensuel.
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, stakeAmount, settings);

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

// Débloquer un coffre de staking arrivé à échéance (capital + intérêts).
// Il n'existait jusqu'ici AUCUN moyen de récupérer l'argent déposé via /stake : aucun
// endpoint de retrait, aucun job de versement du rendement — un utilisateur pouvait bloquer
// des fonds sans jamais pouvoir les récupérer par l'API (seule une intervention manuelle en
// base le permettait). N'autorise le retrait qu'après `lockedUntil` : la promesse produit est
// un blocage jusqu'à cette date, pas un retrait anticipé avec pénalité (mécanisme qui
// n'existe nulle part ailleurs dans le code et relève d'une décision produit, pas d'un bug).
router.post('/vaults/:id/withdraw', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const vault = await prisma.stakingVault.findUnique({ where: { id: req.params.id as string } });
        if (!vault || vault.userId !== req.userId) return res.status(404).json({ error: "Coffre introuvable." });
        if (vault.status !== 'ACTIVE') return res.status(400).json({ error: "Ce coffre n'est plus actif." });
        if (vault.lockedUntil > new Date()) {
            return res.status(400).json({ error: `Ce coffre reste bloqué jusqu'au ${vault.lockedUntil.toLocaleDateString('fr-FR')}. Aucun retrait anticipé n'est possible.` });
        }

        // Intérêt calculé sur la durée réelle de blocage (createdAt -> lockedUntil), pas un
        // nombre de mois codé en dur : /stake ne persistait que lockedUntil, pas lockMonths.
        const termMonths = Math.max(1, Math.round(
            (vault.lockedUntil.getFullYear() - vault.createdAt.getFullYear()) * 12
            + (vault.lockedUntil.getMonth() - vault.createdAt.getMonth())
        ));
        const interest = Math.round(vault.amount * vault.apy * (termMonths / 12));
        const totalPayout = vault.amount + interest;

        const result = await prisma.$transaction(async (tx) => {
            const claim = await tx.stakingVault.updateMany({
                where: { id: vault.id, status: 'ACTIVE' },
                data: { status: 'WITHDRAWN' }
            });
            if (claim.count === 0) throw new Error("Ce coffre vient d'être traité (double clic ou requête concurrente).");

            const user = await tx.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
            if (!user?.wallet) throw new Error("Portefeuille introuvable.");

            // Le capital ET l'intérêt sortent de la Trésorerie Centrale : c'est elle qui avait
            // reçu le capital à la création du coffre (/stake) et qui porte, dans ce modèle,
            // la contrepartie de rendement — même logique que credit.ts (Trésorerie <->
            // client), en sens inverse ici (retour de fonds vers le client).
            const treasury = await tx.centralTreasury.findFirst({ include: { wallet: true } });
            if (!treasury?.wallet) throw new Error("Trésorerie d'investissement introuvable.");
            if (treasury.wallet.balance < totalPayout) throw new Error("Liquidité centrale insuffisante pour ce retrait — contactez le support.");

            await tx.wallet.update({
                where: { id: treasury.walletId, balance: { gte: totalPayout } },
                data: { balance: { decrement: totalPayout } }
            });
            await tx.wallet.update({
                where: { id: user.wallet.id },
                data: { balance: { increment: totalPayout } }
            });

            await tx.transaction.create({
                data: {
                    amount: totalPayout,
                    fee: 0,
                    type: 'WEALTH_WITHDRAWAL',
                    status: 'COMPLETED',
                    reference: generateReference('STK_OUT'),
                    senderWalletId: treasury.walletId,
                    receiverWalletId: user.wallet.id,
                }
            });

            const title = 'Coffre débloqué';
            const body = `Votre dépôt de ${vault.amount.toLocaleString('fr-FR')} FCFA arrivé à échéance a été crédité, intérêts inclus : +${interest.toLocaleString('fr-FR')} FCFA (total ${totalPayout.toLocaleString('fr-FR')} FCFA).`;
            await tx.notification.create({
                data: { userId: user.id, title, body, type: 'TRANSACTION' }
            });

            return { balance: user.wallet.balance + totalPayout, pushToken: user.pushToken, title, body };
        });

        await sendPush(result.pushToken, result.title, result.body);

        res.json({ success: true, message: `Coffre débloqué : ${vault.amount.toLocaleString('fr-FR')} FCFA + ${interest.toLocaleString('fr-FR')} FCFA d'intérêts.`, amount: vault.amount, interest, totalPayout, balance: result.balance });
    } catch (e: any) {
        res.status(400).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
