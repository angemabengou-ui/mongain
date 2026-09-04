import express, { Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { hasPermission } from '../services/RBAC';
import { contributeNow, executeTontineCycle, resolveRenewalPoll } from '../services/tontineService';
import { friendlyErrorMessage } from '../utils/errors';

const router = express.Router();

// Créer un groupe de Tontine
router.post('/create', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { name, contribution, frequency, isPublic } = req.body;

        if (!name || !contribution) {
            return res.status(400).json({ success: false, message: "Nom et contribution requis." });
        }

        const contributionAmount = parseFloat(contribution);
        if (isNaN(contributionAmount) || contributionAmount <= 0) {
            return res.status(400).json({ success: false, message: "Montant de cotisation invalide." });
        }

        const group = await prisma.tontineGroup.create({
            data: {
                creatorId: userId,
                name,
                contribution: contributionAmount,
                frequency: frequency || 'MONTHLY',
                status: 'ACTIVE',
                isPublic: !!isPublic
            }
        });

        // Le créateur rejoint automatiquement le groupe
        await prisma.tontineParticipant.create({
            data: {
                userId,
                tontineGroupId: group.id,
                payoutOrder: 1
            }
        });

        res.json({ success: true, message: "Club créé avec succès.", data: group });
    } catch (error: any) {
        console.error("Erreur création Tontine:", error);
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Modifier les paramètres d'un club — réservé au créateur. Le nom et le statut public
// restent modifiables à tout moment (aucun impact sur les cycles déjà exécutés). La
// cotisation et la fréquence, en revanche, sont figées dès que le premier cycle a tourné :
// les changer en cours de route créerait une incohérence entre ce que les premiers membres
// ont déjà payé et ce qui serait prélevé ensuite, ou déclencherait un cycle prématuré si la
// fréquence raccourcit alors qu'un délai plus long court déjà depuis le dernier versement.
router.put('/settings', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId, name, contribution, frequency, isPublic } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group) return res.status(404).json({ success: false, message: 'Club introuvable.' });
        if (group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: 'Seul le créateur peut modifier les paramètres du club.' });
        }

        const data: { name?: string; contribution?: number; frequency?: string; isPublic?: boolean } = {};

        if (name !== undefined) {
            if (!String(name).trim()) return res.status(400).json({ success: false, message: 'Le nom ne peut pas être vide.' });
            data.name = String(name).trim();
        }
        if (isPublic !== undefined) {
            data.isPublic = !!isPublic;
        }

        if (contribution !== undefined || frequency !== undefined) {
            const hasStarted = (await prisma.tontineCycle.count({ where: { tontineGroupId: group.id } })) > 0;
            if (hasStarted) {
                return res.status(400).json({ success: false, message: 'Impossible de modifier la cotisation ou la fréquence : le premier cycle a déjà été exécuté.' });
            }
            if (contribution !== undefined) {
                const amt = parseFloat(contribution);
                if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, message: 'Montant de cotisation invalide.' });
                data.contribution = amt;
            }
            if (frequency !== undefined) {
                if (frequency !== 'WEEKLY' && frequency !== 'MONTHLY') return res.status(400).json({ success: false, message: 'Fréquence invalide.' });
                data.frequency = frequency;
            }
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({ success: false, message: 'Aucune modification fournie.' });
        }

        const updated = await prisma.tontineGroup.update({ where: { id: group.id }, data });
        res.json({ success: true, message: 'Paramètres mis à jour.', data: updated });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, 'Erreur serveur') });
    }
});

