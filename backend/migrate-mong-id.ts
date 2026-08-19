import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function generateAccountNumber() {
    return 'MG-' + Math.floor(10000000 + Math.random() * 90000000).toString(); // MG-12345678
}

async function main() {
    console.log(' Démarrage de la migration MONG-ID...');
    const users = await prisma.user.findMany({ where: { accountNumber: null } });
    
    let count = 0;
    for (const u of users) {
        let unique = false;
        let accNum = '';
        while (!unique) {
            accNum = generateAccountNumber();
            const exists = await prisma.user.findUnique({ where: { accountNumber: accNum } });
            if (!exists) unique = true;
        }
        await prisma.user.update({
            where: { id: u.id },
            data: { accountNumber: accNum }
        });
        count++;
    }
    console.log(` Migration terminée : ${count} comptes mis à jour.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
