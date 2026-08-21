import { prisma } from '../prisma';
import { generateReference } from '../utils/reference';
import { LimitEngine } from './LimitEngine';

export class CashOperationService {

    /**
     * Exécute un Dépôt Cash-In en agence.
     * Logique: L'agence reçoit de l'espèce physique (balance) et débite de sa monnaie électronique (wallet).
     * Le client est crédité en monnaie électronique.
     */
    static async executeCashIn(params: {
        amount: number;
        clientPhone: string;
        tellerId: string;
        branchId: string;
        idempotencyKey?: string;
    }) {
        const { amount, clientPhone, tellerId, branchId, idempotencyKey } = params;
        if (amount <= 0) throw new Error("Le montant doit être positif.");

        return await prisma.$transaction(async (tx) => {
            // 1. Idempotence Guard
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return dup;
            }

            // 2. Vérification Session
            const session = await tx.cashSession.findFirst({
                where: { tellerId, status: 'OPEN', branchId }
            });
            if (!session) throw new Error("Aucune session de caisse ouverte pour ce Teller dans cette agence.");

            // 3. Vérification Agence et Liquidité (Wallet monnaie électronique)
            const branch = await tx.branch.findUnique({
                where: { id: branchId },
                include: { wallet: true }
            });
            if (!branch || !branch.wallet) throw new Error("Configuration agence introuvable.");
            if (branch.status !== 'ACTIVE') throw new Error("L'agence n'est pas active.");
            if (branch.wallet.balance < amount) throw new Error("Liquidité électronique agence insuffisante.");

            // 4. Vérification Client
            const client = await tx.user.findUnique({
                where: { phone: clientPhone },
                include: { wallet: true }
            });
            if (!client || !client.wallet) throw new Error("Client introuvable.");
            if (client.accountStatus !== 'ACTIVE') throw new Error(`Le compte est ${client.accountStatus}. Autorisation refusée.`);

            // 5. Mises à jour Financières
            const reference = generateReference('CIN');

            // On déduit la monnaie E de l'agence — garde atomique (balance: gte) en plus du
            // contrôle ci-dessus : deux Cash-In simultanés du même Teller/agence liraient la
            // même balance non verrouillée et passeraient tous deux le contrôle informatif,
            // ce qui pouvait faire passer la liquidité électronique de l'agence en négatif.
            await tx.wallet.update({
                where: { id: branch.wallet.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Aucuns frais par défaut pour le client en Cash-In, mais s'il y en a (taxCashIn), on le prélève en P2P ? 
            // V6 Spec: "Le cash in peut générer un fee". Si taxCashIn = 1.5%, qui paie ? 
            // Supposons qu'il dépose 10,000, il reçoit 10,000 net, l'agence encaisse un Cash In Fee ?
            // On va simplifier selon le Prompt 14: on update direct.
            const netAmount = amount; // Sans frais pour l'instant pour le Cash-In

            await tx.wallet.update({
                where: { id: client.wallet.id },
                data: { balance: { increment: netAmount } }
            });

            // 6. Enregistrement Transaction
            const transaction = await tx.transaction.create({
                data: {
                    senderWalletId: branch.wallet.id,
                    receiverWalletId: client.wallet.id,
                    amount,
                    fee: 0,
                    type: 'CASH_IN',
                    status: 'COMPLETED',
                    reference,
                    branchId,
                    tellerId,
                    idempotencyKey
                }
            });

            // 7. Update coffre physique (L'agence a pris les billets)
            await tx.branch.update({
                where: { id: branchId },
                data: { balance: { increment: amount } }
            });

            // 8. Update Tally Caisse
            await tx.cashSession.update({
                where: { id: session.id },
                data: { totalCashInValue: { increment: amount } }
            });

            // Comme /transfer et /refund-requests : sans ça, le client n'a aucune trace de ce
            // dépôt physique en agence dans son historique de notifications.
            await tx.notification.create({
                data: { userId: client.id, title: 'Dépôt reçu', body: `Vous avez reçu un dépôt de ${amount.toLocaleString('fr-FR')} FCFA en agence.`, type: 'TRANSACTION' }
            });

            return transaction;
        });
    }

    /**
     * Exécute un Retrait Cash-Out en agence.
     * Logique: Le client déduit sa monnaie électronique. L'agence crédite son E-wallet, et sort les billets du coffre physique.
     */
    static async executeCashOut(params: {
        amount: number;
        clientPhone: string;
        tellerId: string;
        branchId: string;
        idempotencyKey?: string;
    }) {
        const { amount, clientPhone, tellerId, branchId, idempotencyKey } = params;
        if (amount <= 0) throw new Error("Le montant doit être positif.");

        return await prisma.$transaction(async (tx) => {
            // 1. Idempotence Guard
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return dup;
            }

            // 2. Session & Vault check
            const session = await tx.cashSession.findFirst({
                where: { tellerId, status: 'OPEN', branchId }
            });
            if (!session) throw new Error("Aucune session de caisse ouverte.");
            const branch = await tx.branch.findUnique({ where: { id: branchId }, include: { wallet: true } });
            if (!branch || !branch.wallet) throw new Error("Configuration agence introuvable.");

            // Sécurité Liquidité Physique (Il faut pouvoir donner des billets)
            if (branch.balance < amount) throw new Error("Liquidité physique (coffre) insuffisante en agence ! Veuillez faire une demande de fond (Funding Request).");

            // 4. Client Check & Eligibility (Limits)
            const client = await tx.user.findUnique({
                where: { phone: clientPhone },
                include: { wallet: true, riskFlags: { where: { status: 'OPEN' } } }
            });
            if (!client || !client.wallet) throw new Error("Client introuvable.");
            if (client.accountStatus !== 'ACTIVE') throw new Error(`Compte client ${client.accountStatus}.`);
            if (client.riskFlags.length > 0) throw new Error(`Ce compte possède ${client.riskFlags.length} flags de risque. Fraude suspectée, retrait bloqué.`);

            // 5. Limit Engine Validation
            const settings = await tx.systemSettings.findFirst();
            // Vérifie que le Cash Out n'explose pas la limite du mois ou jour.
            const limits = await LimitEngine.getApplicableLimits(client, settings);
            if (client.wallet.dailySpent + amount > limits.effectiveDaily) {
                throw new Error(`Dépassement du plafond journalier (Restant: ${limits.effectiveDaily - client.wallet.dailySpent} FCFA)`);
            }
            if (client.wallet.monthlySpent + amount > limits.effectiveMonthly) {
                throw new Error(`Dépassement du plafond mensuel.`);
            }

            // 6. Anti-Fractionnement Check global (Toutes succursales confondues)
            if (settings) {
                const hours = settings.antiFractioningWindowHours || 24;
                const windowEnd = new Date();
                const windowStart = new Date(windowEnd.getTime() - hours * 3600 * 1000);

                const pastOps = await tx.transaction.findMany({
                    where: {
                        senderWalletId: client.wallet.id,
                        type: 'CASH_OUT',
                        createdAt: { gte: windowStart }
                    },
                    select: { amount: true, branchId: true }
                });

                const totalPastAmount = pastOps.reduce((sum, t) => sum + t.amount, 0);
                const combinedAmount = totalPastAmount + amount;

                const uniqueBranches = new Set(pastOps.map(t => t.branchId).filter(Boolean));
                uniqueBranches.add(branchId);

                if (combinedAmount > settings.antiFractioningMaxAmount && (uniqueBranches.size > 1 || pastOps.length >= settings.antiFractioningMaxCount)) {
                    const action = settings.antiFractioningAction;
                    if (action === 'BLOCK') {
                        await tx.riskFlag.create({
                            data: {
                                userId: client.id, authorId: tellerId, type: 'ANTI_FRACTIONING',
                                description: `Action bloquage Cash-Out de ${amount} suite dépassement du seuil par cumul.`
                            }
                        });
                        throw new Error("Opération rejetée : Politique d'Anti-Fractionnement activée.");
                    }
                }
            }

            // 6. Facturation et Frais dynamiques
            const fee = amount * (settings?.taxWithdraw || 0.013);
            const totalToDeduct = amount + fee;

            if (client.wallet.balance < totalToDeduct) {
                throw new Error(`Solde insuffisant. Il faut ${totalToDeduct} FCFA (incluant ${fee} FCFA de frais).`);
            }

            const reference = generateReference('COT');

            // 7. Mouvements Monnaie Electronique — garde atomique (balance: gte) : le contrôle du
            // point 6 lit une balance non verrouillée, donc deux Cash-Out simultanés pour le même
            // client (ex: le même code secret redeemé par deux agents en parallèle) passeraient
            // tous deux ce contrôle et pourraient faire passer le solde en négatif.
            await tx.wallet.update({
                where: { id: client.wallet.id, balance: { gte: totalToDeduct } },
                data: {
                    balance: { decrement: totalToDeduct },
                    dailySpent: { increment: totalToDeduct },
                    monthlySpent: { increment: totalToDeduct }
                }
            });

            await tx.wallet.update({
                where: { id: branch.wallet.id },
                data: { balance: { increment: amount } } // L'agence récupère l'équivalent de ce qu'elle sort en physique
            });

            if (fee > 0) {
                // Le revenu généré par la plateforme va au Corporate
                const corporate = await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' }, include: { wallet: true }, orderBy: { id: 'asc' } });
                if (corporate?.wallet) {
                    await tx.wallet.update({ where: { id: corporate.wallet.id }, data: { balance: { increment: fee } } });
                }
            }

            // 8. Opération transaction
            const transaction = await tx.transaction.create({
                data: {
                    senderWalletId: client.wallet.id,
                    receiverWalletId: branch.wallet.id,
                    amount,
                    fee,
                    type: 'CASH_OUT',
                    status: 'COMPLETED',
                    reference,
                    branchId,
                    tellerId,
                    idempotencyKey
                }
            });

            // 9. Mouvements Caisses Physiques — même garde atomique que le wallet client ci-dessus.
            await tx.branch.update({
                where: { id: branchId, balance: { gte: amount } },
                data: { balance: { decrement: amount } } // On décaisse le physique remis au client
            });

            await tx.cashSession.update({
                where: { id: session.id },
                data: { totalCashOutValue: { increment: amount } }
            });

            await tx.notification.create({
                data: { userId: client.id, title: 'Retrait effectué', body: `Vous avez retiré ${amount.toLocaleString('fr-FR')} FCFA en agence (frais : ${fee.toLocaleString('fr-FR')} FCFA).`, type: 'TRANSACTION' }
            });

            return transaction;
        });
    }

}
