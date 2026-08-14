import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    await prisma.tontineParticipant.deleteMany({});
    await prisma.tontineGroup.deleteMany({});
    console.log('Deleted successfully');
}
main().finally(() => prisma.$disconnect());
