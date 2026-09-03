import bcrypt from 'bcryptjs';
import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { applyRoleChangeGuards, executeVaultWithdraw } from '../services/vaultService';
import { sendPush } from './wallet';

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

        // Sans push/socket, la personne ajoutée n'apprenait qu'elle est membre qu'en ouvrant
        // l'app par hasard — seule la ligne en base était créée, aucun signal temps réel.
        const memberNotifTitle = 'Ajouté à une caisse commune';
        const memberNotifBody = `Vous avez été ajouté à la caisse « ${vaultForNotif?.name ?? ''} ».`;
        await prisma.notification.create({
            data: {
                userId: userToAdd.id,
                title: memberNotifTitle,
                body: memberNotifBody,
                type: 'INFO'
            }
        });
        await sendPush(userToAdd.pushToken, memberNotifTitle, memberNotifBody);
        const io = req.app.get('io');
        if (io) io.to(`user_${userToAdd.phone}`).emit('global_push', { title: memberNotifTitle, body: memberNotifBody });

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

        // Une caisse sans aucun administrateur ne peut plus jamais être gérée, et une caisse
        // sans commissaire ne peut plus jamais approuver de retrait — voir applyRoleChangeGuards
        // (vaultService.ts), partagé avec l'override admin (admin.vaults.ts).
        try {
            await applyRoleChangeGuards(prisma, vaultId, targetUserId, { isAdmin, isValidator });
        } catch (guardError: any) {
            return res.status(400).json({ success: false, message: guardError.message });
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

// Ajuster le nom, la description et/ou le seuil d'approbation d'une caisse — le nom et la
// description n'avaient jusqu'ici aucun moyen d'être modifiés après création (contrairement
// au seuil, seul réglable ici depuis le début). Chaque champ est indépendamment optionnel :
// un appel ne renommant que la caisse n'a pas besoin de renvoyer le seuil actuel.
router.put('/:id/settings', authMiddleware, async (req: AuthRequest, res) => {
    const vaultId = req.params.id as string;
    const { requiredApprovals, name, description } = req.body;

    const data: { requiredApprovals?: number; name?: string; description?: string | null } = {};

    if (requiredApprovals !== undefined) {
        const parsed = Number(requiredApprovals);
        if (!Number.isFinite(parsed) || parsed < 1) {
            return res.status(400).json({ success: false, message: "Le seuil doit être un nombre entier d'au moins 1." });
        }
        data.requiredApprovals = Math.floor(parsed);
    }
    if (name !== undefined) {
        if (!String(name).trim()) return res.status(400).json({ success: false, message: "Le nom ne peut pas être vide." });
        data.name = String(name).trim();
    }
    if (description !== undefined) {
        data.description = String(description).trim() || null;
    }
    if (Object.keys(data).length === 0) {
        return res.status(400).json({ success: false, message: "Aucune modification fournie." });
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
            data
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

            const vaultForFreezeCheck = await tx.vault.findUnique({ where: { id: vaultId }, select: { isFrozen: true, frozenReason: true } });
            if (vaultForFreezeCheck?.isFrozen) {
                throw new Error(`Cette caisse est gelée par l'administration${vaultForFreezeCheck.frozenReason ? ` (${vaultForFreezeCheck.frozenReason})` : ''}. Dépôt impossible.`);
            }

            // Vérifier solde utilisateur
            const settings = await tx.systemSettings.findFirst();
            const fee = settings ? parsedAmount * settings.taxP2P : 0;
            const totalDebit = parsedAmount + fee;

            const userWallet = await tx.wallet.findUnique({ where: { userId: req.userId! } });
            if (!userWallet || userWallet.balance < totalDebit) {
                throw new Error(`Solde personnel insuffisant pour ce dépôt (incluant ${fee} FCFA de frais).`);
            }

            // Débit Wallet, Crédit Vault — garde atomique (balance: gte) : le contrôle
            // ci-dessus lit une balance non verrouillée, donc deux dépôts simultanés
            // (double-tap, deux appareils) pouvaient tous deux le passer et faire
            // passer le solde du déposant en négatif.
            const debited = await tx.wallet.updateMany({
                where: { id: userWallet.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });
            if (debited.count === 0) throw new Error("Solde personnel insuffisant");

            await tx.vault.update({
                where: { id: vaultId },
                data: { balance: { increment: parsedAmount } }
            });

            let corporateWalletId: string | null = null;
            if (fee > 0) {
                const { getOrCreateCorporateWallet } = await import('./wallet');
                const corporate = await getOrCreateCorporateWallet(tx);
                corporateWalletId = corporate.wallet.id;
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: fee } }
                });
            }

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

            // Trace dans l'historique standard
            await tx.transaction.create({
                data: {
                    amount: parsedAmount,
                    fee: fee,
                    senderWalletId: userWallet.id,
                    receiverWalletId: userWallet.id,
                    status: 'COMPLETED',
                    reference: `VAULT_DEP_${vtx.id}`
                }
            });

            // Transaction fantôme dédiée au frais — même convention que wallet.ts (FEE-,
            // FEE-W-, FEE-MM-) : sans elle, ce frais restait invisible des graphiques de
            // revenu (Dashboard.tsx/MacroStats.tsx/Ledger.tsx), qui n'agrègent QUE les
            // transactions dont la référence commence par "FEE", jamais le champ `fee` d'une
            // transaction principale — un vrai revenu de plateforme qui n'apparaissait nulle
            // part dans le chiffre d'affaires affiché à l'admin.
            if (fee > 0 && corporateWalletId) {
                await tx.transaction.create({
                    data: {
                        amount: fee,
                        senderWalletId: userWallet.id,
                        receiverWalletId: corporateWalletId,
                        status: 'COMPLETED',
                        reference: `FEE-VD-${vtx.id}`
                    }
                });
            }

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
        if (vault.isFrozen) {
            return res.status(400).json({ success: false, message: `Cette caisse est gelée par l'administration${vault.frozenReason ? ` (${vault.frozenReason})` : ''}. Retrait impossible.` });
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

        // Seuil et commissaires obligatoires figés dès la création (voir commentaire sur
        // requiredApprovalsSnapshot dans schema.prisma) : un membre qui quitte APRÈS n'érode
        // plus le quorum applicable à CETTE demande.
        const validatorsAtCreation = await prisma.vaultMember.findMany({ where: { vaultId, isValidator: true } });
        const requiredApprovalsSnapshot = Math.max(1, Math.min(vault.requiredApprovals, validatorsAtCreation.length));
        const requiredValidatorIdsSnapshot = validatorsAtCreation.filter(v => v.isRequiredValidator).map(v => v.userId);

        const tx = await prisma.vaultTransaction.create({
            data: {
                vaultId,
                type: 'WITHDRAW_REQUEST',
                amount: parsedAmount,
                status: 'PENDING',
                destinationType: destinationType || 'VOUCHER',
                destinationId: resolvedDestinationId,
                reason: String(reason).trim(),
                requestedById: req.userId!,
                requiredApprovalsSnapshot,
                requiredValidatorIdsSnapshot,
            }
        });

        // Chaque commissaire habilité à approuver doit être alerté qu'une
        // décision l'attend — sans ça, une demande pouvait rester invisible
        // indéfiniment pour les autres membres tant qu'ils ne rouvraient pas
        // la caisse par eux-mêmes.
        const validators = await prisma.vaultMember.findMany({
            where: { vaultId, isValidator: true, userId: { not: req.userId! } },
            include: { user: { select: { phone: true, pushToken: true } } }
        });
        if (validators.length > 0) {
            const notifTitle = 'Retrait à approuver';
            const notifBody = `${parsedAmount.toLocaleString('fr-FR')} FCFA demandés sur « ${vault.name} »${destinationLabel ? ` pour ${destinationLabel}` : ''}.`;
            await prisma.notification.createMany({
                data: validators.map(v => ({
                    userId: v.userId,
                    title: notifTitle,
                    body: notifBody,
                    type: 'TRANSACTION'
                }))
            });
            // Le commentaire ci-dessus décrivait déjà le problème (une demande invisible tant
            // que le commissaire ne rouvre pas l'app), mais seule la ligne en base était créée —
            // sans push ni Socket.IO, cette alerte n'était jamais réellement temps réel.
            const io = req.app.get('io');
            await Promise.all(validators.map(async v => {
                await sendPush(v.user.pushToken, notifTitle, notifBody);
                if (io) io.to(`user_${v.user.phone}`).emit('global_push', { title: notifTitle, body: notifBody });
            }));
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
            if (vaultTx.vault.isFrozen) {
                throw new Error(`Cette caisse est gelée par l'administration${vaultTx.vault.frozenReason ? ` (${vaultTx.vault.frozenReason})` : ''}. Approbation impossible tant que le gel n'est pas levé.`);
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

            // Seuil et commissaires obligatoires : lus depuis l'instantané figé à la CRÉATION
            // de la demande (requiredApprovalsSnapshot/requiredValidatorIdsSnapshot), pas
            // recalculés depuis les VaultMember courants — sinon un membre qui quitte APRÈS
            // qu'une demande a reçu ses premières approbations abaisse rétroactivement le
            // quorum applicable, voire fait disparaître l'obligation d'un validateur désigné
            // qui vient de partir. Repli sur l'ancien calcul en direct uniquement pour les
            // demandes déjà en attente créées avant l'ajout de cet instantané (snapshot null).
            let requiredApprovals = vaultTx.requiredApprovalsSnapshot;
            let requiredValidatorIds: string[] = vaultTx.requiredValidatorIdsSnapshot;
            if (requiredApprovals === null || requiredApprovals === undefined) {
                const validatorCountArray = await tx.vaultMember.findMany({ where: { vaultId, isValidator: true } });
                requiredApprovals = Math.max(1, Math.min(vaultTx.vault.requiredApprovals, validatorCountArray.length));
                requiredValidatorIds = validatorCountArray.filter(v => v.isRequiredValidator).map(v => v.userId);
            }

            const missingRequiredValidators = requiredValidatorIds.filter(id => !approvedUserIds.includes(id));

            if (currentApprovalsCount >= requiredApprovals && missingRequiredValidators.length === 0) {
                // Réclamation atomique AVANT tout mouvement de fonds (même pattern que
                // Treasury et le CRON Tontine) : sans elle, deux validateurs donnant la
                // dernière approbation requise en même temps lisent chacun le même instantané
                // non verrouillé de `vaultTx.approvals`, concluent chacun indépendamment que
                // le quorum est atteint, et exécutaient CHACUN le retrait — double débit de
                // la caisse et double crédit du destinataire tant que le solde suffisait à
                // couvrir les deux passages (la garde `balance: gte` juste en dessous
                // empêche seulement de passer sous zéro, pas la double exécution).
                const claim = await tx.vaultTransaction.updateMany({
                    where: { id: txId, status: 'PENDING' },
                    data: { status: 'COMPLETED' }
                });
                if (claim.count === 0) throw new Error("Ce retrait vient d'être traité par un autre validateur.");

                // Débit + exécution (TREASURER/TRANSFER/VOUCHER) + notification au demandeur —
                // logique partagée avec l'override admin (admin.vaults.ts, force-resolve).
                await executeVaultWithdraw(tx, vaultTx);

                // Statut déjà passé à COMPLETED par la réclamation atomique ci-dessus — pas
                // besoin d'un second UPDATE, la ligne renvoyée en réponse est reconstruite
                // localement plutôt que relue.
                const updatedTx = { ...vaultTx, status: 'COMPLETED' as const };

                return { executed: true, data: updatedTx };
            }

            // Retrait pas encore exécuté : le demandeur voit sa progression sans avoir
            // à rouvrir la caisse pour vérifier lui-même où en sont les approbations —
            // et, le cas échéant, QUI bloque encore (validateur obligatoire non répondu),
            // pas seulement combien il en manque.
            const missingNames = missingRequiredValidators.length > 0
                ? (await tx.user.findMany({ where: { id: { in: missingRequiredValidators } }, select: { name: true } })).map(u => u.name)
                : [];
            const progressBody = missingNames.length > 0
                ? `${currentApprovalsCount}/${requiredApprovals} approbations reçues sur « ${vaultTx.vault.name} ». En attente de : ${missingNames.join(', ')} (validateur obligatoire).`
                : `${currentApprovalsCount}/${requiredApprovals} approbations reçues sur « ${vaultTx.vault.name} ».`;
            const progressTitle = 'Retrait approuvé — en attente';
            await tx.notification.create({
                data: { userId: vaultTx.requestedById, title: progressTitle, body: progressBody, type: 'TRANSACTION' }
            });
            const requester = await tx.user.findUnique({ where: { id: vaultTx.requestedById }, select: { pushToken: true } });
            if (requester?.pushToken) await sendPush(requester.pushToken, progressTitle, progressBody);

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

            const ownerVault = await tx.vault.findUnique({ where: { id: voucher.vaultId }, select: { isFrozen: true, frozenReason: true } });
            if (ownerVault?.isFrozen) {
                throw new Error(`La caisse émettrice est gelée par l'administration${ownerVault.frozenReason ? ` (${ownerVault.frozenReason})` : ''}. Ce bon ne peut pas être dépensé.`);
            }

            const merchantUser = await tx.user.findUnique({ where: { phone: destinationPhone }, include: { wallet: true } });
            if (!merchantUser || !merchantUser.wallet) throw new Error("Le portefeuille destinataire (marchand/agence) est introuvable avec ce numéro.");

            const merchantWallet = merchantUser.wallet;

            // Réclamer le bon AVANT de créditer quoi que ce soit : le `findUnique` ci-dessus
            // ne verrouille aucune ligne, donc deux appels concurrents liraient tous deux
            // `ACTIVE` avant qu'aucun des deux n'écrive. Seule cette transition conditionnelle
            // (évaluée par Postgres sous le verrou de ligne pris par l'UPDATE) empêche un
            // double crédit marchand pour un seul bon.
            const claim = await tx.vaultVoucher.updateMany({
                where: { id: voucherId, status: 'ACTIVE' },
                data: { status: 'USED', usedAt: new Date() }
            });
            if (claim.count === 0) throw new Error("Ce bon de retrait est déjà utilisé ou inactif.");

            // Avant ce correctif, dépenser un bon ne prélevait aucun frais (contrairement aux
            // deux autres façons de sortir l'argent d'une caisse — Trésorier et Transfert
            // direct, voir vaultService.ts, qui appliquent déjà taxP2P) et ne créait même
            // aucune ligne Transaction : ce mouvement était à la fois gratuit pour la
            // plateforme ET invisible dans l'historique du marchand qui le recevait.
            const settings = await tx.systemSettings.findFirst();
            const fee = settings ? voucher.amount * settings.taxP2P : 0;
            const netAmount = voucher.amount - fee;

            // Exécution
            await tx.wallet.update({
                where: { id: merchantWallet.id },
                data: { balance: { increment: netAmount } }
            });

            let corporateWalletId: string | null = null;
            if (fee > 0) {
                const { getOrCreateCorporateWallet } = await import('./wallet');
                const corporate = await getOrCreateCorporateWallet(tx);
                corporateWalletId = corporate.wallet.id;
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: fee } }
                });
            }

            // Même convention que VAULT_DEP_/VAULT_OUT_ ci-dessus : la Caisse Commune n'a pas
            // de Wallet propre (son solde vit sur Vault.balance), donc sender/receiver
            // pointent tous deux vers le seul wallet réel impliqué — ici celui du marchand.
            await tx.transaction.create({
                data: {
                    amount: voucher.amount,
                    fee,
                    senderWalletId: merchantWallet.id,
                    receiverWalletId: merchantWallet.id,
                    status: 'COMPLETED',
                    reference: `VAULT_VOUCHER_${voucher.id}`
                }
            });

            // Transaction fantôme dédiée au frais — voir commentaire sur VAULT_DEP_ ci-dessus.
            if (fee > 0 && corporateWalletId) {
                await tx.transaction.create({
                    data: {
                        amount: fee,
                        senderWalletId: merchantWallet.id,
                        receiverWalletId: corporateWalletId,
                        status: 'COMPLETED',
                        reference: `FEE-VV-${voucher.id}`
                    }
                });
            }

            const updatedVoucher = { ...voucher, status: 'USED' as const, usedAt: new Date() };

            const voucherTitle = 'Bon de caisse commune reçu';
            const voucherBody = `${netAmount.toLocaleString('fr-FR')} FCFA reçus via un bon de retrait Mongain${fee > 0 ? ` (après ${fee.toLocaleString('fr-FR')} FCFA de frais)` : ''}.`;
            await tx.notification.create({
                data: { userId: merchantUser.id, title: voucherTitle, body: voucherBody, type: 'TRANSACTION' }
            });

            return { voucher: updatedVoucher, destination: merchantWallet.id, destinationName: merchantUser.name, voucherTitle, voucherBody, merchantPhone: merchantUser.phone, merchantPushToken: merchantUser.pushToken };
        });

        await sendPush(result.merchantPushToken, result.voucherTitle, result.voucherBody);
        const io = req.app.get('io');
        if (io) io.to(`user_${result.merchantPhone}`).emit('global_push', { title: result.voucherTitle, body: result.voucherBody });

        res.json({ success: true, message: "Paiement réussi avec le Bon de Retrait !", data: result });
    } catch (error: any) {
        res.status(400).json({ success: false, message: error.message });
    }
});

export default router;
