import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Crée le compte staff du Président (SUPER_ADMIN : toutes les permissions, dont le
// "👑 Dashboard Président" — supervision des grands commerçants, voir routes/admin.giants.ts).
// Le mot de passe est généré aléatoirement à chaque exécution et affiché UNE seule fois :
// il n'est jamais écrit dans le code ni dans le dépôt.
//
// Usage : npx ts-node scripts/create-president.ts [email] [nom] [téléphone]
// Sans téléphone, le compte ne peut pas se connecter (2FA SMS obligatoire, voir corp.ts
// /login) tant qu'un SUPER_ADMIN ne lui en a pas ajouté un.

const prisma = new PrismaClient();

async function main() {
    const email = process.argv[2] || 'president@mongain.com';
    const name = process.argv[3] || 'Président';
    const phone = process.argv[4] || null;

    const existing = await prisma.staff.findUnique({ where: { email } });
    if (existing) {
        console.log(`Le compte ${email} existe déjà (rôle ${existing.role}). Rien n'a été modifié.`);
        return;
    }

    const password = crypto.randomBytes(9).toString('base64url') + '!7a';
    const staff = await prisma.staff.create({
        data: {
            email,
            password: await bcrypt.hash(password, 10),
            name,
            role: 'SUPER_ADMIN',
            phone,
            status: 'ACTIVE',
            isActive: true,
            matricule: 'PDG-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
        },
    });

    console.log('✔ Compte Président créé');
    console.log(`  Email      : ${staff.email}`);
    console.log(`  Mot de passe : ${password}`);
    console.log(`  Matricule  : ${staff.matricule}`);
    console.log(`  Rôle       : ${staff.role}`);
    console.log(`  Téléphone  : ${staff.phone || '(aucun — à ajouter avant la première connexion)'}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
