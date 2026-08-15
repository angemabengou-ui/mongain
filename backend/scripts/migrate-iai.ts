import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log("--- MIGRATION SCRIPT ---");

    // Find all B2C Users containing 'iai'
    const users = await prisma.user.findMany({
        where: { name: { contains: 'iai', mode: 'insensitive' } }
    });

    console.log(`Found ${users.length} misplaced B2C Users containing 'iai'`);

    for (const u of users) {
        if (u.role === 'AGENT' || u.role === 'MERCHANT') {
            console.log(`\nConverting misplaced entity: ${u.name} (Phone: ${u.phone})`);

            // Check if branch already exists
            const branchName = `Agence ${u.name.toUpperCase()}`;
            const exists = await prisma.branch.findFirst({ where: { name: branchName } });

            if (!exists) {
                await prisma.branch.create({
                    data: {
                        name: branchName,
                        city: 'Libreville',
                        isActive: true,
                        isHQ: false,
                        balance: 0
                    }
                });
                console.log(`-> SUCCESS: Created new physical Branch: ${branchName}`);
            } else {
                console.log(`-> SKIPPED: Branch ${branchName} already exists`);
            }

            // Suspend the faulty B2C profile to avoid duplicates
            await prisma.user.update({
                where: { id: u.id },
                data: { isActive: false, name: `${u.name} (ARCHIVÉ)` }
            });
            console.log(`-> SUCCESS: Suspended user profile ${u.name}`);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