// Dissoudre définitivement un club — le schéma prévoyait un statut CANCELLED depuis
// l'origine (voir schema.prisma, TontineGroup.status) mais aucune route ne l'a jamais
// utilisé : jusqu'ici, la seule façon de mettre fin à une tontine était que chaque membre
// la quitte un par un, ou une mise en pause (temporaire, admin uniquement). Réservé au
// créateur ; le CRON (cron.ts, filtre status:'ACTIVE') ignorera ce groupe dès que le
// statut change, sans avoir besoin d'un garde-fou supplémentaire côté cron.
router.post('/cancel', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group) return res.status(404).json({ success: false, message: 'Club introuvable.' });
        if (group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: 'Seul le créateur peut dissoudre le club.' });
        }
        if (group.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: 'Ce club est déjà dissous ou terminé.' });
        }

        // Un cycle dont la collecte a réussi mais dont le versement est resté bloqué laisse
        // de l'argent réel immobilisé dans le Coffre Tontine (partagé entre tous les
        // groupes) — dissoudre le club maintenant le laisserait sans propriétaire ni recours
        // pour le bénéficiaire visé. Il faut d'abord résoudre ce versement (voir
        // admin.tontines.ts, retry) avant de pouvoir dissoudre.
        const stuckCycle = await prisma.tontineCycle.findFirst({ where: { tontineGroupId: group.id, status: 'PAYOUT_FAILED' } });
        if (stuckCycle) {
            return res.status(400).json({ success: false, message: `Le versement du cycle #${stuckCycle.cycleNumber} est encore bloqué — faites-le résoudre par le support avant de dissoudre le club.` });
        }

        const updated = await prisma.tontineGroup.update({ where: { id: group.id }, data: { status: 'CANCELLED' } });

        const activeParticipants = await prisma.tontineParticipant.findMany({
            where: { tontineGroupId: group.id, status: 'ACTIVE', userId: { not: userId } },
            select: { userId: true, user: { select: { pushToken: true } } }
        });
        if (activeParticipants.length > 0) {
            await prisma.notification.createMany({
                data: activeParticipants.map((p) => ({
                    userId: p.userId,
                    title: 'Tontine dissoute',
                    body: `« ${group.name} » a été dissoute par son créateur. Plus aucune cotisation ne sera prélevée.`,
                    type: 'ALERT'
                }))
            });
            const { sendPush } = await import('./wallet');
            await Promise.all(activeParticipants.map((p) => sendPush(p.user.pushToken, 'Tontine dissoute', `« ${group.name} » a été dissoute par son créateur.`)));
        }

        res.json({ success: true, message: 'Le club a été dissous.', data: updated });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, 'Erreur serveur') });
    }
});

