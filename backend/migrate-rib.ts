import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function generateRIB() {
    return '1000100001' + (Math.floor(Math.random() * 90000000000) + 10000000000).toString() + (Math.floor(Math.random() * 90) + 10).toString();
}

async function main() {
    console.log(' Re-Migration vers le format RIB SANS ESPACES (pour zod compat)...');
    const users = await prisma.user.findMany();
    
    let count = 0;
    for (const u of users) {
        let unique = false;
        let accNum = '';
        while (!unique) {
            accNum = generateRIB();
            const exists = await prisma.user.findUnique({ where: { accountNumber: accNum } });
            if (!exists) unique = true;
        }
        await prisma.user.update({
            where: { id: u.id },
            data: { accountNumber: accNum }
        });
        count++;
    }
    console.log(` Re-Migration terminée : ${count} comptes mis à jour avec le nouveau RIB.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
