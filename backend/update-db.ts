import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log("Bcrypt loaded, hashing PIN...");
    const hashedPin = await bcrypt.hash('1234', 10);

    let user = await prisma.user.findFirst({
        where: { name: 'AGENCEIAI' }
    });

    if (user) {
        // Un-scramble if they managed to delete it
        user = await prisma.user.update({
            where: { id: user.id },
            data: {
                username: 'agenceiai', // Safe to type
                phone: '+24177000001', // Removed the erroneous zero
                pin: hashedPin,
                isActive: true,
                failedPinAttempts: 0,
                lockedUntil: null
            }
        });
        console.log("USER UPDATED SUCCESSFULLY.");
        console.log(`Phone: ${user.phone}`);
        console.log(`Username: ${user.username}`);
        console.log(`PIN: 1234`);
    } else {
        console.log("USER NOT FOUND. Attempting to find by ANY similar name...");
        const users = await prisma.user.findMany();
        console.log(users.map(u => u.name));
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
