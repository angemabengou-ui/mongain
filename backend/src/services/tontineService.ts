import { prisma } from '../prisma';

export async function executeTontineCycle(groupId: string) {
    const group: any = await prisma.tontineGroup.findUnique({ where: { id: groupId }, include: { participants: true } });
    if (!group) return { success: false, message: "Group not found" };

    let debitedCount = 0;
    let failedCount = 0;
    let totalPot = 0;

    for (const p of group.participants) {
        if (p.status !== 'ACTIVE') continue;
        const wallet = await prisma.wallet.findUnique({ where: { userId: p.userId } });

        if (wallet && wallet.balance >= group.contribution) {
            await prisma.$transaction(async (tx) => {
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { decrement: group.contribution } }
                });
                await tx.transaction.create({
                    data: {
                        amount: group.contribution,
                        receiverWalletId: "VAULT_TONTINE_" + group.id,
                        status: "COMPLETED",
                        reference: `TONTINE_DEBIT_${p.id}_${Date.now()}`
                    }
                });
                await tx.notification.create({
                    data: { userId: p.userId, title: "Cotisation Tontine prélevée 💸", body: `Votre cotisation de ${group.contribution} FCFA pour ${group.name} a été débitée.`, type: "INFO" }
                });
            });
            debitedCount++;
            totalPot += group.contribution;
        } else {
            await prisma.notification.create({
                data: { userId: p.userId, title: "Échec Cotisation Tontine ⚠️", body: `Solde insuffisant pour la tontine ${group.name}.`, type: "ALERT" }
            });
            failedCount++;
        }
    }

    const beneficiary = group.participants.find((p: any) => p.payoutOrder === group.currentCycle && p.status === 'ACTIVE');
    if (beneficiary && totalPot > 0) {
        const beneficiaryWallet = await prisma.wallet.findUnique({ where: { userId: beneficiary.userId } });
        if (beneficiaryWallet) {
            await prisma.$transaction(async (tx) => {
                await tx.wallet.update({
                    where: { id: beneficiaryWallet.id },
                    data: { balance: { increment: totalPot } }
                });
                await tx.transaction.create({
                    data: { amount: totalPot, receiverWalletId: beneficiaryWallet.id, senderWalletId: "VAULT_TONTINE_" + group.id, status: "COMPLETED", reference: `TONTINE_PAYOUT_${beneficiary.id}_${Date.now()}` }
                });
                await tx.notification.create({
                    data: { userId: beneficiary.userId, title: "🎉 Cagnotte Tontine Reçue !", body: `C'est votre tour ! Vous avez reçu la cagnotte de ${totalPot} FCFA du club ${group.name}.`, type: "INFO" }
                });
            });
        }
    }

    const nextCycle = group.currentCycle + 1;
    await prisma.tontineGroup.update({ where: { id: group.id }, data: { currentCycle: nextCycle } });

    console.log(`✅ Cycle ${group.currentCycle} pour ${group.name} exécuté: ${totalPot} FCFA`);
    return { success: true, debitedCount, failedCount, totalPot, currentCycle: group.currentCycle };
}
