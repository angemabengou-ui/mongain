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

export async function executeTontineCycle(groupId: string) {
    const group: any = await prisma.tontineGroup.findUnique({ where: { id: groupId }, include: { participants: true } });
    if (!group) return { success: false, message: "Group not found" };

    const vaultWallet = await getTontineVaultWallet();
    const settings = await getSystemSettings();

    let debitedCount = 0;
    let failedCount = 0;
    let totalPot = 0;

    for (const p of group.participants) {
        if (p.status !== 'ACTIVE') continue;

        // Idempotency: Vérifier si le client a DÉJÀ cotisé pour CE cycle (en cas de plantage/reprise)
        const idempotencyDebitRef = `TONT_DBT_G${group.id}_C${group.currentCycle}_U${p.userId}`;
        const existingTx = await prisma.transaction.findFirst({ where: { reference: idempotencyDebitRef } });

        if (existingTx && existingTx.status === 'COMPLETED') {
            debitedCount++;
            totalPot += existingTx.amount;
            continue; // Déjà prélevé lors d'une tentative précédente qui a planté
        }

        const wallet = await prisma.wallet.findUnique({ where: { userId: p.userId } });
        if (!wallet) { failedCount++; continue; }

        try {
            await prisma.$transaction(async (tx) => {
                const fee = group.contribution * settings.taxP2P;
                const totalDebit = group.contribution + fee;

                await LimitEngine.verifyAndIncrementConsumption(tx, p.userId, wallet.id, totalDebit, settings);

                const updated = await tx.wallet.updateMany({
                    where: { id: wallet.id, balance: { gte: totalDebit } },
                    data: { balance: { decrement: totalDebit } }
                });
                if (updated.count === 0) throw new Error('Solde insuffisant.');

                await tx.wallet.update({
                    where: { id: vaultWallet.id },
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

                await tx.transaction.create({
                    data: {
                        amount: group.contribution,
                        fee: fee,
                        senderWalletId: wallet.id,
                        receiverWalletId: vaultWallet.id,
                        status: "COMPLETED",
                        reference: idempotencyDebitRef
                    }
                });
                await tx.notification.create({
                    data: { userId: p.userId, title: "Cotisation Tontine prélevée 💸", body: `Votre cotisation de ${group.contribution} FCFA pour ${group.name} a été débitée (incluant ${fee} FCFA de frais).`, type: "INFO" }
                });
            });
            debitedCount++;
            totalPot += group.contribution;
        } catch (err: any) {
            // Un fail ici ne stoppe pas la tontine (ex: solde insuffisant) -> on permet la
            // défaillance partielle, d'où l'impossibilité d'utiliser une seule grosse
            // transaction $transaction pour tout le groupe.
            const errStr = err.message || "";
            // Ne spammez l'utilisateur que si l'erreur n'est pas déjà notifiée récemment
            // (TODO: throttling des alertes d'échec pour éviter le spam cron)
            await prisma.notification.create({
                data: { userId: p.userId, title: "Échec Cotisation Tontine ⚠️", body: errStr.includes('Plafond') ? errStr : `Solde insuffisant pour la tontine ${group.name}.`, type: "ALERT" }
            });
            failedCount++;
        }
    }

    // `!p.hasReceivedPayout` : sans ça, le créateur (seul habilité à réordonner via
    // POST /tontine/reorder, où `newOrder` n'est pas borné) pouvait réassigner son propre
    // payoutOrder au cycle courant avant chaque exécution et s'attribuer la cagnotte
    // indéfiniment. Un participant déjà payé une fois ne peut plus jamais être sélectionné,
    // quelle que soit la valeur de payoutOrder au moment du cycle suivant.
    const beneficiary = group.participants.find((p: any) => p.payoutOrder === group.currentCycle && p.status === 'ACTIVE' && !p.hasReceivedPayout);
    if (beneficiary && totalPot > 0) {
        const idempotencyPayoutRef = `TONT_PAY_G${group.id}_C${group.currentCycle}_U${beneficiary.userId}`;
        const payoutDone = await prisma.transaction.findFirst({ where: { reference: idempotencyPayoutRef } });

        if (!payoutDone) {
            const beneficiaryWallet = await prisma.wallet.findUnique({ where: { userId: beneficiary.userId } });
            if (beneficiaryWallet) {
                await prisma.$transaction(async (tx) => {
                    const claim = await tx.wallet.updateMany({
                        where: { id: vaultWallet.id, balance: { gte: totalPot } },
                        data: { balance: { decrement: totalPot } }
                    });
                    if (claim.count === 0) throw new Error('Coffre Tontine insuffisant pour ce paiement.');

                    await tx.wallet.update({
                        where: { id: beneficiaryWallet.id },
                        data: { balance: { increment: totalPot } }
                    });

                    await tx.transaction.create({
                        data: { amount: totalPot, receiverWalletId: beneficiaryWallet.id, senderWalletId: vaultWallet.id, status: "COMPLETED", reference: idempotencyPayoutRef }
                    });
                    await tx.tontineParticipant.update({
                        where: { id: beneficiary.id },
                        data: { hasReceivedPayout: true }
                    });
                    await tx.notification.create({
                        data: { userId: beneficiary.userId, title: "🎉 Cagnotte Tontine Reçue !", body: `C'est votre tour ! Vous avez reçu la cagnotte de ${totalPot} FCFA du club ${group.name}.`, type: "INFO" }
                    });
                });
            }
        }
    }

    const nextCycle = group.currentCycle + 1;
    await prisma.tontineGroup.update({ where: { id: group.id }, data: { currentCycle: nextCycle } });

    console.log(`✅ Cycle ${group.currentCycle} pour ${group.name} exécuté: ${totalPot} FCFA`);
    return { success: true, debitedCount, failedCount, totalPot, currentCycle: group.currentCycle };
}
