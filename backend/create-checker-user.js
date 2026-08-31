const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log("Démarrage création de l'utilisateur Staff Checker...");
    const password = 'Checker2026!';
    const hashedPassword = await bcrypt.hash(password, 10);

    const staff = await prisma.staff.upsert({
        where: { email: 'checker@mongain.com' },
        update: {
            password: hashedPassword,
            role: 'ADMIN',
            name: 'Validation (Checker)',
            mustChangePassword: false,
            isActive: true,
            status: 'ACTIVE'
        },
        create: {
            email: 'checker@mongain.com',
            phone: '+24177777777',
            name: 'Validation (Checker)',
            password: hashedPassword,
            role: 'ADMIN',
            mustChangePassword: false,
            isActive: true,
            status: 'ACTIVE'
        }
    });

    console.log("Utilisateur Staff créé avec succès en ligne:", staff.email);
}

main().catch(e => {
    console.error("ERRORED:", e);
}).finally(async () => {
    await prisma.$disconnect();
});
