import { prisma } from './prisma';
import { checkOverdueBnplContracts, checkOverdueLoans as checkOverdueLoansRisk } from './services/creditRisk';
import { executeTontineCycle, notifyUpcomingCycle, resolveRenewalPoll } from './services/tontineService';
import logger from './utils/logger';

function addInterval(date: Date, frequency: string): Date {
    const next = new Date(date);
    if (frequency === 'WEEKLY') {
        next.setDate(next.getDate() + 7);
    } else {
        // MONTHLY (et tout défaut inconnu) : un mois calendaire, pas 30 jours fixes.
        next.setMonth(next.getMonth() + 1);
    }
    return next;
}

/**
 * Automatise les tontines : prélèvement + versement de cagnotte des groupes dont
 * l'échéance (frequency/lastPayoutDate) est atteinte, rappel la veille, et résolution
 * des sondages de relance dont le délai a expiré.
 *
 * Remplace l'ancienne implémentation de démonstration qui tirait un bénéficiaire au
 * hasard (`Math.random()`), ignorait entièrement le grand livre TontineCycle/
 * TontineContribution, ne vérifiait jamais si une échéance réelle était atteinte (elle
 * s'exécutait pour CHAQUE tontine ACTIVE à chaque appel), et ne réutilisait pas la vraie
 * logique métier de services/tontineService.ts (pénalités de retard, sondage de fin de
 * boucle, idempotence des cotisations déjà versées à l'avance via /contribute).
 */
export async function executeTontineAutomations() {
    logger.info('[Tontine Automator] Vérification des échéances...');
    const now = new Date();

    try {
        // 1. Sondages de relance dont le délai a expiré sans que tous les membres aient
        // répondu (le cas "tout le monde a déjà voté" est déjà tranché immédiatement par
        // routes/tontine.ts POST /renewal-vote — ceci ne couvre que l'expiration du délai).
        const pendingRenewals = await prisma.tontineGroup.findMany({
            where: { status: 'PENDING_RENEWAL', renewalDeadline: { lte: now } },
            select: { id: true, name: true }
        });

        for (const group of pendingRenewals) {
            try {
                await resolveRenewalPoll(group.id);
                logger.info(`[Tontine Automator] Sondage de relance tranché pour « ${group.name} ».`);
            } catch (e: any) {
                logger.error(`[Tontine Automator] Échec résolution du sondage « ${group.name} » : ${e.message}`);
            }
        }

        // 2. Groupes actifs et non mis en pause : cycle si échu, sinon rappel la veille.
        const activeTontines = await prisma.tontineGroup.findMany({
            where: { status: 'ACTIVE', isPaused: false },
            select: { id: true, name: true, contribution: true, frequency: true, startDate: true, lastPayoutDate: true }
        });

        for (const group of activeTontines) {
            const reference = group.lastPayoutDate || group.startDate;
            const nextDue = addInterval(reference, group.frequency);

            if (now >= nextDue) {
                try {
                    const result = await executeTontineCycle(group.id);
                    // `lastPayoutDate` n'avance que si le versement a réellement réussi — sinon
                    // le CRON doit retenter ce même cycle au prochain passage plutôt que de
                    // sauter silencieusement une échéance entière (même garde que `currentCycle`
                    // à l'intérieur d'executeTontineCycle lui-même).
                    if (result.success && !result.payoutFailed) {
                        await prisma.tontineGroup.update({ where: { id: group.id }, data: { lastPayoutDate: now } });
                    }
                    logger.info(`[Tontine Automator] « ${group.name} » — cycle ${result.currentCycle} traité (${result.debitedCount ?? 0} cotisations, échec versement : ${!!result.payoutFailed}).`);
                } catch (e: any) {
                    logger.error(`[Tontine Automator] Échec du cycle « ${group.name} » : ${e.message}`);
                }
            } else {
                const msUntilDue = nextDue.getTime() - now.getTime();
                const oneDayMs = 24 * 60 * 60 * 1000;
                if (msUntilDue <= oneDayMs) {
                    await notifyUpcomingCycle(group);
                }
            }
        }
    } catch (e: any) {
        logger.error(`[Tontine Automator Error] ${e.message}`);
    }
}

/**
 * Fait basculer en DEFAULTED les micro-crédits (Loan) dont l'échéance (dueDate, voir
 * credit.ts /apply) est dépassée sans remboursement, et notifie le client concerné. Logique
 * réelle dans services/creditRisk.ts (partagée avec checkOverdueBnpl ci-dessous pour éviter de
 * dupliquer le couple transition/notification) — cette fonction n'est qu'un point d'entrée
 * nommé, au même niveau que executeTontineAutomations, pour le wiring setInterval de index.ts.
 */
export async function checkOverdueLoans() {
    logger.info('[Credit Risk] Vérification des prêts en retard...');
    try {
        await checkOverdueLoansRisk();
    } catch (e: any) {
        logger.error(`[Credit Risk Loans Error] ${e.message}`);
    }
}

/**
 * Même automation que checkOverdueLoans ci-dessus, pour les contrats BNPL (BnplContract) dont
 * la prochaine échéance (nextPaymentDate) est dépassée avec un solde restant dû.
 */
export async function checkOverdueBnpl() {
    logger.info('[Credit Risk] Vérification des contrats BNPL en retard...');
    try {
        await checkOverdueBnplContracts();
    } catch (e: any) {
        logger.error(`[Credit Risk BNPL Error] ${e.message}`);
    }
}

/**
 * Crée automatiquement une demande de déversement bancaire (MerchantPayoutRequest)
 * pour la totalité du solde de tout Grand Marchand ayant activé l'option T+1.
 */
