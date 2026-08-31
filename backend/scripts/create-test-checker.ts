import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log("Création du compte Checker (Validation Center) pour vos tests...");

    // 1. On crée le compte de validation
    const pwd = await bcrypt.hash('Checker2026!', 10);
    const existing = await prisma.staff.findUnique({ where: { email: 'checker@mongain.com' } });
    if (existing) {
        console.log("Le compte checker@mongain.com existe déjà ! Vous pouvez vous connecter avec.");
    } else {
        await prisma.staff.create({
            data: {
                email: 'checker@mongain.com',
                password: pwd,
                name: 'Audit Validation',
                role: 'COMPLIANCE_CHECKER',
                isActive: true,
                status: 'ACTIVE',
                matricule: 'CHK-TEST-001'
            }
        });
        console.log("✔ Compte de VALIDATION créé avec succès !");
        console.log("-> Login: checker@mongain.com");
        console.log("-> Mot de passe: Checker2026!");
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
