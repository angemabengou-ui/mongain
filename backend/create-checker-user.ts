import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
    const password = 'Checker2026!';
    const pin = '1234';
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(pin, 10);

    const user = await prisma.user.upsert({
        where: { email: 'checker@mongain.com' },
        update: {
            password: hashedPassword,
            pin: hashedPin,
            role: 'ADMIN',
            name: 'Validation (Checker)'
        },
        create: {
            email: 'checker@mongain.com',
            phone: '+24177777777',
            name: 'Validation (Checker)',
            password: hashedPassword,
            pin: hashedPin,
            role: 'ADMIN',
            kycStatus: 'VERIFIED',
            kycLevel: 'TIER_2',
            accountNumber: 'CHECKER77',
            wallet: {
                create: { balance: 0, currency: 'FCFA' }
            }
        }
    });
    console.log('Utilisateur cree avec succes en ligne:', user.email);
}
main().catch(console.error).finally(() => prisma.$disconnect());