export async function executeAutoSettlements() {
    logger.info('[Bank Settlements] Vérification des déversements automatiques (T+1)...');
    try {
        // Trouver tous les géants ayant activé l'option
        const giants = await prisma.user.findMany({
            where: { merchantTier: 'GIANT', autoSettlementEnabled: true, accountStatus: 'ACTIVE' },
            include: { wallet: true }
        });

        for (const giant of giants) {
            if (!giant.wallet || giant.wallet.balance <= 0) continue;

            const amount = giant.wallet.balance;

            // Éviter de créer une nouvelle demande s'il y a déjà une demande PENDING pour cet exact montant ou presque,
            // ou s'il y a trop de demandes en attente (on laisse l'admin traiter d'abord)
            const existingPending = await prisma.merchantPayoutRequest.findFirst({
                where: { merchantId: giant.id, status: 'PENDING' }
            });

            if (existingPending) {
                logger.info(`[Bank Settlements] Déversement ignoré pour ${giant.name} (demande PENDING existante).`);
                continue;
            }

            try {
                // On utilise la même logique que withdraw-to-agency : 
                // Créer la demande PayoutRequest. L'admin la validera dans admin-web.
                await prisma.merchantPayoutRequest.create({
                    data: {
                        merchantId: giant.id,
                        sourceAccount: 'SALES',
                        amount: amount,
                        note: `Virement Automatique T+1 vers IBAN: ${giant.iban} (SWIFT: ${giant.swift}) - ${giant.bankName}`,
                        status: 'PENDING',
                    }
                });

                // On ne débite PAS le wallet ici. Le débit réel (transaction ledger + wallet) 
                // se fera quand l'administrateur approuvera la demande via l'API admin (admin.merchants.ts).
                
                logger.info(`[Bank Settlements] Demande automatique créée pour ${giant.name} (${amount} FCFA).`);
            } catch (e: any) {
                logger.error(`[Bank Settlements] Échec demande automatique pour ${giant.name}: ${e.message}`);
            }
        }
    } catch (e: any) {
        logger.error(`[Bank Settlements Error] ${e.message}`);
    }
}

/**
 * Prélève automatiquement les taxes (expectedAmount) des petits marchands
 * vers leurs grands marchands affiliés s'ils ont activé l'option (autoPayEnabled).
 */
export async function executeAffiliationAutoPay() {
    logger.info('[Affiliations] Vérification des prélèvements automatiques de taxes...');
    
    // Import dynamique pour éviter les dépendances circulaires
    const { startOfMonthInTimezone, startOfWeekInTimezone } = require('./utils/timezone');
    const { executeTransfer } = require('./services/walletService'); // Supposant que c'est là, sinon on utilise transfert Prisma direct.
    
    try {
        const affiliations = await prisma.merchantAffiliation.findMany({
            where: {
                status: 'ACCEPTED',
                autoPayEnabled: true,
                expectedAmount: { gt: 0 },
                expectedFrequency: { not: null }
            },
            include: {
                merchant: { include: { wallet: true } },
                giant: { include: { wallet: true } }
            }
        });

        for (const aff of affiliations) {
            if (!aff.merchant.wallet || !aff.giant.wallet) continue;
            
            const timezone = 'Africa/Libreville'; // Fuseau horaire par défaut du système
            const windowStart = aff.expectedFrequency === 'WEEKLY'
                ? startOfWeekInTimezone(timezone)
                : startOfMonthInTimezone(timezone);

            // Vérifier s'il a DÉJÀ payé ce mois-ci/semaine-ci
            const recentPayment = await prisma.transaction.findFirst({
                where: {
                    senderWalletId: aff.merchant.wallet.id,
                    receiverWalletId: aff.giant.wallet.id,
                    status: 'COMPLETED',
                    createdAt: { gte: windowStart },
                },
            });

            if (recentPayment) continue; // Déjà payé

            const amount = aff.expectedAmount!;
            if (aff.merchant.wallet.balance < amount) {
                logger.warn(`[Affiliations] Échec prélèvement automatique: Solde insuffisant pour ${aff.merchant.phone} (${amount} FCFA attendus)`);
                continue; // Pas assez d'argent
            }

            try {
                // Débit du wallet du petit marchand et crédit du wallet du géant.
                // On utilise une transaction Prisma pour garantir l'atomicité.
                await prisma.$transaction(async (tx) => {
                    await tx.wallet.update({
                        where: { id: aff.merchant.wallet!.id },
                        data: { balance: { decrement: amount } }
                    });
                    await tx.wallet.update({
                        where: { id: aff.giant.wallet!.id },
                        data: { balance: { increment: amount } }
                    });
                    
                    const reference = `AUTOPAY-${aff.id.substring(0,8)}-${Date.now()}`;
                    await tx.transaction.create({
                        data: {
                            reference,
                            senderWalletId: aff.merchant.wallet!.id,
                            receiverWalletId: aff.giant.wallet!.id,
                            amount,
                            fee: 0,
                            type: 'TRANSFER',
                            status: 'COMPLETED',
                        }
                    });
                });

                logger.info(`[Affiliations] Prélèvement automatique réussi: ${amount} FCFA de ${aff.merchant.phone} vers ${aff.giant.name}.`);
            } catch (e: any) {
                logger.error(`[Affiliations] Erreur de transaction pour ${aff.merchant.phone}: ${e.message}`);
            }
        }
    } catch (e: any) {
        logger.error(`[Affiliations Error] ${e.message}`);
    }
}

export const initCronJobs = () => {
    logger.info('[CRON] Prêt — executeTontineAutomations/checkOverdueLoans/checkOverdueBnpl/executeAutoSettlements/executeAffiliationAutoPay sont déclenchés par les setInterval() de index.ts.');
};
