/**
 * Script de migration ponctuelle — bascule les comptes techniques legacy
 * (User{role:"ADMIN"} identifiés par un numéro de téléphone en dur) vers la
 * table dédiée SystemAccount (voir prisma/schema.prisma, migration
 * 20260830000000_system_accounts).
 *
 * Pour chaque compte connu :
 *   - S'il existe déjà en SystemAccount : rien à faire (idempotent, ré-exécutable).
 *   - Sinon, si un User legacy existe à l'ancien téléphone : le SystemAccount créé
 *     réutilise SON wallet existant (solde + historique de transactions préservés
 *     tels quels), le wallet est détaché de ce User (userId -> null, pour qu'il ne
 *     compte plus comme un wallet "client" dans les agrégats), puis le User legacy
 *     est archivé (téléphone suffixé, désactivé) plutôt que supprimé — pour ne pas
 *     casser attachAuditActors() (admin.ts) si un AuditLog historique le référence
 *     comme acteur. Même pattern que merge-admins.ts.
 *   - Sinon (compte jamais encore utilisé), il est créé à froid via getSystemAccount.
 *
 * Usage (une fois, après avoir appliqué la migration Prisma) :
 *   npx ts-node backend/scripts/backfill-system-accounts.ts
 */
import { PrismaClient } from '@prisma/client';
import { getSystemAccount, SystemAccountKind } from '../src/services/systemAccounts';

const prisma = new PrismaClient();

const LEGACY_ACCOUNTS: { kind: SystemAccountKind; legacyPhone: string; name: string }[] = [
    { kind: 'CORPORATE', legacyPhone: process.env.CORPORATE_PHONE || '+2410000000', name: 'COMPTE CORPORATE (REVENUS)' },
    { kind: 'EXTERNAL_GATEWAY', legacyPhone: '+24133333333', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)' },
    { kind: 'TONTINE_VAULT', legacyPhone: '+24155555555', name: 'COFFRE TONTINE (SYSTEME)' },
    { kind: 'SERVICE_PARTNER_SEEG', legacyPhone: '+24188888888', name: 'SERVICE PARTENAIRE - SEEG' },
    { kind: 'SERVICE_PARTNER_CANAL', legacyPhone: '+24177777777', name: 'SERVICE PARTENAIRE - CANAL' },
    { kind: 'SERVICE_PARTNER_TELECOM', legacyPhone: '+24166666666', name: 'SERVICE PARTENAIRE - TELECOM' },
];

async function main() {
    const results: string[] = [];

    for (const { kind, legacyPhone, name } of LEGACY_ACCOUNTS) {
        const already = await prisma.systemAccount.findUnique({ where: { kind } });
        if (already) {
            results.push(`${kind} : déjà migré, ignoré.`);
            continue;
        }

        const legacyUser = await prisma.user.findUnique({ where: { phone: legacyPhone }, include: { wallet: true } });

        if (legacyUser && legacyUser.wallet) {
            await prisma.$transaction(async (tx) => {
                await tx.systemAccount.create({
                    data: { kind, name, walletId: legacyUser.wallet!.id }
                });
                await tx.wallet.update({ where: { id: legacyUser.wallet!.id }, data: { userId: null } });
                await tx.user.update({
                    where: { id: legacyUser.id },
                    data: { phone: `${legacyPhone}_ARCHIVED_${Date.now()}`, role: 'USER', isActive: false }
                });
            });
            results.push(`${kind} : migré depuis l'ancien compte ${legacyPhone} (solde ${legacyUser.wallet.balance} FCFA préservé), ancien User archivé.`);
        } else {
            await getSystemAccount(kind);
            results.push(`${kind} : aucun compte legacy trouvé, créé à froid.`);
        }
    }

    console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error('❌ Erreur :', e); process.exit(1); }).finally(() => prisma.$disconnect());
