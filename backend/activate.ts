import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    console.log("Activating admin...");
    const staff = await prisma.staff.update({
        where: { email: 'admin@mongain.com' },
        data: { isActive: true, status: 'APPROVED' }
    });
    console.log("Admin activated:", staff.email, staff.isActive, staff.status);
}
main().catch(console.error).finally(() => prisma.$disconnect());
