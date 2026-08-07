import cron from 'node-cron';
import { prisma } from './prisma';
import { executeTontineCycle } from './services/tontineService';

export function initCronJobs() {
    // ─── Tontine : Tous les jours à minuit ─────────────────────────
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 Exécution CRON Tontine...');
        try {
            const activeGroups = await prisma.tontineGroup.findMany({ where: { status: 'ACTIVE' } });
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);

            for (const group of activeGroups) {
                // Anti-crash : ne pas rejouer si déjà exécuté aujourd'hui
                if (group.lastPayoutDate) {
                    const lastStr = group.lastPayoutDate.toISOString().slice(0, 10);
                    if (lastStr === todayStr) {
                        console.log(`⏭️ Cycle déjà exécuté aujourd'hui pour: ${group.name}`);
                        continue;
                    }
                }

                const diffTime = Math.abs(now.getTime() - group.startDate.getTime());
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const cycleDays = group.frequency === 'WEEKLY' ? 7 : 30;

                if (diffDays > 0 && diffDays % cycleDays === 0) {
                    console.log(`⏳ Déclenchement Tontine: ${group.name}`);
                    await executeTontineCycle(group.id);
                    // Marquer comme exécuté aujourd'hui
                    await prisma.tontineGroup.update({
                        where: { id: group.id },
                        data: { lastPayoutDate: now }
                    });
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
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

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

    console.log('⏳ Tâches planifiées (CRON) initialisées.');
}
