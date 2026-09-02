import { prisma } from '../prisma';
import logger from '../utils/logger';
import { generateReference } from '../utils/reference';

/**
 * Automates Tontine deductions and payouts.
 * In a real environment, this is called by `node-cron` every day at 00:00.
 */
export async function executeTontineAutomations() {
    logger.info("[Tontine Automator] Running cycle...");

    try {
        const activeTontines = await prisma.tontineGroup.findMany({
            where: { status: 'ACTIVE' },
            include: {
                participants: { include: { user: { include: { wallet: true } } } }
            }
        });

        for (const tontine of activeTontines) {
            // Find today's cycle/round logic...
            // For architecture demo purposes, we will mock the process of deducting participants.
            // In a real cron, we verify if TODAY is a configured payout day.

            // Assuming today is payout day for `tontine`
            const payoutAmount = tontine.contribution * tontine.participants.length;

            await prisma.$transaction(async (tx) => {
                // Fetch the Vault for Tontine
                const tontineReserve = await tx.systemAccount.findUnique({
                    where: { kind: 'TONTINE_VAULT' },
                    include: { wallet: true }
                });

                if (!tontineReserve || !tontineReserve.wallet) throw new Error("Vault Introuvable");

                for (const part of tontine.participants) {
                    if (part.user.accountStatus !== 'ACTIVE') continue;

                    // Pull amount from participant
                    if (part.user.wallet!.balance >= tontine.contribution) {

                        await tx.wallet.update({
                            where: { id: part.user.wallet!.id, balance: { gte: tontine.contribution } },
                            data: { balance: { decrement: tontine.contribution } }
                        });

                        await tx.wallet.update({
                            where: { id: tontineReserve.wallet!.id },
                            data: { balance: { increment: tontine.contribution } }
                        });

                        await tx.transaction.create({
                            data: {
                                amount: tontine.contribution,
                                status: 'COMPLETED',
                                reference: generateReference('TON_IN'),
                                senderWalletId: part.user.wallet!.id,
                                receiverWalletId: tontineReserve.wallet.id,
                                fee: 0
                            }
                        });
                    } else {
                        // Participant failed -> Send Alert / Notification / Strike
                        logger.warn(`Tontine ${tontine.id}: ${part.user.phone} insufficient funds.`);
                    }
                }

                // PAYOUT AUTOMATISÉ
                // Choose Next recipient logically (e.g. payoutOrder === currentRound)
                const winner = tontine.participants[Math.floor(Math.random() * tontine.participants.length)];

                await tx.wallet.update({
                    where: { id: tontineReserve.wallet!.id, balance: { gte: payoutAmount } },
                    data: { balance: { decrement: payoutAmount } }
                });

                await tx.wallet.update({
                    where: { id: winner.user.wallet!.id },
                    data: { balance: { increment: payoutAmount } }
                });

                await tx.transaction.create({
                    data: {
                        amount: payoutAmount,
                        status: 'COMPLETED',
                        reference: generateReference('TON_WIN'),
                        senderWalletId: tontineReserve.wallet.id,
                        receiverWalletId: winner.user.wallet!.id,
                        fee: 0
                    }
                });

                await tx.notification.create({
                    data: {
                        userId: winner.userId,
                        title: `Tontine ${tontine.name}`,
                        body: `C'est votre tour ! Cagnotte reçue : ${payoutAmount} FCFA.`,
                        type: 'TRANSACTION'
                    }
                });
            });
            logger.info(`[Tontine Automator] Tontine ${tontine.id} cycle resolved.`);
        }
    } catch (e: any) {
        logger.error(`[Tontine Automator Error] ${e.message}`);
    }
}
