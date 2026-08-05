import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
    const hashedPin = await bcrypt.hash('0000', 10);
    await prisma.user.update({
        where: { phone: '+24100000000' },
        data: { pin: hashedPin }
    });
    console.log("Admin PIN reset to 0000");
}
main().finally(() => prisma.$disconnect());
