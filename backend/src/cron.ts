import cron from 'node-cron';
import { prisma } from './prisma';
import { executeTontineCycle } from './services/tontineService';

export function initCronJobs() {
    // Tous les jours à minuit
    cron.schedule('0 0 * * *', async () => {
        console.log('🔄 Exécution CRON: Vérification des Tontines...');
        try {
            const activeGroups = await prisma.tontineGroup.findMany({ where: { status: 'ACTIVE' } });
            const now = new Date();

            for (const group of activeGroups) {
                const diffTime = Math.abs(now.getTime() - group.startDate.getTime());
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                const cycleDays = group.frequency === 'WEEKLY' ? 7 : 30;

                // Simple check for MVP : Every 7 or 30 days
                if (diffDays > 0 && diffDays % cycleDays === 0) {
                    console.log(`⏳ Déclenchement automatique Tontine: ${group.name}`);
                    await executeTontineCycle(group.id);
                }
            }
            console.log('✅ Vérification quotidienne terminée.');
        } catch (e) {
            console.error('Erreur CRON:', e);
        }
    });
    console.log('⏳ Tâches planifiées (CRON) initialisées.');
}
