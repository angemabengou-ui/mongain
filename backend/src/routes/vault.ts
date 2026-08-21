import { PrismaClient } from '@prisma/client';
import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = express.Router();
const prisma = new PrismaClient();

// ==========================================
// 1. VAULT MANAGEMENT
// ==========================================

// Obtenir toutes les caisses dont l'utilisateur est membre
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const vaults = await prisma.vaultMember.findMany({
            where: { userId: req.userId! },
            include: {
                vault: {
                    include: {
                        _count: {
                            select: { members: true, transactions: { where: { status: 'PENDING' } } }
                        }
                    }
                }
            }
        });
        res.json({ success: true, data: vaults });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Créer une nouvelle caisse
router.post('/', authMiddleware, async (req: AuthRequest, res) => {
    const { name, description } = req.body;
    try {
        const vault = await prisma.$transaction(async (tx) => {
            const newVault = await tx.vault.create({
                data: {
                    name,
                    description,
                    adminId: req.userId!
                }
            });

            // Le créateur est automatiquement admin, initiateur, et validateur par défaut.
            await tx.vaultMember.create({
                data: {
                    vaultId: newVault.id,
                    userId: req.userId!,
                    isAdmin: true,
                    isInitiator: true,
                    isValidator: true,
                    isTreasurer: true
                }
            });

            return newVault;
        });

        res.json({ success: true, data: vault });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Obtenir les détails d'une caisse spécifique
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const vaultId = req.params.id as string;

        // Vérifier l'appartenance
        const membership = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!membership) return res.status(403).json({ success: false, message: "Vous n'êtes pas membre de cette caisse." });

        const vault = await prisma.vault.findUnique({
            where: { id: vaultId },
            include: {
                members: {
                    include: { user: { select: { id: true, name: true, phone: true } } }
                },
                transactions: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    include: {
                        requestedBy: { select: { id: true, name: true } },
                        approvals: { include: { user: { select: { name: true } } } }
                    }
                }
            }
        });

        res.json({ success: true, data: vault, role: membership });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Inviter un membre par numéro de téléphone
router.post('/:id/invite', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { phone } = req.body;

    try {
        // Vérifier si appelant est admin
        const adminCheck = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!adminCheck || !adminCheck.isAdmin) {
            return res.status(403).json({ success: false, message: "Seul un admin peut inviter des membres." });
        }

        const userToAdd = await prisma.user.findUnique({ where: { phone } });
        if (!userToAdd) return res.status(404).json({ success: false, message: "Utilisateur introuvable avec ce numéro." });

        const newMember = await prisma.vaultMember.upsert({
            where: { vaultId_userId: { vaultId, userId: userToAdd.id } },
            update: {}, // Already member
            create: {
                vaultId,
                userId: userToAdd.id
            }
        });

        res.json({ success: true, message: "Membre ajouté avec succès.", data: newMember });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Mettre à jour les rôles d'un membre
router.put('/:id/roles', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { targetUserId, isInitiator, isValidator, isTreasurer, isAdmin } = req.body;

    try {
        const adminCheck = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!adminCheck || !adminCheck.isAdmin) {
            return res.status(403).json({ success: false, message: "Action réservée à l'administrateur de la caisse." });
        }

        const updatedRole = await prisma.vaultMember.update({
            where: { vaultId_userId: { vaultId, userId: targetUserId } },
            data: { isInitiator, isValidator, isTreasurer, isAdmin }
        });

        res.json({ success: true, data: updatedRole });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 2. FINANCIAL OPERATIONS
// ==========================================

// Déposer dans la caisse
router.post('/:id/deposit', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: "Montant invalide" });
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Vérifier profil
            const membership = await tx.vaultMember.findUnique({
                where: { vaultId_userId: { vaultId, userId: req.userId! } }
            });
            if (!membership) throw new Error("Vous n'êtes pas membre de cette caisse.");

            // Vérifier solde utilisateur
            const userWallet = await tx.wallet.findUnique({ where: { userId: req.userId! } });
            if (!userWallet || userWallet.balance < parsedAmount) {
                throw new Error("Solde personnel insuffisant");
            }

            // Débit Wallet, Crédit Vault
            await tx.wallet.update({
                where: { id: userWallet.id },
                data: { balance: { decrement: parsedAmount } }
            });

            await tx.vault.update({
                where: { id: vaultId },
                data: { balance: { increment: parsedAmount } }
            });

            // Trace VaultTransaction
            const vtx = await tx.vaultTransaction.create({
                data: {
                    vaultId,
                    type: 'DEPOSIT',
                    amount: parsedAmount,
                    status: 'COMPLETED',
                    requestedById: req.userId!
                }
            });

            return vtx;
        });

        res.json({ success: true, message: "Dépôt réussi", data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Demander un retrait
router.post('/:id/withdraw-request', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { amount, destinationType, destinationId } = req.body; // destinationType: TREASURER ou VOUCHER
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: "Montant invalide" });
    }

    try {
        const membership = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!membership || !membership.isInitiator) {
            return res.status(403).json({ success: false, message: "Seul le Responsable (Initiator) peut demander un retrait." });
        }

        const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
        if (!vault || vault.balance < parsedAmount) {
            return res.status(400).json({ success: false, message: "Le solde de la caisse est insuffisant." });
        }

        const tx = await prisma.vaultTransaction.create({
            data: {
                vaultId,
                type: 'WITHDRAW_REQUEST',
                amount: parsedAmount,
                status: 'PENDING',
                destinationType: destinationType || 'VOUCHER',
                destinationId,
                requestedById: req.userId!
            }
        });

        res.json({ success: true, message: "Demande de retrait initiée. En attente de validations.", data: tx });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 3. MULTISIG APPROVALS & VOUCHERS