// Récupérer uniquement les tontines de l'utilisateur (Publique -> Privée)
router.get('/groups', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;

        // Participations de l'utilisateur
        const myParticipations = await prisma.tontineParticipant.findMany({
            where: { userId },
            include: {
                group: {
                    include: {
                        // Filtré sur ACTIVE (comme tontine-detail.tsx, qui compte lui aussi les
                        // seuls participants actifs) — sans ce filtre, le nombre affiché ici
                        // incluait aussi les LEFT, divergeant de l'écran de détail du même groupe
                        // (ex: "3 sur 5" ici, "Ordre de passage (3)" dans le détail).
                        _count: { select: { participants: { where: { status: 'ACTIVE' } } } }
                    }
                }
            },
            orderBy: { joinedAt: 'desc' }
        });

        res.json({
            success: true,
            data: {
                groups: [], // Vide pour compatibilité ou supprimer du front plus tard
                myParticipations
            }
        });
    } catch (error: any) {
        console.error("Erreur récupération Tontine:", error);
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Découverte de tontines publiques à rejoindre librement (isPublic=true) — jusqu'ici,
// apiJoinTontine n'était appelable que si l'on connaissait déjà un groupId (invitation),
// aucun parcours de navigation/recherche ne menait à cette route côté app.
router.get('/discover', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const q = ((req.query.q as string) || '').trim();

        // Un LEFT peut redécouvrir et rejoindre à nouveau un club qu'il a quitté — seule une
        // ligne encore ACTIVE/PAUSED doit masquer le club de cette liste (même logique que
        // POST /join, voir plus bas).
        const alreadyIn = await prisma.tontineParticipant.findMany({ where: { userId, status: { not: 'LEFT' } }, select: { tontineGroupId: true } });
        const excludedIds = alreadyIn.map(p => p.tontineGroupId);

        const groups = await prisma.tontineGroup.findMany({
            where: {
                isPublic: true,
                status: 'ACTIVE',
                isPaused: false,
                id: { notIn: excludedIds },
                ...(q ? { name: { contains: q, mode: 'insensitive' } } : {})
            },
            // `select` explicite (pas `include`) : un club public expose son nom, sa
            // cotisation et son créateur à N'IMPORTE QUEL utilisateur connecté avant même
            // qu'il ne le rejoigne — `include` ferait fuiter des champs internes/admin comme
            // `pausedReason` (motif de litige saisi par le staff, voir admin.tontines.ts).
            select: {
                id: true,
                name: true,
                contribution: true,
                frequency: true,
                createdAt: true,
                creator: { select: { name: true } },
                _count: { select: { participants: { where: { status: 'ACTIVE' } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 30
        });

        res.json({ success: true, data: groups });
    } catch (error: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Détails complets d'un groupe (pour le créateur/participants)
router.get('/details/:groupId', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.params;

        const group = await prisma.tontineGroup.findUnique({
            where: { id: String(groupId) },
            include: {
                creator: { select: { name: true, phone: true } },
                participants: {
                    include: { user: { select: { name: true, phone: true } } },
                    orderBy: { payoutOrder: 'asc' }
                },
                // Grand livre structuré (TontineCycle/TontineContribution) : alimente
                // l'historique de cycles et le statut de cotisation par membre côté app.
                // Les groupes créés avant sa mise en place n'ont simplement aucun cycle ici.
                cycles: {
                    orderBy: { cycleNumber: 'desc' },
                    take: 12,
                    select: {
                        id: true, cycleNumber: true, status: true, beneficiaryParticipantId: true,
                        totalExpected: true, totalCollected: true, executedAt: true,
                        contributions: { select: { participantId: true, status: true, amount: true } }
                    }
                }
            }
        });

        if (!group) return res.status(404).json({ success: false, message: "Club introuvable" });

        // Seuls les membres peuvent voir
        const isMember = group.participants.some(p => p.userId === userId);
        if (!isMember) return res.status(403).json({ success: false, message: "Accès refusé" });

        res.json({ success: true, data: group });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Inviter un membre par téléphone
router.post('/invite', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId, phone } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group || group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: "Seul le créateur peut inviter." });
        }
        if (group.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: "Ce club est dissous — impossible d'y inviter quelqu'un." });
        }

        const invitee = await prisma.user.findUnique({ where: { phone } });
        if (!invitee) {
            return res.status(404).json({ success: false, message: "Numéro non trouvé sur Mongain." });
        }

        const participant = await prisma.$transaction(async (tx) => {
            // Même verrou et même calcul de payoutOrder que POST /join — voir les
            // commentaires là-bas : un simple count() collisionnait avec les membres
            // renumérotés après une relance de boucle (resolveRenewalPoll).
            await tx.$executeRaw`SELECT id FROM "TontineGroup" WHERE id = ${group.id} FOR UPDATE;`;

            const existing = await tx.tontineParticipant.findFirst({
                where: { userId: invitee.id, tontineGroupId: groupId, status: { not: 'LEFT' } }
            });
            if (existing) throw new Error('ALREADY_MEMBER');

            const activeParticipants = await tx.tontineParticipant.findMany({
                where: { tontineGroupId: groupId, status: 'ACTIVE' },
                select: { payoutOrder: true }
            });
            const maxOrder = Math.max(group.currentCycle - 1, 0, ...activeParticipants.map(p => p.payoutOrder));

            return tx.tontineParticipant.create({
                data: { userId: invitee.id, tontineGroupId: groupId, payoutOrder: maxOrder + 1 }
            });
        }).catch((e: any) => {
            if (e.message === 'ALREADY_MEMBER') return null;
            throw e;
        });

        if (!participant) {
            return res.status(400).json({ success: false, message: "Ce membre y est déjà." });
        }

        const inviteTitle = "Invitation Tontine 🤝";
        const inviteBody = `Vous avez été ajouté au club ${group.name}.`;
        await prisma.notification.create({
            data: { userId: invitee.id, title: inviteTitle, body: inviteBody, type: "INFO" }
        });
        const { sendPush } = await import('./wallet');
        await sendPush(invitee.pushToken, inviteTitle, inviteBody);

        res.json({ success: true, message: "Membre ajouté avec succès.", data: participant });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Quitter un club de tontine — chaque participant doit pouvoir se retirer de
// lui-même. On ne supprime pas la ligne (elle garde la trace des cotisations et
// cagnottes déjà versées) : on la marque LEFT, un statut déjà ignoré par le CRON
// de prélèvement (executeTontineCycle ne traite que status === 'ACTIVE').
router.post('/leave', authMiddleware, circuitBreakerMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        const participant = await prisma.tontineParticipant.findFirst({ where: { userId, tontineGroupId: groupId } });
        if (!participant) return res.status(404).json({ success: false, message: "Vous ne faites pas partie de ce club." });

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group) return res.status(404).json({ success: false, message: "Club introuvable." });

        // Un club dissous ne gère plus rien (voir POST /cancel) : le créateur n'a plus besoin
        // de rester pour "gérer" un club qui n'exécutera plus jamais de cycle.
        if (group.creatorId === userId && group.status === 'ACTIVE') {
            const otherActive = await prisma.tontineParticipant.count({
                where: { tontineGroupId: groupId, status: 'ACTIVE', userId: { not: userId } }
            });
            if (otherActive > 0) {
                return res.status(400).json({ success: false, message: "En tant que créateur, vous ne pouvez pas quitter tant que d'autres membres sont actifs dans le club." });
            }
        }

        // Les prélèvements de cotisation d'un cycle ne sont jamais forcés : le CRON
        // (executeTontineCycle) tente un débit et abandonne silencieusement en cas de
        // solde insuffisant, sans jamais revenir à la charge. Quitter est donc le seul
        // moment où l'on peut vraiment faire valoir une dette — une fois LEFT, le CRON
        // n'essaiera plus jamais de prélever cette personne. Si son tour est déjà passé
        // (elle a déjà touché la cagnotte), elle doit encore aux cycles restants des
        // autres membres qui, eux, n'ont pas encore été payés.
        const alreadyPaidOut = participant.payoutOrder < group.currentCycle;
        let debt = 0;
        let remainingBeneficiaryUserIds: string[] = [];

        // Un club dissous n'exécutera plus jamais aucun cycle (voir POST /cancel) : réclamer
        // une dette "envers les membres qui n'ont pas encore eu leur tour" n'aurait ici aucun
        // moyen d'être un jour reversée à qui que ce soit — ce serait prélever de l'argent
        // pour rien plutôt qu'un vrai solde dû.
        if (alreadyPaidOut && group.status === 'ACTIVE') {
            const remainingBeneficiaries = await prisma.tontineParticipant.findMany({
                where: { tontineGroupId: groupId, status: 'ACTIVE', payoutOrder: { gte: group.currentCycle }, userId: { not: userId } },
                select: { userId: true }
            });
            remainingBeneficiaryUserIds = remainingBeneficiaries.map(p => p.userId);
            debt = remainingBeneficiaryUserIds.length * group.contribution;
        }

        const myWallet = await prisma.wallet.findUnique({ where: { userId } });
        if (debt > 0 && (!myWallet || myWallet.balance < debt)) {
            const manque = debt - (myWallet?.balance || 0);
            return res.status(400).json({
                success: false,
                message: `Vous avez déjà reçu la cagnotte de ce club. Il vous reste ${debt.toLocaleString('fr-FR')} FCFA à cotiser envers les membres qui n'ont pas encore eu leur tour. Rechargez votre compte d'au moins ${manque.toLocaleString('fr-FR')} FCFA puis réessayez de quitter — le montant dû sera prélevé automatiquement.`
            });
        }

        await prisma.$transaction(async (tx) => {
            if (debt > 0 && remainingBeneficiaryUserIds.length > 0) {
                const debited = await tx.wallet.updateMany({
                    where: { userId, balance: { gte: debt } },
                    data: { balance: { decrement: debt } }
                });
                if (debited.count === 0) throw new Error('Solde insuffisant pour régler ce que vous devez au club.');

                // Reversé DIRECTEMENT à chacun des bénéficiaires restants (group.contribution
                // par personne — exactement la somme que `debt` leur attribue) plutôt que dans
                // le coffre TONTINE_VAULT partagé par TOUTES les tontines de la plateforme :
                // executeTontineCycle calcule `totalPot` uniquement à partir des cotisations du
                // cycle en cours, sans jamais lire ce coffre ni le redistribuer — l'argent y
                // restait donc immobilisé pour toujours, comingé avec celui des autres clubs,
                // pendant que CES bénéficiaires précis touchaient quand même une cagnotte
                // réduite (N-1 cotisations au lieu de N) à leur tour, sans jamais recevoir la
                // compensation que ce prélèvement était censé leur garantir.
                for (const beneficiaryUserId of remainingBeneficiaryUserIds) {
                    const beneficiaryWallet = await tx.wallet.findUnique({ where: { userId: beneficiaryUserId } });
                    if (!beneficiaryWallet) continue; // un membre ACTIVE a toujours un wallet ; garde défensive uniquement
                    await tx.wallet.update({ where: { id: beneficiaryWallet.id }, data: { balance: { increment: group.contribution } } });
                    await tx.transaction.create({
                        data: {
                            amount: group.contribution,
                            senderWalletId: myWallet!.id,
                            receiverWalletId: beneficiaryWallet.id,
                            status: 'COMPLETED',
                            reference: `TONT_EXITSHARE_${participant.id}_${beneficiaryUserId}`
                        }
                    });
                    await tx.notification.create({
                        data: {
                            userId: beneficiaryUserId,
                            title: 'Compensation reçue',
                            body: `Un membre de « ${group.name} » a quitté le club après avoir déjà reçu sa cagnotte : ${group.contribution.toLocaleString('fr-FR')} FCFA vous ont été reversés en compensation immédiate.`,
                            type: 'TRANSACTION'
                        }
                    });
                }
            }

            await tx.tontineParticipant.update({
                where: { id: participant.id },
                data: { status: 'LEFT' }
            });

            // S'il partait avant son tour, son numéro de passage devient un
            // cycle "mort" : plus personne n'a ce payoutOrder, donc ce
            // cycle-là collecterait des cotisations sans jamais les reverser
            // (executeTontineCycle ne trouve pas de bénéficiaire et passe son
            // tour). On resserre l'ordre des suivants pour combler le trou.
            // (Non applicable si son tour est déjà passé — sa dette vient
            // d'être réglée ci-dessus, pas de trou à combler dans ce cas.)
            if (!alreadyPaidOut) {
                await tx.tontineParticipant.updateMany({
                    where: { tontineGroupId: groupId, status: 'ACTIVE', payoutOrder: { gt: participant.payoutOrder } },
                    data: { payoutOrder: { decrement: 1 } }
                });
            }

            const leaveTitle = debt > 0 ? 'Dette de tontine réglée' : 'Tontine quittée';
            const leaveBody = debt > 0
                ? `${debt.toLocaleString('fr-FR')} FCFA prélevés pour solder votre dû envers « ${group.name} ». Vous avez quitté le club.`
                : `Vous avez quitté « ${group.name} ». Vous ne serez plus prélevé aux prochains cycles.`;
            await tx.notification.create({
                data: { userId, title: leaveTitle, body: leaveBody, type: 'TRANSACTION' }
            });
            return { leaveTitle, leaveBody };
        }).then(async ({ leaveTitle, leaveBody }) => {
            const leavingUser = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
            const { sendPush } = await import('./wallet');
            await sendPush(leavingUser?.pushToken, leaveTitle, leaveBody);
        });

        res.json({ success: true, message: debt > 0 ? `Dette de ${debt.toLocaleString('fr-FR')} FCFA réglée. Vous avez quitté le club.` : "Vous avez quitté le club de tontine. Vous ne serez plus prélevé aux prochains cycles." });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Cotisation volontaire pour le tour en cours, d'un montant libre (contributeNow,
// tontineService.ts) — jusqu'ici, seul le CRON quotidien pouvait prélever une cotisation,
// et uniquement pour le montant fixe et entier de la part. Chacun peut désormais compléter
// sa part en plusieurs dépôts, du montant de son choix, jusqu'à atteindre le montant total ;
// dès que tout le monde a fini, la cagnotte part immédiatement.
router.post('/contribute', authMiddleware, circuitBreakerMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId, amount } = req.body;

        const result = await contributeNow(String(groupId), userId, Number(amount));

        res.json({
            success: true,
            payoutTriggered: result.payoutTriggered,
            totalPaid: result.totalPaid,
            remaining: result.remaining,
            message: result.payoutTriggered
                ? 'Cotisation enregistrée — tous les membres ont payé, la cagnotte vient d\'être versée !'
                : result.remaining > 0
                    ? `${result.amountPaid.toLocaleString('fr-FR')} FCFA cotisés. Il vous reste ${result.remaining.toLocaleString('fr-FR')} FCFA à verser pour ce tour.`
                    : 'Cotisation complète pour ce tour. La cagnotte sera versée une fois que tous les membres auront terminé (ou à la date prévue).'
        });
    } catch (e: any) {
        res.status(400).json({ success: false, message: e.message || friendlyErrorMessage(e, 'Erreur serveur') });
    }
});

