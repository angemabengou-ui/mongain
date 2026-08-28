import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../prisma';
import { getSystemSettings } from '../routes/settings';
import { LimitEngine } from './LimitEngine';

const TONTINE_VAULT_PHONE = '+24155555555';

// Compte système "Coffre Tontine" — les cotisations y transitent réellement (au lieu
// d'un identifiant de wallet fictif "VAULT_TONTINE_xxx" qui violait la contrainte de
// clé étrangère de Transaction à chaque cycle et faisait échouer TOUT le cycle en cours,
// empêchant historiquement le moindre prélèvement/versement de tontine).
export async function getTontineVaultWallet() {
    let vault = await prisma.user.findUnique({ where: { phone: TONTINE_VAULT_PHONE }, include: { wallet: true } });
    if (!vault) {
        vault = await prisma.user.create({
            data: {
                phone: TONTINE_VAULT_PHONE,
                name: 'COFFRE TONTINE (SYSTEME)',
                role: 'ADMIN',
                pin: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
                wallet: { create: { balance: 0, currency: 'FCFA' } }
            },
            include: { wallet: true }
        });
    }
    if (!vault.wallet) throw new Error('Coffre Tontine sans portefeuille associé.');
    return vault.wallet;
}

// Débite un montant — libre, potentiellement partiel — pour le cycle courant du groupe,
// crédite le Coffre Tontine, et CUMULE le résultat dans TontineContribution (une seule ligne
// par (cycle, participant), dont `amount` représente le TOTAL versé jusqu'ici pour ce
// cycle — pas un dépôt figé unique). Permet à chacun de cotiser en plusieurs fois, du
// montant de son choix, jusqu'à atteindre group.contribution, plutôt que d'imposer un unique
// prélèvement fixe. Chaque dépôt trace sa PROPRE Transaction (référence suffixée d'un id
// aléatoire, plusieurs dépôts par cycle et par personne sont désormais possibles) — plus
// d'idempotence par référence exacte : la protection contre un double-débit vient de la
// vérification atomique de solde (updateMany where balance gte) et du fait que chaque appel
// ne demande jamais plus que le solde restant dû (voir les appelants). Utilisé par
// executeTontineCycle (prélèvement automatique du solde restant à l'échéance), contributeNow
// (dépôt volontaire, montant au choix) et retryFailedContributions (rattrapage ciblé).
export async function collectParticipantContribution(
    group: { id: string; contribution: number; currentCycle: number },
    participantId: string,
    userId: string,
    cycleId: string,
    vaultWalletId: string,
    settings: Awaited<ReturnType<typeof getSystemSettings>>,
    amount: number
): Promise<{ success: boolean; totalPaid: number }> {
    if (amount <= 0) {
        const existing = await prisma.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId, participantId } } });
        return { success: true, totalPaid: existing?.amount || 0 };
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        const existing = await prisma.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId, participantId } } });
        return { success: false, totalPaid: existing?.amount || 0 };
    }

    try {
        const totalPaid = await prisma.$transaction(async (tx) => {
            // Relu ICI, dans la transaction, plutôt que de faire confiance au `remaining`
            // calculé par l'appelant avant son ouverture : si un prélèvement automatique
            // (CRON) et une cotisation manuelle visent la même personne au même instant,
            // chacun peut avoir décidé son montant à partir d'un état déjà dépassé au moment
            // où il agit réellement. On plafonne donc ici au solde RÉELLEMENT restant dû —
            // sans quoi les deux pourraient additionner plus que group.contribution au total.
            const currentContribution = await tx.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId, participantId } } });
            const currentlyPaid = currentContribution?.amount || 0;
            if (currentlyPaid >= group.contribution) throw new Error('ALREADY_COMPLETE');
            const cappedAmount = Math.min(amount, group.contribution - currentlyPaid);

            const fee = cappedAmount * settings.taxP2P;
            const totalDebit = cappedAmount + fee;

            await LimitEngine.verifyAndIncrementConsumption(tx, userId, wallet.id, totalDebit, settings);

            const updated = await tx.wallet.updateMany({
                where: { id: wallet.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });
            if (updated.count === 0) throw new Error('Solde insuffisant.');

            await tx.wallet.update({
                where: { id: vaultWalletId },
                data: { balance: { increment: cappedAmount } }
            });

            if (fee > 0) {
                const { getOrCreateCorporateWallet } = await import('../routes/wallet');
                const corporate = await getOrCreateCorporateWallet(tx);
                await tx.wallet.update({
                    where: { id: corporate.wallet.id },
                    data: { balance: { increment: fee } }
                });
            }

            const createdTx = await tx.transaction.create({
                data: {
                    amount: cappedAmount, fee,
                    senderWalletId: wallet.id,
                    receiverWalletId: vaultWalletId,
                    status: 'COMPLETED',
                    reference: `TONT_DBT_G${group.id}_C${group.currentCycle}_U${userId}_${crypto.randomUUID()}`
                }
            });

            // Incrément ATOMIQUE (amount = amount + X au niveau base de données), jamais
            // "lire le cumul actuel puis écrire un total recalculé" : deux dépôts du même
            // participant exécutés en parallèle (double-tap, retry réseau, deux appareils
            // connectés au même compte) verraient sinon chacun l'ancien total, et le second à
            // écrire effacerait le premier — perte de mise à jour classique. L'upsert atomique
            // ci-dessous (INSERT ... ON CONFLICT côté base) élimine ce risque même sur le tout
            // premier dépôt d'un participant pour ce cycle.
            const updatedContribution = await tx.tontineContribution.upsert({
                where: { cycleId_participantId: { cycleId, participantId } },
                create: { cycleId, participantId, transactionId: createdTx.id, amount: cappedAmount, status: cappedAmount >= group.contribution ? 'PAID' : 'PARTIAL' },
                update: { transactionId: createdTx.id, amount: { increment: cappedAmount } }
            });
            // Le statut dépend du total APRÈS incrément — connu seulement une fois l'upsert
            // exécuté (un upsert ne peut pas conditionner une valeur sur son propre résultat).
            const correctStatus = updatedContribution.amount >= group.contribution ? 'PAID' : 'PARTIAL';
            if (updatedContribution.status !== correctStatus) {
                await tx.tontineContribution.update({ where: { id: updatedContribution.id }, data: { status: correctStatus } });
            }

            const remaining = group.contribution - updatedContribution.amount;
            await tx.notification.create({
                data: {
                    userId, title: 'Cotisation Tontine prélevée 💸',
                    body: `${cappedAmount.toLocaleString('fr-FR')} FCFA prélevés (frais inclus : ${fee.toLocaleString('fr-FR')} FCFA).${remaining > 0 ? ` Il vous reste ${remaining.toLocaleString('fr-FR')} FCFA à cotiser pour ce tour.` : ' Votre cotisation est complète pour ce tour.'}`,
                    type: 'INFO'
                }
            });

            return updatedContribution.amount;
        });

        return { success: true, totalPaid };
    } catch (err: any) {
        if (err.message === 'ALREADY_COMPLETE') {
            // Un autre dépôt concurrent (CRON automatique + cotisation manuelle simultanés,
            // par exemple) a fini de compléter cette part entre la décision de l'appelant et
            // l'ouverture de cette transaction — l'objectif (être à jour) est déjà atteint,
            // ce n'est pas un échec.
            const existing = await prisma.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId, participantId } } });
            return { success: true, totalPaid: existing?.amount || 0 };
        }
        // Un fail ici ne stoppe pas la tontine (ex: solde insuffisant) -> on permet la
        // défaillance partielle, d'où l'impossibilité d'utiliser une seule grosse
        // transaction $transaction pour tout le groupe. Le montant déjà versé avant cette
        // tentative reste acquis (transaction annulée, rien n'a changé) : seul CE dépôt
        // échoue, pas l'ensemble de la cotisation.
        const errStr = err.message || '';
        await prisma.notification.create({
            data: { userId, title: 'Échec Cotisation Tontine ⚠️', body: errStr.includes('Plafond') ? errStr : `Solde insuffisant pour ce prélèvement de ${amount.toLocaleString('fr-FR')} FCFA.`, type: 'ALERT' }
        });
        const existing = await prisma.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId, participantId } } });
        return { success: false, totalPaid: existing?.amount || 0 };
    }
}

