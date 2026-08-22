import bcrypt from 'bcryptjs';
import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

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
    const { name, description, requiredApprovals } = req.body;
    // Toujours au moins 1 : une caisse ne doit jamais démarrer sur un seuil
    // qu'aucun validateur seul ne pourrait atteindre.
    const parsedThreshold = Number.isFinite(Number(requiredApprovals)) && Number(requiredApprovals) >= 1
        ? Math.floor(Number(requiredApprovals))
        : 1;
    try {
        const vault = await prisma.$transaction(async (tx) => {
            const newVault = await tx.vault.create({
                data: {
                    name,
                    description,
                    adminId: req.userId!,
                    requiredApprovals: parsedThreshold
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

        const vaultForNotif = await prisma.vault.findUnique({ where: { id: vaultId } });

        const newMember = await prisma.vaultMember.upsert({
            where: { vaultId_userId: { vaultId, userId: userToAdd.id } },
            update: {}, // Already member
            create: {
                vaultId,
                userId: userToAdd.id
            }
        });

        // Sans ça, la personne ajoutée n'apprenait qu'elle est membre qu'en ouvrant
        // l'app par hasard — aucun signal ne l'en informait jamais.
        await prisma.notification.create({
            data: {
                userId: userToAdd.id,
                title: 'Ajouté à une caisse commune',
                body: `Vous avez été ajouté à la caisse « ${vaultForNotif?.name ?? ''} ».`,
                type: 'INFO'
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
    const { targetUserId, isInitiator, isValidator, isTreasurer, isAdmin, isRequiredValidator } = req.body;

    try {
        const adminCheck = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!adminCheck || !adminCheck.isAdmin) {
            return res.status(403).json({ success: false, message: "Action réservée à l'administrateur de la caisse." });
        }

        // Sans ce contrôle, cibler un utilisateur qui n'est pas (encore) membre de
        // cette caisse laissait Prisma remonter une erreur brute de type "Record to
        // update not found" jusqu'au client, au lieu d'un message exploitable.
        const targetMember = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: targetUserId } }
        });
        if (!targetMember) {
            return res.status(404).json({ success: false, message: "Cette personne n'est pas membre de la caisse — invitez-la d'abord." });
        }

        // Une caisse sans aucun administrateur ne peut plus jamais être gérée
        // (personne ne peut plus inviter, changer un rôle, ou ajuster le seuil
        // d'approbation) — on refuse donc de retirer le dernier isAdmin restant.
        if (isAdmin === false) {
            const otherAdmins = await prisma.vaultMember.count({
                where: { vaultId, isAdmin: true, userId: { not: targetUserId } }
            });
            if (otherAdmins === 0) {
                return res.status(400).json({ success: false, message: "Impossible de retirer le dernier administrateur de la caisse." });
            }
        }

        // Sans ce contrôle, décocher le dernier commissaire restant rendait la caisse
        // définitivement bloquée : plus aucun retrait n'aurait jamais pu être approuvé
        // (même bug de fond que le seuil requiredApprovals corrigé plus tôt dans cette caisse).
        if (isValidator === false) {
            const otherValidators = await prisma.vaultMember.count({
                where: { vaultId, isValidator: true, userId: { not: targetUserId } }
            });
            if (otherValidators === 0) {
                return res.status(400).json({ success: false, message: "Impossible de retirer le dernier commissaire — plus personne ne pourrait approuver un retrait." });
            }
        }

        // Un validateur obligatoire est nécessairement un validateur : si Commissaire est
        // retiré (ou jamais accordé) dans cette même requête, on efface aussi le caractère
        // obligatoire plutôt que de laisser un état incohérent (obligatoire mais pas
        // habilité à approuver).
        const resolvedIsValidator = isValidator ?? targetMember.isValidator;
        const resolvedIsRequiredValidator = resolvedIsValidator ? (isRequiredValidator ?? targetMember.isRequiredValidator) : false;

        const updatedRole = await prisma.vaultMember.update({
            where: { vaultId_userId: { vaultId, userId: targetUserId } },
            data: { isInitiator, isValidator, isTreasurer, isAdmin, isRequiredValidator: resolvedIsRequiredValidator }
        });

        res.json({ success: true, data: updatedRole });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Ajuster le nombre d'approbations requises pour un retrait (le Président peut
// le relever au fur et à mesure que la caisse accueille des commissaires).
router.put('/:id/settings', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { requiredApprovals } = req.body;
    const parsed = Number(requiredApprovals);

    if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({ success: false, message: "Le seuil doit être un nombre entier d'au moins 1." });
    }

    try {
        const adminCheck = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });
        if (!adminCheck || !adminCheck.isAdmin) {
            return res.status(403).json({ success: false, message: "Action réservée à l'administrateur de la caisse." });
        }

        const updated = await prisma.vault.update({
            where: { id: vaultId },
            data: { requiredApprovals: Math.floor(parsed) }
        });

        res.json({ success: true, data: updated });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Quitter une caisse — chaque membre doit pouvoir partir de lui-même s'il le
// souhaite, sans dépendre du bon vouloir du Président.
router.post('/:id/leave', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;

    try {
        const membership = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });
        if (!membership) return res.status(404).json({ success: false, message: "Vous n'êtes pas membre de cette caisse." });

        if (membership.isAdmin) {
            const otherAdmins = await prisma.vaultMember.count({
                where: { vaultId, isAdmin: true, userId: { not: req.userId! } }
            });
            if (otherAdmins === 0) {
                const otherMembers = await prisma.vaultMember.count({
                    where: { vaultId, userId: { not: req.userId! } }
                });
                if (otherMembers > 0) {
                    return res.status(400).json({ success: false, message: "Désignez un autre Président avant de quitter la caisse." });
                }
                // Dernier membre restant : ne partez pas en laissant des fonds
                // orphelins que plus personne ne pourrait jamais réclamer.
                const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
                if (vault && vault.balance > 0) {
                    return res.status(400).json({ success: false, message: "Retirez d'abord les fonds de la caisse (solde non nul) avant de la quitter." });
                }
            }
        }

        await prisma.vaultMember.delete({ where: { vaultId_userId: { vaultId, userId: req.userId! } } });

        res.json({ success: true, message: "Vous avez quitté la caisse." });
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

            // Débit Wallet, Crédit Vault — garde atomique (balance: gte) : le contrôle
            // ci-dessus lit une balance non verrouillée, donc deux dépôts simultanés
            // (double-tap, deux appareils) pouvaient tous deux le passer et faire
            // passer le solde du déposant en négatif.
            const debited = await tx.wallet.updateMany({
                where: { id: userWallet.id, balance: { gte: parsedAmount } },
                data: { balance: { decrement: parsedAmount } }
            });
            if (debited.count === 0) throw new Error("Solde personnel insuffisant");

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
    // destinationType: TREASURER (vers un membre trésorier), VOUCHER (bon à
    // redeemer plus tard), ou TRANSFER (envoi direct à n'importe quel numéro
    // Mongain — pratique pour payer un prestataire externe, mais c'est aussi
    // le chemin le plus à risque : un seul commissaire, seul, ne doit jamais
    // pouvoir faire sortir de l'argent vers un tiers quelconque sans second avis.
    const { amount, destinationType, destinationId, destinationPhone, reason } = req.body;
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: "Montant invalide" });
    }
    if (!reason || String(reason).trim().length < 3) {
        return res.status(400).json({ success: false, message: "Indiquez le motif de ce retrait (au moins 3 caractères)." });
    }

    try {
        const membership = await prisma.vaultMember.findUnique({
            where: { vaultId_userId: { vaultId, userId: req.userId! } }
        });

        if (!membership || !membership.isInitiator) {
            return res.status(403).json({ success: false, message: "Seul le Secrétaire (Initiator) peut demander un retrait." });
        }

        const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
        if (!vault || vault.balance < parsedAmount) {
            return res.status(400).json({ success: false, message: "Le solde de la caisse est insuffisant." });
        }

        let resolvedDestinationId = destinationId;
        let destinationLabel: string | null = null;

        if (destinationType === 'TRANSFER') {
            // Le nombre d'approbations nécessaires pour un envoi direct — comme pour
            // les autres modes — est entièrement gouverné par vault.requiredApprovals,
            // que le Président choisit lui-même (PUT /:id/settings) : 1 s'il veut
            // pouvoir agir seul, 2 ou plus s'il veut une validation collective. Pas de
            // règle spéciale codée en dur ici — c'est un choix de gouvernance, pas une
            // contrainte imposée par la plateforme.
            if (!destinationPhone) {
                return res.status(400).json({ success: false, message: "Numéro du destinataire requis." });
            }
            const recipient = await prisma.user.findUnique({ where: { phone: destinationPhone } });
            if (!recipient) {
                return res.status(404).json({ success: false, message: "Aucun compte Mongain trouvé avec ce numéro." });
            }
            resolvedDestinationId = recipient.id;
            destinationLabel = recipient.name;
        }

        const tx = await prisma.vaultTransaction.create({
            data: {
                vaultId,
                type: 'WITHDRAW_REQUEST',
                amount: parsedAmount,
                status: 'PENDING',
                destinationType: destinationType || 'VOUCHER',
                destinationId: resolvedDestinationId,
                reason: String(reason).trim(),
                requestedById: req.userId!
            }
        });

        // Chaque commissaire habilité à approuver doit être alerté qu'une
        // décision l'attend — sans ça, une demande pouvait rester invisible
        // indéfiniment pour les autres membres tant qu'ils ne rouvraient pas
        // la caisse par eux-mêmes.
        const validators = await prisma.vaultMember.findMany({ where: { vaultId, isValidator: true, userId: { not: req.userId! } } });
        if (validators.length > 0) {
            await prisma.notification.createMany({
                data: validators.map(v => ({
                    userId: v.userId,
                    title: 'Retrait à approuver',
                    body: `${parsedAmount.toLocaleString('fr-FR')} FCFA demandés sur « ${vault.name} »${destinationLabel ? ` pour ${destinationLabel}` : ''}.`,
                    type: 'TRANSACTION'
                }))
            });
        }

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

            const approvedUserIds = [...vaultTx.approvals.map(a => a.userId), req.userId!];
            const currentApprovalsCount = approvedUserIds.length;
            const validatorCountArray = await tx.vaultMember.findMany({ where: { vaultId, isValidator: true } });

            // Le seuil configuré par la caisse (vault.requiredApprovals, réglable par le
            // Président depuis PUT /:id/settings) gouverne tous les types de retrait de
            // la même façon, envoi direct compris — 1 pour pouvoir agir seul, 2 ou plus
            // pour exiger une validation collective. C'est un choix de gouvernance laissé
            // au Président, pas une règle différente selon la destination. Il ne peut
            // toutefois jamais dépasser le nombre de commissaires réellement disponibles
            // (sinon un commissaire qui quitte la caisse rendrait tout retrait futur
            // définitivement impossible à approuver) — d'où le plus petit des deux, avec
            // un plancher de 1.
            const requiredApprovals = Math.max(1, Math.min(vaultTx.vault.requiredApprovals, validatorCountArray.length));

            // Au-delà du simple seuil numérique, le Président peut désigner des commissaires
            // dont l'approbation est spécifiquement obligatoire (VaultMember.isRequiredValidator)
            // — répond au besoin de choisir QUI doit valider, pas seulement COMBIEN. Tant que
            // l'un d'eux n'a pas approuvé, le retrait reste bloqué même si le seuil numérique
            // est déjà atteint par d'autres commissaires.
            const missingRequiredValidators = validatorCountArray.filter(v => v.isRequiredValidator && !approvedUserIds.includes(v.userId));

            if (currentApprovalsCount >= requiredApprovals && missingRequiredValidators.length === 0) {
                // Débit Caisse — garde atomique (balance: gte) : deux demandes de retrait
                // approuvées au même moment pouvaient toutes deux passer ce point et faire
                // passer le solde de la caisse en négatif.
                const debited = await tx.vault.updateMany({
                    where: { id: vaultTx.vaultId, balance: { gte: vaultTx.amount } },
                    data: { balance: { decrement: vaultTx.amount } }
                });
                if (debited.count === 0) throw new Error("Solde de la caisse insuffisant pour exécuter ce retrait.");

                // Execution — TREASURER (membre trésorier désigné) et TRANSFER (numéro
                // Mongain quelconque, résolu à la demande) créditent tous deux directement
                // un portefeuille par userId ; seule la restriction au moment de la
                // demande diffère (TREASURER est limité aux membres isTreasurer=true).
                if (vaultTx.destinationType === 'TREASURER' || vaultTx.destinationType === 'TRANSFER') {
                    if (!vaultTx.destinationId) throw new Error("Destinataire manquant.");

                    const destWallet = await tx.wallet.findUnique({ where: { userId: vaultTx.destinationId } });
                    if (!destWallet) throw new Error("Portefeuille destinataire introuvable.");

                    await tx.wallet.update({
                        where: { id: destWallet.id },
                        data: { balance: { increment: vaultTx.amount } }
                    });

                    await tx.notification.create({
                        data: {
                            userId: vaultTx.destinationId,
                            title: 'Vous avez reçu un virement de caisse commune',
                            body: `${vaultTx.amount.toLocaleString('fr-FR')} FCFA reçus depuis « ${vaultTx.vault.name} ».`,
                            type: 'TRANSACTION'
                        }
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

                // Le Secrétaire qui a initié la demande n'a autrement aucun moyen d'être
                // averti que son retrait est passé, hormis rouvrir la caisse manuellement.
                await tx.notification.create({
                    data: {
                        userId: vaultTx.requestedById,
                        title: 'Retrait de caisse exécuté',
                        body: `Votre demande de ${vaultTx.amount.toLocaleString('fr-FR')} FCFA sur « ${vaultTx.vault.name} » a été approuvée et exécutée.`,
                        type: 'TRANSACTION'
                    }
                });

                return { executed: true, data: updatedTx };
            }

            // Retrait pas encore exécuté : le demandeur voit sa progression sans avoir
            // à rouvrir la caisse pour vérifier lui-même où en sont les approbations —
            // et, le cas échéant, QUI bloque encore (validateur obligatoire non répondu),
            // pas seulement combien il en manque.
            const missingNames = missingRequiredValidators.length > 0
                ? (await tx.user.findMany({ where: { id: { in: missingRequiredValidators.map(v => v.userId) } }, select: { name: true } })).map(u => u.name)
                : [];
            const progressBody = missingNames.length > 0
                ? `${currentApprovalsCount}/${requiredApprovals} approbations reçues sur « ${vaultTx.vault.name} ». En attente de : ${missingNames.join(', ')} (validateur obligatoire).`
                : `${currentApprovalsCount}/${requiredApprovals} approbations reçues sur « ${vaultTx.vault.name} ».`;
            await tx.notification.create({
                data: {
                    userId: vaultTx.requestedById,
                    title: 'Retrait approuvé — en attente',
                    body: progressBody,
                    type: 'TRANSACTION'
                }
            });

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
//
// Avant ce correctif, un tap suffisait à vider un bon — aucune vérification
// d'identité, contrairement à absolument toute autre opération financière de
// l'app. Même schéma que wallet.ts /transfer : le PIN est vérifié et les
// tentatives échouées comptabilisées EN DEHORS de la transaction financière,
// car un throw dans un $transaction interactif annule aussi l'écriture qui
// enregistre la tentative échouée.
router.post('/vouchers/:id/spend', authMiddleware, async (req: AuthRequest, res) => {
    const voucherId = req.params.id as string;
    const { destinationPhone, pin } = req.body;

    if (!pin || String(pin).length !== 4) {
        return res.status(400).json({ success: false, message: "Code PIN requis." });
    }

    try {
        const requester = await prisma.user.findUnique({ where: { id: req.userId! } });
        if (!requester) return res.status(404).json({ success: false, message: "Compte introuvable." });

        if (requester.lockedUntil && requester.lockedUntil > new Date()) {
            return res.status(400).json({ success: false, message: "Compte temporairement bloqué suite à plusieurs échecs. Réessayez plus tard." });
        }

        const pinMatch = await bcrypt.compare(String(pin), requester.pin);
        if (!pinMatch) {
            const attempts = requester.failedPinAttempts + 1;
            const isLocked = attempts >= 3;
            await prisma.user.update({
                where: { id: requester.id },
                data: { failedPinAttempts: attempts, lockedUntil: isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null }
            });
            return res.status(400).json({ success: false, message: isLocked ? "Compte bloqué (3 échecs). Réessayez dans 15 minutes." : `Code PIN incorrect. Tentative ${attempts}/3.` });
        }
        if (requester.failedPinAttempts > 0) {
            await prisma.user.update({ where: { id: requester.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
        }

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

            await tx.notification.create({
                data: {
                    userId: merchantUser.id,
                    title: 'Bon de caisse commune reçu',
                    body: `${voucher.amount.toLocaleString('fr-FR')} FCFA reçus via un bon de retrait Mongain.`,
                    type: 'TRANSACTION'
                }
            });

            return { voucher: updatedVoucher, destination: merchantWallet.id, destinationName: merchantUser.name };
        });

        res.json({ success: true, message: "Paiement réussi avec le Bon de Retrait !", data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;
