/**
 * Script de migration ponctuelle — Fusionne l'ancien compte Corporate
 * (+24100000000) vers le nouveau (+2410000000).
 *
 * Anciennement exposé comme route HTTP publique /api/merge-admins (faille
 * critique : accessible sans authentification). Convertit en script à
 * exécuter manuellement, une seule fois, par un opérateur ayant accès au
 * shell du serveur.
 *
 * Usage :
 *   npx ts-node backend/scripts/merge-admins.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const oldCorp = await prisma.user.findUnique({ where: { phone: '+24100000000' }, include: { wallet: true } });
    const newCorp = await prisma.user.findUnique({ where: { phone: '+2410000000' }, include: { wallet: true } });

    const actions: string[] = [];

    if (oldCorp && newCorp) {
        const oldBalance = oldCorp.wallet?.balance || 0;
        if (oldBalance > 0 && newCorp.wallet) {
            await prisma.wallet.update({
                where: { id: newCorp.wallet.id },
                data: { balance: { increment: oldBalance } }
            });
            actions.push(`Transféré ${oldBalance} FCFA vers le nouveau compte.`);
        }

        await prisma.user.update({
            where: { id: oldCorp.id },
            data: { phone: '+24100000000_ARCHIVED_' + Date.now(), role: 'USER', isActive: false }
        });
        actions.push('Ancien compte archivé et déchu.');

        if (oldCorp.wallet) {
            await prisma.wallet.update({ where: { id: oldCorp.wallet.id }, data: { balance: 0 } });
        }
    }

    console.log(JSON.stringify({ oldCorpExists: !!oldCorp, newCorpExists: !!newCorp, actions }, null, 2));
}

main().catch(e => { console.error('❌ Erreur :', e); process.exit(1); }).finally(() => prisma.$disconnect());
