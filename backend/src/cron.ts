import cron from 'node-cron';
import { prisma } from './prisma';
import { getSystemSettings } from './routes/settings';
import { executeTontineCycle, notifyUpcomingCycle, resolveRenewalPoll } from './services/tontineService';
import { startOfDayInTimezone, startOfMonthInTimezone } from './utils/timezone';

export function initCronJobs() {
    // ─── Tontine : Tous les jours à minuit ─────────────────────────
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 Exécution CRON Tontine...');
        try {
            // isPaused: mise en pause admin (litige, enquête) — voir admin.tontines.ts,
            // POST /:id/pause. Le groupe garde intact currentCycle/lastPayoutDate pendant la
            // pause et reprend exactement où il en était à la levée.
            const activeGroups = await prisma.tontineGroup.findMany({ where: { status: 'ACTIVE', isPaused: false } });
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);

            for (const group of activeGroups) {
                try {
                    // Anti-crash : ne pas rejouer si déjà exécuté aujourd'hui
                    if (group.lastPayoutDate) {
                        const lastStr = group.lastPayoutDate.toISOString().slice(0, 10);
                        if (lastStr === todayStr) {
                            console.log(`⏭️ Cycle déjà exécuté aujourd'hui pour: ${group.name}`);
                            continue;
                        }
                    }

                    // Rattrapage réel : basé sur le temps écoulé depuis le DERNIER paiement
                    // effectif (ou la création du groupe s'il n'y en a jamais eu), pas sur un
                    // alignement calendaire fixe — un cycle manqué (serveur down) est donc
                    // rattrapé au prochain passage du CRON au lieu d'être purement et
                    // simplement perdu jusqu'au prochain multiple de `cycleDays`.
                    const referenceDate = group.lastPayoutDate || group.startDate;
                    const diffDays = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
                    const cycleDays = group.frequency === 'WEEKLY' ? 7 : 30;

                    // Rappel la veille (J-1) — best-effort, jamais bloquant : un rappel manqué
                    // (redémarrage serveur le jour précis, cron sauté) n'empêche jamais le
                    // prélèvement réel du lendemain, contrairement à l'exécution du cycle
                    // elle-même qui est rattrapée explicitement (voir plus bas).
                    if (diffDays === cycleDays - 1) {
                        try {
                            await notifyUpcomingCycle(group);
                        } catch (reminderError) {
                            console.error(`Erreur rappel Tontine pour ${group.name}:`, reminderError);
                        }
                    }

                    if (diffDays >= cycleDays) {
                        // Réclamation atomique AVANT exécution (et non après) : si deux
                        // instances du CRON se chevauchent (process orphelin survivant à un
                        // restart, par ex.), seule celle dont l'updateMany matche encore
                        // l'ancien lastPayoutDate gagne le droit d'exécuter le cycle — l'autre
                        // voit count=0 et passe son tour, au lieu de débiter/payer en double.
                        const claim = await prisma.tontineGroup.updateMany({
                            where: { id: group.id, lastPayoutDate: group.lastPayoutDate },
                            data: { lastPayoutDate: now }
                        });
                        if (claim.count === 0) {
                            console.log(`⏭️ Cycle déjà réclamé par une autre exécution pour: ${group.name}`);
                            continue;
                        }

                        console.log(`⏳ Déclenchement Tontine: ${group.name}`);
                        await executeTontineCycle(group.id);
                    }
                } catch (groupError) {
                    // Isolé par groupe : l'échec d'une tontine ne doit jamais empêcher le
                    // traitement des autres groupes du jour.
                    console.error(`Erreur CRON Tontine pour le groupe ${group.name} (${group.id}):`, groupError);
                }
            }

            // Sondages de relance (PENDING_RENEWAL, voir tontineService.ts executeTontineCycle
            // et resolveRenewalPoll) dont la date limite est dépassée — le silence des
            // participants qui n'ont pas voté est alors tranché comme un refus. Un groupe où
            // tout le monde a déjà voté est résolu immédiatement par POST /tontine/renewal-vote
            // sans attendre ce passage du CRON ; ceci ne rattrape que les votes incomplets.
            const expiredPolls = await prisma.tontineGroup.findMany({
                where: { status: 'PENDING_RENEWAL', renewalDeadline: { lte: now } }
            });
            for (const group of expiredPolls) {
                try {
                    console.log(`⏳ Sondage de relance expiré, résolution: ${group.name}`);
                    await resolveRenewalPoll(group.id);
                } catch (pollError) {
                    console.error(`Erreur résolution sondage de relance pour ${group.name} (${group.id}):`, pollError);
                }
            }

            console.log('✅ CRON Tontine terminé.');
        } catch (e) {
            console.error('Erreur CRON Tontine:', e);
        }
    });

    // ─── Remise à zéro des plafonds journaliers (Wallets) ──────────
    cron.schedule('1 0 * * *', async () => {
        console.log('🔄 CRON: Remise à zéro des dépenses journalières...');
        try {
            // Minuit dans le fuseau configuré (Africa/Libreville, UTC+1), pas minuit serveur
            // (UTC) — même correctif que merchant.ts (voir utils/timezone.ts), pour que ce
            // reset s'aligne sur la même frontière de journée que LimitEngine.
            const settings = await getSystemSettings();
            const todayStart = startOfDayInTimezone(settings?.timezone || 'Africa/Libreville');

            // Remettre à zéro uniquement les wallets dont le reset n'a pas encore eu lieu aujourd'hui
            await prisma.wallet.updateMany({
                where: { dailySpentResetAt: { lt: todayStart } },
                data: { dailySpent: 0, dailySpentResetAt: new Date() }
            });
            console.log('✅ CRON: Plafonds journaliers réinitialisés.');
        } catch (e) {
            console.error('Erreur CRON reset plafonds:', e);
        }
    });

    // ─── Remise à zéro des plafonds mensuels (Wallets) ─────────────
    // Miroir du CRON journalier ci-dessus : LimitEngine.verifyAndIncrementConsumption
    // réinitialise déjà monthlySpent au premier passage du mois (correctif du bug où la
    // mutation de `wallet` avant comparaison empêchait tout reset réel), mais un wallet
    // resté inactif pendant la bascule ne recevra sa remise à zéro qu'à sa prochaine
    // opération — ce CRON la rafraîchit proactivement pour tous, comme pour le journalier.
    cron.schedule('2 0 1 * *', async () => {
        console.log('🔄 CRON: Remise à zéro des dépenses mensuelles...');
        try {
            const monthlySettings = await getSystemSettings();
            const monthStart = startOfMonthInTimezone(monthlySettings?.timezone || 'Africa/Libreville');

            await prisma.wallet.updateMany({
                // monthlySpentResetAt est non-nullable (@default(now()) en base) : pas besoin
                // de gérer un cas null, contrairement à ce que suggérait LimitEngine.ts.
                where: { monthlySpentResetAt: { lt: monthStart } },
                data: { monthlySpent: 0, monthlySpentResetAt: new Date() }
            });
            console.log('✅ CRON: Plafonds mensuels réinitialisés.');
        } catch (e) {
            console.error('Erreur CRON reset plafonds mensuels:', e);
        }
    });

    console.log('⏳ Tâches planifiées (CRON) initialisées.');
}