// Répond au sondage de relance ouvert par executeTontineCycle en fin de rotation
// (group.status PENDING_RENEWAL — voir tontineService.ts, resolveRenewalPoll). Dès que
// tous les participants actifs ont voté, le sondage est tranché immédiatement sans
// attendre l'échéance ; sinon le CRON le tranchera de toute façon à la date limite
// (silence = considéré comme un refus, voir schema.prisma).
router.post('/renewal-vote', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId, vote } = req.body;
        if (vote !== 'YES' && vote !== 'NO') {
            return res.status(400).json({ success: false, message: "vote doit être 'YES' ou 'NO'." });
        }

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group) return res.status(404).json({ success: false, message: 'Club introuvable.' });
        if (group.status !== 'PENDING_RENEWAL') {
            return res.status(400).json({ success: false, message: "Ce club n'a pas de sondage de relance en cours." });
        }

        const participant = await prisma.tontineParticipant.findFirst({ where: { userId, tontineGroupId: groupId, status: 'ACTIVE' } });
        if (!participant) return res.status(404).json({ success: false, message: "Vous ne faites pas partie de ce club." });

        await prisma.tontineParticipant.update({ where: { id: participant.id }, data: { renewalVote: vote } });

        const stillWaiting = await prisma.tontineParticipant.count({
            where: { tontineGroupId: groupId, status: 'ACTIVE', renewalVote: null }
        });
        if (stillWaiting === 0) {
            await resolveRenewalPoll(String(groupId));
        }

        res.json({ success: true, message: vote === 'YES' ? 'Vote enregistré : vous souhaitez continuer.' : 'Vote enregistré : vous ne souhaitez pas continuer.' });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, 'Erreur serveur') });
    }
});

