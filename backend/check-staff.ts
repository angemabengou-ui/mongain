import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const staff = await prisma.staff.findUnique({ where: { email: 'admin@mongain.com' } });
    console.log(staff);
}
main().catch(console.error).finally(() => prisma.$disconnect());