// Verse la cagnotte du cycle au bénéficiaire désigné si le pot n'est pas vide et que le
// versement n'a pas déjà eu lieu (idempotent via TONT_PAY_G{id}_C{cycle}_U{userId}).
// Appelé à la fin d'executeTontineCycle, et à nouveau par retryFailedContributions si des
// cotisations rattrapées après-coup permettent enfin d'atteindre un pot non vide.
async function payoutBeneficiaryIfDue(
    group: { id: string; name: string; currentCycle: number },
    beneficiary: { id: string; userId: string } | undefined,
    totalPot: number,
    vaultWalletId: string
): Promise<string | null> {
    if (!beneficiary || totalPot <= 0) return null;

    const idempotencyPayoutRef = `TONT_PAY_G${group.id}_C${group.currentCycle}_U${beneficiary.userId}`;
    const payoutDone = await prisma.transaction.findFirst({ where: { reference: idempotencyPayoutRef } });
    if (payoutDone) return payoutDone.id;

    const beneficiaryWallet = await prisma.wallet.findUnique({ where: { userId: beneficiary.userId } });
    if (!beneficiaryWallet) return null;

    const payoutTxId = await prisma.$transaction(async (tx) => {
        const claim = await tx.wallet.updateMany({
            where: { id: vaultWalletId, balance: { gte: totalPot } },
            data: { balance: { decrement: totalPot } }
        });
        if (claim.count === 0) throw new Error('Coffre Tontine insuffisant pour ce paiement.');

        await tx.wallet.update({
            where: { id: beneficiaryWallet.id },
            data: { balance: { increment: totalPot } }
        });

        const createdTx = await tx.transaction.create({
            data: { amount: totalPot, receiverWalletId: beneficiaryWallet.id, senderWalletId: vaultWalletId, status: 'COMPLETED', reference: idempotencyPayoutRef }
        });
        await tx.tontineParticipant.update({
            where: { id: beneficiary.id },
            data: { hasReceivedPayout: true }
        });
        await tx.notification.create({
            data: { userId: beneficiary.userId, title: '🎉 Cagnotte Tontine Reçue !', body: `C'est votre tour ! Vous avez reçu la cagnotte de ${totalPot} FCFA du club ${group.name}.`, type: 'INFO' }
        });
        return createdTx.id;
    });

    return payoutTxId;
}