// Modifier l'ordre de passage d'un membre manuellement
router.post('/reorder', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        // orderMap: [ { participantId: "...1", newOrder: 1 }, { participantId: "...2", newOrder: 2 } ]
        const { groupId, orderMap } = req.body;

        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group || group.creatorId !== userId) {
            return res.status(403).json({ success: false, message: "Seul le créateur peut modifier l'ordre." });
        }
        if (group.status !== 'ACTIVE') {
            return res.status(400).json({ success: false, message: "Ce club est dissous — l'ordre de passage n'a plus d'effet." });
        }

        if (!Array.isArray(orderMap) || orderMap.length === 0) {
            return res.status(400).json({ success: false, message: "orderMap invalide." });
        }

        // Défense en profondeur (en plus de `hasReceivedPayout` dans tontineService.ts, qui
        // ferme réellement l'exploit) : un `newOrder` doit être un entier positif, et deux
        // participants ne peuvent pas revendiquer le même tour dans une seule requête.
        const newOrders = orderMap.map((item: any) => Number(item.newOrder));
        if (newOrders.some((n: number) => !Number.isInteger(n) || n < 1)) {
            return res.status(400).json({ success: false, message: "Chaque tour (newOrder) doit être un entier positif." });
        }
        if (new Set(newOrders).size !== newOrders.length) {
            return res.status(400).json({ success: false, message: "Deux participants ne peuvent pas avoir le même tour." });
        }

        // IDOR guard : chaque participantId ciblé doit appartenir à CE groupe — sans ce
        // contrôle, le créateur d'un groupe A pouvait réordonner (et donc s'attribuer)
        // un tour de paiement dans un groupe B dont il n'est que simple membre.
        const participantIds = orderMap.map((item: any) => String(item.participantId));
        const validParticipants = await prisma.tontineParticipant.findMany({
            where: { id: { in: participantIds }, tontineGroupId: group.id },
            select: { id: true }
        });
        if (validParticipants.length !== participantIds.length) {
            return res.status(403).json({ success: false, message: "Un ou plusieurs participants n'appartiennent pas à ce groupe." });
        }

        // Le contrôle d'unicité ci-dessus (`new Set(newOrders)`) ne compare que les tours
        // DEMANDÉS entre eux — il n'empêchait pas d'assigner un tour déjà détenu par un membre
        // du groupe absent de cette requête. executeTontineCycle (tontineService.ts) sélectionne
        // le bénéficiaire par un simple `.find(p => p.payoutOrder === currentCycle)`, sans tri :
        // deux participants à égalité sur le même tour, un seul est payé (celui que Prisma
        // renvoie en premier), l'autre garde ce même payoutOrder pour toujours (currentCycle
        // ne fait qu'augmenter) — exclu à vie de tout paiement tout en continuant de cotiser.
        const otherParticipants = await prisma.tontineParticipant.findMany({
            where: { tontineGroupId: group.id, id: { notIn: participantIds } },
            select: { payoutOrder: true }
        });
        const takenOrders = new Set(otherParticipants.map(p => p.payoutOrder));
        if (newOrders.some((n: number) => takenOrders.has(n))) {
            return res.status(400).json({ success: false, message: "Ce tour est déjà occupé par un autre membre du groupe." });
        }

        await prisma.$transaction(
            orderMap.map((item: any) =>
                prisma.tontineParticipant.update({
                    where: { id: String(item.participantId) },
                    data: { payoutOrder: item.newOrder }
                })
            )
        );

        res.json({ success: true, message: "L'ordre a été mis à jour." });
    } catch (e: any) {
        res.status(500).json({ success: false, message: friendlyErrorMessage(e, "Erreur serveur") });
    }
});

