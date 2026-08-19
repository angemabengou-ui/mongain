import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
    const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const hashed = await bcrypt.hash(password, 10);

    const staff = await prisma.staff.upsert({
        where: { email: 'admin@mongain.com' },
        update: {
            password: hashed,
            role: 'SUPER_ADMIN',
            name: 'Super Admin Test',
            isActive: true,
            status: 'APPROVED'
        },
        create: {
            email: 'admin@mongain.com',
            password: hashed,
            role: 'SUPER_ADMIN',
            name: 'Super Admin Test',
            isActive: true,
            status: 'APPROVED'
        }
    });
    console.log('✅ Admin activé:', staff.email, '| isActive:', staff.isActive, '| status:', staff.status);
    if (!process.env.SEED_ADMIN_PASSWORD) {
        console.log(`🔑 Mot de passe généré (à noter, non stocké) : ${password}`);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