// Rappel envoyé la veille du prélèvement (J-1, voir cron.ts pour le déclenchement). Une
// tontine physique s'auto-rappelle par la pression sociale du groupe qui se voit — un
// groupe numérique perd ce rappel implicite dès que les membres ne se croisent plus
// physiquement ; ce rappel explicite en tient lieu plutôt que de laisser chacun découvrir
// le prélèvement (ou son échec pour solde insuffisant) après coup.
export async function notifyUpcomingCycle(group: { id: string; name: string; contribution: number }) {
    const activeParticipants = await prisma.tontineParticipant.findMany({
        where: { tontineGroupId: group.id, status: 'ACTIVE' },
        select: { userId: true, user: { select: { pushToken: true } } }
    });
    if (activeParticipants.length === 0) return;

    const body = `${group.contribution} FCFA seront prélevés demain pour « ${group.name} ». Vérifiez que votre solde est suffisant.`;
    await prisma.notification.createMany({
        data: activeParticipants.map((p) => ({
            userId: p.userId,
            title: 'Cotisation Tontine demain 🔔',
            body,
            type: 'INFO'
        }))
    });

    // Sans push, ce rappel ne sert à rien : il ne serait vu qu'en ouvrant l'app, potentiellement
    // après le prélèvement du lendemain — l'utilisateur n'aurait alors plus l'occasion de
    // recharger à temps. Même pattern que les autres notifications de ce fichier.
    const { sendPush } = await import('../routes/wallet');
    await Promise.all(activeParticipants.map((p) => sendPush(p.user?.pushToken, 'Cotisation Tontine demain 🔔', body)));
}

