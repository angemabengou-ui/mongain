/**
 * Seed Script — Créer le compte Super Admin Mongain
 * 
 * Usage (sur Render Shell ou local) :
 *   npx ts-node backend/scripts/seed-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_PHONE = '+24100000000';
const ADMIN_PIN = '0000'; // ⚠️ Changez ce PIN depuis l'app après connexion !
const ADMIN_NAME = 'Super Admin Mongain';
const ADMIN_USERNAME = 'superadmin';

async function main() {
    console.log('🔄 Création du compte Super Admin...');

    const hashedPin = await bcrypt.hash(ADMIN_PIN, 10);

    const admin = await prisma.user.upsert({
        where: { phone: ADMIN_PHONE },
        update: {
            role: 'ADMIN',
            isActive: true,
            kycLevel: 2,
            kycStatus: 'APPROVED',
        },
        create: {
            phone: ADMIN_PHONE,
            name: ADMIN_NAME,
            username: ADMIN_USERNAME,
            pin: hashedPin,
            role: 'ADMIN',
            isActive: true,
            kycLevel: 2,
            kycStatus: 'APPROVED',
            wallet: {
                create: { balance: 0 }
            }
        },
        include: { wallet: true }
    });

    console.log('✅ Super Admin créé/mis à jour :');
    console.log(`   📱 Téléphone : ${admin.phone}`);
    console.log(`   👤 Nom       : ${admin.name}`);
    console.log(`   🔑 PIN       : ${ADMIN_PIN} (à changer !)`);
    console.log(`   👑 Rôle      : ${admin.role}`);
    console.log(`   💰 Wallet ID : ${admin.wallet?.id || 'Existant'}`);
}

main()
    .catch(e => { console.error('❌ Erreur :', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
