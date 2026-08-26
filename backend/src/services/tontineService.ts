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

// Débite la cotisation d'UN participant pour le cycle courant du groupe, crédite le
// Coffre Tontine, et trace le résultat dans TontineContribution (grand livre structuré —
// avant, seule une Transaction à reference conventionnelle TONT_DBT_G{id}_C{cycle}_U{userId}
// permettait de reconstituer l'historique). Utilisé par executeTontineCycle (premier passage)
// et retryFailedContributions (rattrapage ciblé) : même logique, même idempotence.
async function collectParticipantContribution(
    group: { id: string; contribution: number; currentCycle: number },
    participantId: string,
    userId: string,
    cycleId: string,
    vaultWalletId: string,
    settings: Awaited<ReturnType<typeof getSystemSettings>>
): Promise<{ success: boolean; amount: number }> {
    const idempotencyDebitRef = `TONT_DBT_G${group.id}_C${group.currentCycle}_U${userId}`;
    const existingTx = await prisma.transaction.findFirst({ where: { reference: idempotencyDebitRef } });

    if (existingTx && existingTx.status === 'COMPLETED') {
        await prisma.tontineContribution.upsert({
            where: { cycleId_participantId: { cycleId, participantId } },
            create: { cycleId, participantId, transactionId: existingTx.id, amount: existingTx.amount, status: 'PAID' },
            update: { transactionId: existingTx.id, amount: existingTx.amount, status: 'PAID' }
        });
        return { success: true, amount: existingTx.amount };
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
        await prisma.tontineContribution.upsert({
            where: { cycleId_participantId: { cycleId, participantId } },
            create: { cycleId, participantId, amount: group.contribution, status: 'FAILED' },
            update: { status: 'FAILED' }
        });
        return { success: false, amount: 0 };
    }

    try {
        const createdTxId = await prisma.$transaction(async (tx) => {
            const fee = group.contribution * settings.taxP2P;
            const totalDebit = group.contribution + fee;

            await LimitEngine.verifyAndIncrementConsumption(tx, userId, wallet.id, totalDebit, settings);

            const updated = await tx.wallet.updateMany({
                where: { id: wallet.id, balance: { gte: totalDebit } },
                data: { balance: { decrement: totalDebit } }
            });
            if (updated.count === 0) throw new Error('Solde insuffisant.');

            await tx.wallet.update({
                where: { id: vaultWalletId },
                data: { balance: { increment: group.contribution } }
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
                    amount: group.contribution,
                    fee,
                    senderWalletId: wallet.id,
                    receiverWalletId: vaultWalletId,
                    status: 'COMPLETED',
                    reference: idempotencyDebitRef
                }
            });
            await tx.notification.create({
                data: { userId, title: 'Cotisation Tontine prélevée 💸', body: `Votre cotisation de ${group.contribution} FCFA pour ce club a été débitée (incluant ${fee} FCFA de frais).`, type: 'INFO' }
            });

            return createdTx.id;
        });

        await prisma.tontineContribution.upsert({
            where: { cycleId_participantId: { cycleId, participantId } },
            create: { cycleId, participantId, transactionId: createdTxId, amount: group.contribution, status: 'PAID' },
            update: { transactionId: createdTxId, amount: group.contribution, status: 'PAID' }
        });
        return { success: true, amount: group.contribution };
    } catch (err: any) {
        // Un fail ici ne stoppe pas la tontine (ex: solde insuffisant) -> on permet la
        // défaillance partielle, d'où l'impossibilité d'utiliser une seule grosse
        // transaction $transaction pour tout le groupe.
        const errStr = err.message || '';
        // TODO: throttling des alertes d'échec pour éviter le spam cron
        await prisma.notification.create({
            data: { userId, title: 'Échec Cotisation Tontine ⚠️', body: errStr.includes('Plafond') ? errStr : `Solde insuffisant pour cette tontine.`, type: 'ALERT' }
        });
        await prisma.tontineContribution.upsert({
            where: { cycleId_participantId: { cycleId, participantId } },
            create: { cycleId, participantId, amount: group.contribution, status: 'FAILED' },
            update: { status: 'FAILED' }
        });
        return { success: false, amount: 0 };
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

export async function executeTontineCycle(groupId: string) {
    const group: any = await prisma.tontineGroup.findUnique({ where: { id: groupId }, include: { participants: true } });
    if (!group) return { success: false, message: 'Group not found' };

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

    const activeParticipants = group.participants.filter((p: any) => p.status === 'ACTIVE');

    for (const p of activeParticipants) {
        const result = await collectParticipantContribution(group, p.id, p.userId, cycle.id, vaultWallet.id, settings);
        if (result.success) {
            debitedCount++;
            totalPot += result.amount;
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
    const payoutTransactionId = await payoutBeneficiaryIfDue(group, beneficiary, totalPot, vaultWallet.id);

    await prisma.tontineCycle.update({
        where: { id: cycle.id },
        data: {
            totalExpected: activeParticipants.length * group.contribution,
            totalCollected: totalPot,
            status: failedCount > 0 ? 'PARTIAL' : 'COMPLETED',
            beneficiaryParticipantId: beneficiary?.id ?? null,
            payoutTransactionId
        }
    });

    const nextCycle = group.currentCycle + 1;
    await prisma.tontineGroup.update({ where: { id: group.id }, data: { currentCycle: nextCycle } });

    console.log(`✅ Cycle ${group.currentCycle} pour ${group.name} exécuté: ${totalPot} FCFA`);
    return { success: true, debitedCount, failedCount, totalPot, currentCycle: group.currentCycle };
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
        include: { contributions: { where: { status: 'FAILED' }, include: { participant: true } } }
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
        const result = await collectParticipantContribution(
            { id: group.id, contribution: group.contribution, currentCycle: cycle.cycleNumber },
            contribution.participantId,
            contribution.participant.userId,
            cycle.id,
            vaultWallet.id,
            settings
        );
        if (result.success) {
            retriedCount++;
            recovered += result.amount;
        } else {
            stillFailedCount++;
        }
    }

    let payoutTransactionId = cycle.payoutTransactionId;
    if (!payoutTransactionId && recovered > 0) {
        const beneficiary = cycle.beneficiaryParticipantId
            ? await prisma.tontineParticipant.findUnique({ where: { id: cycle.beneficiaryParticipantId } })
            : undefined;
        payoutTransactionId = await payoutBeneficiaryIfDue(
            { id: group.id, name: group.name, currentCycle: cycle.cycleNumber },
            beneficiary ?? undefined,
            cycle.totalCollected + recovered,
            vaultWallet.id
        );
    }

    const stillFailing = await prisma.tontineContribution.count({ where: { cycleId: cycle.id, status: 'FAILED' } });
    await prisma.tontineCycle.update({
        where: { id: cycle.id },
        data: {
            totalCollected: cycle.totalCollected + recovered,
            status: stillFailing > 0 ? 'PARTIAL' : 'COMPLETED',
            payoutTransactionId
        }
    });

    return { retriedCount, stillFailedCount, recovered };
}