export async function executeTontineCycle(groupId: string) {
    const group: any = await prisma.tontineGroup.findUnique({
        where: { id: groupId },
        include: { participants: { include: { user: { select: { pushToken: true } } } } }
    });
    if (!group) return { success: false, message: 'Group not found' };

    const activeParticipants = group.participants.filter((p: any) => p.status === 'ACTIVE');

    // Rien ne marquait jamais un groupe `COMPLETED` une fois sa rotation terminée (tous les
    // participants actifs déjà payés) : `status` restait `ACTIVE` indéfiniment, le CRON
    // continuait donc de sélectionner ce groupe à chaque échéance, `beneficiary` (plus bas)
    // ne trouvait plus jamais personne pour un payoutOrder qui n'existe plus, et le cycle
    // était quand même marqué `COMPLETED` avec `currentCycle` qui avançait comme si de rien
    // n'était — collectant la cotisation de tout le monde à chaque tour suivant sans jamais
    // plus rien reverser à personne. Un prélèvement réel, récurrent et silencieux, sans
    // aucune contrepartie. On coupe court avant même de créer le cycle ou de toucher un wallet.
    // Plutôt que de terminer sèchement, on ouvre un sondage de relance (PENDING_RENEWAL) :
    // resolveRenewalPoll tranche une fois tout le monde répondu (ou le délai passé, via CRON).
    if (activeParticipants.length === 0 || activeParticipants.every((p: any) => p.hasReceivedPayout)) {
        if (group.status === 'ACTIVE' && activeParticipants.length > 0) {
            const renewalDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await prisma.tontineGroup.update({ where: { id: group.id }, data: { status: 'PENDING_RENEWAL', renewalDeadline } });
            await prisma.tontineParticipant.updateMany({
                where: { id: { in: activeParticipants.map((p: any) => p.id) } },
                data: { renewalVote: null }
            });
            await prisma.notification.createMany({
                data: activeParticipants.map((p: any) => ({
                    userId: p.userId,
                    title: 'Tontine terminée — continuer ?',
                    body: `« ${group.name} » a terminé sa rotation — tous les membres ont reçu leur cagnotte. Voulez-vous relancer une nouvelle boucle ? Répondez avant le ${renewalDeadline.toLocaleDateString('fr-FR')}, sinon vous serez considéré comme ne souhaitant pas continuer.`,
                    type: 'ALERT'
                }))
            });
            const { sendPush } = await import('../routes/wallet');
            await Promise.all(activeParticipants.map((p: any) => sendPush(p.user?.pushToken, 'Tontine terminée', `« ${group.name} » a terminé sa rotation — dites si vous voulez continuer.`)));
        } else if (group.status === 'ACTIVE') {
            await prisma.tontineGroup.update({ where: { id: group.id }, data: { status: 'COMPLETED' } });
        }
        return { success: true, completed: true, debitedCount: 0, failedCount: 0, totalPot: 0, currentCycle: group.currentCycle, payoutFailed: false };
    }

    const vaultWallet = await getTontineVaultWallet();
    const settings = await getSystemSettings();

    // Ligne de grand livre pour ce cycle — créée avant le traitement des participants
    // (totaux à zéro) pour disposer de son id tout au long de la boucle, puis complétée
    // à la fin. L'upsert rend l'opération idempotente en cas de reprise après plantage.
    const cycle = await prisma.tontineCycle.upsert({
        where: { tontineGroupId_cycleNumber: { tontineGroupId: group.id, cycleNumber: group.currentCycle } },
        create: { tontineGroupId: group.id, cycleNumber: group.currentCycle, totalExpected: 0, totalCollected: 0 },
        update: {}
    });

    let debitedCount = 0;
    let failedCount = 0;
    let totalPot = 0;

    // Chacun peut déjà avoir versé une partie (ou la totalité) de sa cotisation à l'avance
    // via contributeNow — le CRON ne prélève ici que le solde RESTANT dû, jamais le montant
    // plein à nouveau (voir collectParticipantContribution : `amount` est un dépôt, pas la
    // cotisation totale). Si un participant a déjà tout versé, on ne le débite pas une
    // seconde fois, mais son montant compte quand même dans la cagnotte du cycle.
    for (const p of activeParticipants) {
        const existing = await prisma.tontineContribution.findUnique({ where: { cycleId_participantId: { cycleId: cycle.id, participantId: p.id } } });
        const alreadyPaid = existing?.amount || 0;
        const remaining = group.contribution - alreadyPaid;

        if (remaining <= 0) {
            debitedCount++;
            totalPot += alreadyPaid;
            continue;
        }

        const result = await collectParticipantContribution(group, p.id, p.userId, cycle.id, vaultWallet.id, settings, remaining);
        totalPot += result.totalPaid;
        if (result.totalPaid >= group.contribution) {
            debitedCount++;
        } else {
            failedCount++;
        }
    }

    // `!p.hasReceivedPayout` : sans ça, le créateur (seul habilité à réordonner via
    // POST /tontine/reorder, où `newOrder` n'est pas borné) pouvait réassigner son propre
    // payoutOrder au cycle courant avant chaque exécution et s'attribuer la cagnotte
    // indéfiniment. Un participant déjà payé une fois ne peut plus jamais être sélectionné,
    // quelle que soit la valeur de payoutOrder au moment du cycle suivant.
    const beneficiary = group.participants.find((p: any) => p.payoutOrder === group.currentCycle && p.status === 'ACTIVE' && !p.hasReceivedPayout);

    // Le versement peut échouer même quand la collecte a réussi (ex: coffre insuffisant —
    // improbable mais pas impossible sur un coffre partagé entre toutes les tontines de la
    // plateforme). Avant ce correctif, un throw ici sortait de la fonction AVANT la mise à
    // jour du cycle et l'avancement de currentCycle : le cycle restait figé avec ses valeurs
    // par défaut (totaux à zéro) alors que l'argent des participants était déjà collecté et
    // immobilisé dans le coffre, sans aucune trace exploitable ni recours autre qu'une
    // intervention manuelle en base. On isole donc l'échec du versement (pas de la collecte)
    // pour que le cycle reste correctement documenté quoi qu'il arrive.
    let payoutTransactionId: string | null = null;
    let payoutFailed = false;
    try {
        payoutTransactionId = await payoutBeneficiaryIfDue(group, beneficiary, totalPot, vaultWallet.id);
    } catch (payoutError) {
        console.error(`Échec du versement de la cagnotte — ${group.name}, cycle ${group.currentCycle}:`, payoutError);
        payoutFailed = true;
    }

    await prisma.tontineCycle.update({
        where: { id: cycle.id },
        data: {
            totalExpected: activeParticipants.length * group.contribution,
            totalCollected: totalPot,
            status: payoutFailed ? 'PAYOUT_FAILED' : (failedCount > 0 ? 'PARTIAL' : 'COMPLETED'),
            beneficiaryParticipantId: beneficiary?.id ?? null,
            payoutTransactionId
        }
    });

    // Ne PAS avancer currentCycle si le versement a échoué : le bénéficiaire visé doit rester
    // le même tant que sa cagnotte n'est pas réellement versée, plutôt que de sauter
    // silencieusement son tour. Le prochain passage du CRON retentera ce même cycle (les
    // cotisations déjà collectées ne seront pas re-débitées, voir l'idempotence de
    // collectParticipantContribution) ; retryFailedContributions permet aussi une relance
    // immédiate sans attendre le cycle suivant.
    if (!payoutFailed) {
        const nextCycle = group.currentCycle + 1;
        await prisma.tontineGroup.update({ where: { id: group.id }, data: { currentCycle: nextCycle } });
    }

    console.log(`✅ Cycle ${group.currentCycle} pour ${group.name} exécuté: ${totalPot} FCFA${payoutFailed ? ' (versement en échec, à relancer)' : ''}`);
    return { success: true, debitedCount, failedCount, totalPot, currentCycle: group.currentCycle, payoutFailed };
}

