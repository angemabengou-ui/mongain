import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
    const email = 'admin@mongain.com';
    const password = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const hashed = await bcrypt.hash(password, 10);
    
    const staff = await prisma.staff.upsert({
        where: { email },
        update: {
            password: hashed,
            role: 'SUPER_ADMIN',
            name: 'Super Admin Test',
            isActive: true
        },
        create: {
            email,
            password: hashed,
            role: 'SUPER_ADMIN',
            name: 'Super Admin Test',
        }
    });
    console.log(`✅ Compte Staff créé/mis à jour : ${staff.email}`);
    if (!process.env.SEED_ADMIN_PASSWORD) {
        console.log(`🔑 Mot de passe généré (à noter, non stocké) : ${password}`);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
