import { prisma } from './prisma';
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

export const initCronJobs = () => {
    logger.info('[CRON] Prêt — executeTontineAutomations est déclenché par le setInterval(24h) de index.ts.');
};