// Cotisation volontaire, à l'initiative du participant (routes/tontine.ts, POST /contribute)
// — jusqu'ici, le seul mécanisme de prélèvement était le CRON quotidien (cron.ts), pour le
// montant FIXE et ENTIER de la cotisation, sans aucune action possible côté membre. Accepte
// désormais un montant libre : chacun peut compléter sa part en plusieurs dépôts plutôt que
// de payer tout d'un coup — voir collectParticipantContribution, qui cumule chaque dépôt
// sur la même ligne TontineContribution. Dès que TOUS les participants actifs ont atteint
// group.contribution pour ce cycle, la cagnotte est versée immédiatement — sans attendre
// l'échéance normale. Si certains n'ont pas fini à temps, le CRON reste le filet de sécurité
// habituel à la date prévue, en prélevant alors uniquement leur solde restant dû.
export async function contributeNow(groupId: string, userId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Indiquez un montant valide à cotiser.');

    const group: any = await prisma.tontineGroup.findUnique({ where: { id: groupId }, include: { participants: true } });
    if (!group) throw new Error('Tontine introuvable.');
    if (group.status !== 'ACTIVE') throw new Error("Ce club n'accepte pas de cotisation en ce moment (terminé, en sondage de relance, ou dissous).");
    if (group.isPaused) throw new Error('Ce club est en pause administrative — aucune cotisation ne peut être prélevée.');

    const participant = group.participants.find((p: any) => p.userId === userId && p.status === 'ACTIVE');
    if (!participant) throw new Error("Vous n'êtes pas membre actif de ce club.");

    const vaultWallet = await getTontineVaultWallet();
    const settings = await getSystemSettings();

    const cycle = await prisma.tontineCycle.upsert({
        where: { tontineGroupId_cycleNumber: { tontineGroupId: group.id, cycleNumber: group.currentCycle } },
        create: { tontineGroupId: group.id, cycleNumber: group.currentCycle, totalExpected: 0, totalCollected: 0 },
        update: {}
    });

    const existing = await prisma.tontineContribution.findUnique({
        where: { cycleId_participantId: { cycleId: cycle.id, participantId: participant.id } }
    });
    const alreadyPaid = existing?.amount || 0;
    const remaining = group.contribution - alreadyPaid;
    if (remaining <= 0) throw new Error('Vous avez déjà entièrement cotisé pour ce tour.');
    if (amount > remaining) {
        throw new Error(`Il ne vous reste que ${remaining.toLocaleString('fr-FR')} FCFA à cotiser pour ce tour — vous ne pouvez pas déposer plus.`);
    }

    const result = await collectParticipantContribution(group, participant.id, userId, cycle.id, vaultWallet.id, settings, amount);
    if (!result.success) throw new Error('Solde insuffisant pour ce dépôt.');

    const activeParticipants = group.participants.filter((p: any) => p.status === 'ACTIVE');
    const paidCount = await prisma.tontineContribution.count({ where: { cycleId: cycle.id, status: 'PAID' } });

    let payoutTriggered = false;
    if (paidCount >= activeParticipants.length) {
        // Même garde-fou de réclamation atomique que le CRON (cron.ts) : si le CRON se
        // déclenche exactement au même instant, un seul des deux gagne le droit d'exécuter
        // le cycle — la cotisation de l'utilisateur reste enregistrée quoi qu'il arrive.
        const claim = await prisma.tontineGroup.updateMany({
            where: { id: groupId, lastPayoutDate: group.lastPayoutDate },
            data: { lastPayoutDate: new Date() }
        });
        if (claim.count > 0) {
            await executeTontineCycle(groupId);
            payoutTriggered = true;
        }
    }

    return { success: true, payoutTriggered, amountPaid: amount, totalPaid: result.totalPaid, remaining: Math.max(0, group.contribution - result.totalPaid) };
}