// ==========================================

// Approuver un retrait
router.post('/:id/approve/:txId', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const txId = req.params.txId as string;

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Vérifier validateur
            const membership = await tx.vaultMember.findUnique({
                where: { vaultId_userId: { vaultId, userId: req.userId! } }
            });

            if (!membership || !membership.isValidator) {
                throw new Error("Vous n'êtes pas autorisé à valider des retraits.");
            }

            const vaultTx = await tx.vaultTransaction.findUnique({
                where: { id: txId },
                include: { approvals: true, vault: true }
            });

            if (!vaultTx || vaultTx.status !== 'PENDING') {
                throw new Error("Transaction non trouvée ou déjà traitée.");
            }

            if (vaultTx.approvals.some(a => a.userId === req.userId!)) {
                throw new Error("Vous avez déjà approuvé cette transaction.");
            }

            // Enregistrer l'approbation
            await tx.vaultApproval.create({
                data: {
                    transactionId: txId,
                    userId: req.userId!
                }
            });

            const currentApprovalsCount = vaultTx.approvals.length + 1;
            const validatorCountArray = await tx.vaultMember.findMany({ where: { vaultId, isValidator: true } });

            // Logic: Require at least 2 validators if available (or all if < 2, though realistically at least 2).
            const requiredApprovals = Math.max(2, Math.min(validatorCountArray.length, 2));

            if (currentApprovalsCount >= requiredApprovals) {
                // Débit Caisse
                await tx.vault.update({
                    where: { id: vaultTx.vaultId },
                    data: { balance: { decrement: vaultTx.amount } }
                });

                // Execution
                if (vaultTx.destinationType === 'TREASURER') {
                    if (!vaultTx.destinationId) throw new Error("ID Trésorier manquant.");

                    const treasurerWallet = await tx.wallet.findUnique({ where: { userId: vaultTx.destinationId } });
                    if (!treasurerWallet) throw new Error("Portefeuille trésorier introuvable.");

                    await tx.wallet.update({
                        where: { id: treasurerWallet.id },
                        data: { balance: { increment: vaultTx.amount } }
                    });
                } else if (vaultTx.destinationType === 'VOUCHER') {
                    // Création du Bon de Retrait pour le Président (Initiator actuel, admin, ou spécifié)
                    const presidentId = vaultTx.requestedById;
                    await tx.vaultVoucher.create({
                        data: {
                            vaultId: vaultTx.vaultId,
                            amount: vaultTx.amount,
                            presidentId
                        }
                    });
                }

                // Update Transaction
                const updatedTx = await tx.vaultTransaction.update({
                    where: { id: txId },
                    data: { status: 'COMPLETED' }
                });

                return { executed: true, data: updatedTx };
            }

            return { executed: false, data: null };
        });

        res.json({ success: true, message: result.executed ? "Approuvé et Exécuté !" : "Approuvé. En attente d'autres valideurs.", data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Récupérer les bons de retrait (vouchers) du président
router.get('/vouchers/my', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const vouchers = await prisma.vaultVoucher.findMany({
            where: { presidentId: req.userId!, status: 'ACTIVE' },
            include: { vault: { select: { name: true } } }
        });
        res.json({ success: true, data: vouchers });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Dépenser un bon de retrait (paiement marchand ou agence)
router.post('/vouchers/:id/spend', authMiddleware, async (req: AuthRequest, res) => {
    const voucherId = req.params.id as string;
    const { destinationPhone } = req.body;

    try {
        const result = await prisma.$transaction(async (tx) => {
            const voucher = await tx.vaultVoucher.findUnique({ where: { id: voucherId } });

            if (!voucher) throw new Error("Bon de retrait introuvable.");
            if (voucher.status !== 'ACTIVE') throw new Error("Ce bon de retrait est déjà utilisé ou inactif.");
            if (voucher.presidentId !== req.userId!) throw new Error("Vous n'êtes pas le propriétaire de ce bon.");

            const merchantUser = await tx.user.findUnique({ where: { phone: destinationPhone }, include: { wallet: true } });
            if (!merchantUser || !merchantUser.wallet) throw new Error("Le portefeuille destinataire (marchand/agence) est introuvable avec ce numéro.");

            const merchantWallet = merchantUser.wallet;

            // Exécution
            await tx.wallet.update({
                where: { id: merchantWallet.id },
                data: { balance: { increment: voucher.amount } }
            });

            // Marquer le bon comme utilisé
            const updatedVoucher = await tx.vaultVoucher.update({
                where: { id: voucherId },
                data: { status: 'USED', usedAt: new Date() }
            });

            return { voucher: updatedVoucher, destination: merchantWallet.id };
        });

        res.json({ success: true, message: "Paiement réussi avec le Bon de Retrait !", data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;
