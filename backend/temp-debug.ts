import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({
        where: { name: 'AGENCEIAI' }
    });
    console.log("USER IN DB:", user);

    // Also verify what happens to the phone number when transformed
    const inputPhone = "+2410000001";
    const transformed = inputPhone.replace(/\s+/g, '').replace(/^\+2410/, '+241');
    console.log("TRANSFORMED PHONE FROM LOGIN ROUTE:", transformed);
}

main().catch(console.error).finally(() => prisma.$disconnect());
