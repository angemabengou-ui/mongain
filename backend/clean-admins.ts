import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const oldCorp = await prisma.user.findUnique({ where: { phone: '+24100000000' }, include: { wallet: true } });
    const newCorp = await prisma.user.findUnique({ where: { phone: '+2410000000' }, include: { wallet: true } });

    if (oldCorp && newCorp) {
        console.log('Merging old corporate account into the new normalized one...');

        // 1. If old corp has balance, add it to new corp
        const oldBalance = oldCorp.wallet?.balance || 0;
        if (oldBalance > 0 && newCorp.wallet) {
            await prisma.wallet.update({
                where: { id: newCorp.wallet.id },
                data: { balance: { increment: oldBalance } }
            });
            console.log(`Transferred ${oldBalance} FCFA from old to new.`);
        }

        // 2. Reassign any relations if standard Prisma allows, or just delete old corp since it's an admin shell
        // Wait, standard delete might fail if there are transactions linked to oldCorp's wallet.
        // Let's just archive the old one instead of deleting it to avoid Prisma foreign key failures on transactions.

        await prisma.user.update({
            where: { id: oldCorp.id },
            data: {
                phone: '+24100000000_ARCHIVED_' + Date.now(),
                role: 'USER', // Demote
                isActive: false
            }
        });

        // Ensure newCorp has the money
        if (oldCorp.wallet) {
            await prisma.wallet.update({
                where: { id: oldCorp.wallet.id },
                data: { balance: 0 }
            });
        }

        console.log('Old account archived successfully. Only +2410000000 remains active as ADMIN.');
    } else {
        console.log('Duplicate accounts not found simultaneously.');
        if (oldCorp) console.log('Only old corp exists.');
        if (newCorp) console.log('Only new corp exists.');
    }
}

main()
    .catch(e => { console.error('Error:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