// Tranche le sondage de relance ouvert par executeTontineCycle en fin de rotation
// (group.status PENDING_RENEWAL) — appelée soit dès que tous les participants actifs ont
// voté (routes/tontine.ts, POST /:id/renewal-vote), soit par le CRON une fois
// group.renewalDeadline dépassé (silence = considéré comme un refus, voir schema.prisma).
// Qui a dit 'YES' reste ; qui a dit 'NO' ou n'a pas répondu est retiré du groupe (status
// LEFT, sans dette : la rotation est déjà terminée pour tout le monde). S'il reste au moins
// deux participants ayant accepté, une nouvelle boucle démarre : hasReceivedPayout et
// renewalVote remis à zéro, payoutOrder renuméroté dans l'ordre existant à partir de
// currentCycle (JAMAIS remis à 1 — voir commentaire plus bas sur la collision de cycleNumber
// avec la boucle précédente) — un nouveau tirage au sort reste possible ensuite via
// POST /tontine/reorder, déjà exposé côté app. Sinon, le groupe reste définitivement COMPLETED.
export async function resolveRenewalPoll(groupId: string) {
    const group: any = await prisma.tontineGroup.findUnique({
        where: { id: groupId },
        include: { participants: { where: { status: 'ACTIVE' }, include: { user: { select: { pushToken: true } } } } }
    });
    if (!group || group.status !== 'PENDING_RENEWAL') return { resolved: false };

    const stayers = group.participants.filter((p: any) => p.renewalVote === 'YES');
    const leavers = group.participants.filter((p: any) => p.renewalVote !== 'YES');
    const { sendPush } = await import('../routes/wallet');

    if (leavers.length > 0) {
        await prisma.tontineParticipant.updateMany({
            where: { id: { in: leavers.map((p: any) => p.id) } },
            data: { status: 'LEFT' }
        });
        await prisma.notification.createMany({
            data: leavers.map((p: any) => ({
                userId: p.userId,
                title: 'Retiré de la tontine',
                body: `Vous avez été retiré de « ${group.name} » : vous n'avez pas souhaité continuer (ou n'avez pas répondu à temps).`,
                type: 'INFO'
            }))
        });
        await Promise.all(leavers.map((p: any) => sendPush(p.user?.pushToken, 'Retiré de la tontine', `Vous avez été retiré de « ${group.name} ».`)));
    }

    if (stayers.length >= 2) {
        // `group.currentCycle` ne doit JAMAIS être remis à 1 ici : ce numéro de cycle a déjà
        // servi lors de la boucle précédente pour ce même groupe (même TontineGroup.id), donc
        // le réutiliser entrerait en collision avec les TontineCycle/TontineContribution/
        // Transaction déjà existants pour cycleNumber=1 (même référence d'idempotence
        // TONT_DBT_G{id}_C1_U{userId} qu'à la première boucle, pour tout membre qui continue)
        // — un continuant serait alors traité comme "déjà payé" sans qu'aucun argent réel ne
        // bouge, et l'historique de la boucle précédente serait écrasé. `currentCycle` n'a
        // justement jamais été consommé pour créer le moindre cycle (voir plus haut, on coupe
        // court avant tout upsert) : on le laisse tel quel, et on numérote les payoutOrder de
        // la nouvelle boucle à partir de cette même valeur plutôt que de repartir à 1, pour
        // que `payoutOrder === currentCycle` continue de désigner le bon bénéficiaire.
        const startOrder = group.currentCycle;
        await prisma.$transaction(async (tx: any) => {
            for (let i = 0; i < stayers.length; i++) {
                await tx.tontineParticipant.update({
                    where: { id: stayers[i].id },
                    data: { payoutOrder: startOrder + i, hasReceivedPayout: false, renewalVote: null }
                });
            }
        });
        await prisma.tontineGroup.update({
            where: { id: group.id },
            data: { status: 'ACTIVE', lastPayoutDate: null, renewalDeadline: null }
        });
        await prisma.notification.createMany({
            data: stayers.map((p: any) => ({
                userId: p.userId,
                title: 'Nouvelle boucle démarrée 🎉',
                body: `« ${group.name} » repart pour une nouvelle boucle avec ${stayers.length} membres.`,
                type: 'INFO'
            }))
        });
        await Promise.all(stayers.map((p: any) => sendPush(p.user?.pushToken, 'Nouvelle boucle démarrée', `« ${group.name} » repart pour une nouvelle boucle.`)));
        return { resolved: true, restarted: true, stayers: stayers.length, leavers: leavers.length };
    }

    await prisma.tontineGroup.update({ where: { id: group.id }, data: { status: 'COMPLETED', renewalDeadline: null } });
    if (stayers.length > 0) {
        await prisma.notification.createMany({
            data: stayers.map((p: any) => ({
                userId: p.userId,
                title: 'Tontine définitivement terminée',
                body: `« ${group.name} » ne peut pas relancer une nouvelle boucle (pas assez de membres ont accepté de continuer).`,
                type: 'INFO'
            }))
        });
        await Promise.all(stayers.map((p: any) => sendPush(p.user?.pushToken, 'Tontine terminée', `« ${group.name} » ne relance pas de nouvelle boucle.`)));
    }
    return { resolved: true, restarted: false, stayers: stayers.length, leavers: leavers.length };
}