// Rejoindre un club n'est théoriquement plus utilisé publiquement, mais on garde pour compatibilité ou avec un code d'invit
router.post('/join', authMiddleware, async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthRequest).userId!;
        const { groupId } = req.body;

        if (!groupId) {
            return res.status(400).json({ success: false, message: "ID de la tontine requis." });
        }

        // Vérifier si le groupe existe
        const group = await prisma.tontineGroup.findUnique({ where: { id: String(groupId) } });
        if (!group || group.status !== 'ACTIVE') {
            return res.status(404).json({ success: false, message: "Groupe introuvable ou inactif." });
        }

        // Corrige une faille : cette route ne vérifiait auparavant AUCUNE condition de
        // visibilité — n'importe quel utilisateur connaissant un groupId (deep link, fuite,
        // ID deviné) pouvait rejoindre n'importe quelle tontine, y compris une que son
        // créateur pensait strictement sur invitation. Seuls les groupes explicitement
        // rendus publics (voir /discover) sont auto-joignables ; les autres restent
        // accessibles uniquement via /invite (créateur uniquement).
        if (!group.isPublic) {
            return res.status(403).json({ success: false, message: "Cette tontine est privée — seul le créateur peut vous inviter." });
        }
        if (group.isPaused) {
            return res.status(400).json({ success: false, message: "Ce club est actuellement suspendu par l'administration — impossible de le rejoindre pour le moment." });
        }

        const participant = await prisma.$transaction(async (tx) => {
            // Verrou pessimiste sur le groupe (même pattern que wallet.ts) : sans lui, deux
            // utilisateurs qui rejoignent au même instant peuvent tous les deux lire le même
            // payoutOrder maximum ci-dessous et se retrouver avec le même tour de passage —
            // un seul des deux serait alors jamais payé (executeTontineCycle ne sélectionne
            // que le PREMIER participant dont payoutOrder === currentCycle).
            await tx.$executeRaw`SELECT id FROM "TontineGroup" WHERE id = ${group.id} FOR UPDATE;`;

            // Un LEFT peut revenir (le club l'accepte de nouveau) : seule une ligne encore
            // ACTIVE/PAUSED compte comme "déjà membre".
            const existing = await tx.tontineParticipant.findFirst({
                where: { userId, tontineGroupId: groupId, status: { not: 'LEFT' } }
            });
            if (existing) throw new Error('ALREADY_MEMBER');

            // Le tour du nouveau membre se place après le dernier tour ACTIF existant — jamais
            // un simple compte de lignes historiques (count()) : après une relance de boucle,
            // les membres restants sont renumérotés à partir de currentCycle (voir
            // resolveRenewalPoll, tontineService.ts), qui peut être très inférieur au nombre
            // total de lignes jamais créées dans ce groupe (membres LEFT compris). Un compte
            // brut retomberait alors sur un payoutOrder déjà attribué à un membre actif.
            const activeParticipants = await tx.tontineParticipant.findMany({
                where: { tontineGroupId: groupId, status: 'ACTIVE' },
                select: { payoutOrder: true }
            });
            const maxOrder = Math.max(group.currentCycle - 1, 0, ...activeParticipants.map(p => p.payoutOrder));

            return tx.tontineParticipant.create({
                data: { userId, tontineGroupId: groupId, payoutOrder: maxOrder + 1 }
            });
        }).catch((e: any) => {
            if (e.message === 'ALREADY_MEMBER') return null;
            throw e;
        });

        if (!participant) {
            return res.status(400).json({ success: false, message: "Vous participez déjà à cette Tontine." });
        }

        // Notifier l'utilisateur
        const joinTitle = "Tontine rejointe 🤝";
        const joinBody = `Vous avez rejoint le club ${group.name}. Votre cotisation est de ${group.contribution} FCFA par cycle.`;
        await prisma.notification.create({
            data: { userId, title: joinTitle, body: joinBody, type: "INFO" }
        });
        const joiningUser = await prisma.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
        const { sendPush } = await import('./wallet');
        await sendPush(joiningUser?.pushToken, joinTitle, joinBody);

        res.json({ success: true, message: "Vous avez rejoint la tontine avec succès.", data: participant });
    } catch (error: any) {
        console.error("Erreur Tontine join:", error);
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

// Déclenchement manuel d'un cycle (le CRON automatique appelle executeTontineCycle
// directement en interne — voir backend/src/cron.ts — sans jamais passer par cette route
// HTTP). Réservé au personnel habilité (compte Staff, pas le rôle legacy User.ADMIN).
router.post('/debit/:groupId', authMiddleware, circuitBreakerMiddleware, async (req: Request, res: Response) => {
    try {
        const staffId = (req as AuthRequest).userId!;
        const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, role: true, isActive: true, permissions: true, permissionsCustomized: true } });

        if (!staff || !staff.isActive || !hasPermission(staff, 'perm_tontine_manage')) {
            return res.status(403).json({ success: false, message: "Accès refusé" });
        }

        const groupId = req.params.groupId as string;
        const result = await executeTontineCycle(groupId);

        if (!result || !result.success) {
            return res.status(404).json({ success: false, message: "Groupe introuvable" });
        }

        res.json({
            success: true,
            message: `Cycle ${result.currentCycle} exécuté. ${result.debitedCount} réussis, ${result.failedCount} échoués. Payout total: ${result.totalPot} FCFA.`
        });
    } catch (error: any) {
        console.error("Erreur Tontine debit:", error);
        res.status(500).json({ success: false, message: friendlyErrorMessage(error, "Erreur serveur") });
    }
});

export default router;