// Relance ciblée des cotisations en échec d'un cycle déjà exécuté — utilisé par l'admin
// (admin.tontines.ts, POST /:id/cycles/:cycleId/retry) plutôt que de rejouer tout le cycle.
// Limite connue : si la cagnotte du cycle a déjà été versée avant la relance, les fonds
// rattrapés ici restent dans le Coffre Tontine (créditent le pot d'un cycle futur) plutôt
// que d'être reversés rétroactivement au bénéficiaire déjà payé — un second versement pour
// un même cycle romprait l'idempotence TONT_PAY_G{id}_C{cycle}_U{userId} par construction.
export async function retryFailedContributions(groupId: string, cycleId: string) {
    const cycle = await prisma.tontineCycle.findUnique({
        where: { id: cycleId },
        // PARTIAL : cotisation incomplète dans le nouveau modèle de dépôts libres (voir
        // collectParticipantContribution) ; FAILED : ancien statut, uniquement des cycles
        // créés avant l'introduction des dépôts partiels (aucun centime collecté).
        include: { contributions: { where: { status: { in: ['FAILED', 'PARTIAL'] } }, include: { participant: true } } }
    });
    if (!cycle || cycle.tontineGroupId !== groupId) throw new Error('Cycle introuvable.');

    const group: any = await prisma.tontineGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new Error('Tontine introuvable.');

    const vaultWallet = await getTontineVaultWallet();
    const settings = await getSystemSettings();

    let retriedCount = 0;
    let stillFailedCount = 0;
    let recovered = 0;

    for (const contribution of cycle.contributions) {
        if (contribution.participant.status !== 'ACTIVE') continue; // parti/pausé depuis — on ne le relance pas
        const alreadyPaidBefore = contribution.status === 'FAILED' ? 0 : contribution.amount;
        const remaining = group.contribution - alreadyPaidBefore;
        if (remaining <= 0) continue;
        const result = await collectParticipantContribution(
            { id: group.id, contribution: group.contribution, currentCycle: cycle.cycleNumber },
            contribution.participantId,
            contribution.participant.userId,
            cycle.id,
            vaultWallet.id,
            settings,
            remaining
        );
        if (result.success) {
            retriedCount++;
            recovered += remaining;
        } else {
            stillFailedCount++;
        }
    }

    // Avant ce correctif, cette relance ne retentait le versement QUE si elle venait
    // elle-même de rattraper au moins une cotisation en échec (`recovered > 0`) — un cycle
    // resté bloqué au statut PAYOUT_FAILED (collecte entièrement réussie, seul le versement
    // a échoué, voir executeTontineCycle) n'avait donc aucune cotisation FAILED à relancer,
    // et cette condition ne se déclenchait jamais alors même que l'argent attendait déjà,
    // prêt, dans le coffre. On retente désormais le versement dès qu'un montant collecté
    // existe, que ce soit d'un rattrapage ou de la collecte d'origine.
    const payoutWasMissing = !cycle.payoutTransactionId;
    let payoutTransactionId = cycle.payoutTransactionId;
    const totalAvailableForPayout = cycle.totalCollected + recovered;
    if (!payoutTransactionId && totalAvailableForPayout > 0) {
        const beneficiary = cycle.beneficiaryParticipantId
            ? await prisma.tontineParticipant.findUnique({ where: { id: cycle.beneficiaryParticipantId } })
            : undefined;
        payoutTransactionId = await payoutBeneficiaryIfDue(
            { id: group.id, name: group.name, currentCycle: cycle.cycleNumber },
            beneficiary ?? undefined,
            totalAvailableForPayout,
            vaultWallet.id
        );
    }

    const stillFailing = await prisma.tontineContribution.count({ where: { cycleId: cycle.id, status: { in: ['FAILED', 'PARTIAL'] } } });
    await prisma.tontineCycle.update({
        where: { id: cycle.id },
        data: {
            totalCollected: totalAvailableForPayout,
            status: stillFailing > 0 ? 'PARTIAL' : 'COMPLETED',
            payoutTransactionId
        }
    });

    // Le cycle n'avait pas fait avancer currentCycle lors de son exécution d'origine (voir
    // executeTontineCycle, payoutFailed) — une fois le versement résolu ici, on rattrape cet
    // avancement, mais seulement si le groupe est toujours sur ce même cycle (sinon il a déjà
    // avancé via un cycle plus récent, et le toucher romprait sa progression).
    if (payoutTransactionId && group.currentCycle === cycle.cycleNumber) {
        await prisma.tontineGroup.update({ where: { id: group.id }, data: { currentCycle: cycle.cycleNumber + 1 } });
    }

    const payoutResolved = payoutWasMissing && !!payoutTransactionId;
    return { retriedCount, stillFailedCount, recovered, payoutResolved };
}
