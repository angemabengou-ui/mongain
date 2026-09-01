/**
 * Bootstrap Script — Initialiser la plateforme Mongain
 * Crée : Agence Principale (Siège/HQ), Comptes Système (Corporate, Passerelle, Coffre Tontine, etc.)
 * et les Paramètres Système s'ils n'existent pas encore.
 *
 * Usage: npx ts-node backend/scripts/bootstrap-platform.ts
 * Idempotent — peut être relancé sans dupliquer les données.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Démarrage du bootstrap de la plateforme Mongain...\n');

    // ─── 1. Paramètres Système ──────────────────────────────────────────
    const settingsCount = await prisma.systemSettings.count();
    if (settingsCount === 0) {
        await prisma.systemSettings.create({ data: {} });
        console.log('✅ Paramètres Système créés (valeurs par défaut)');
    } else {
        console.log('⏭️  Paramètres Système déjà présents');
    }

    // ─── 2. Agence Principale (Siège / HQ) ──────────────────────────────
    const hq = await prisma.branch.findFirst({ where: { isHQ: true } });
    if (!hq) {
        const hqWallet = await prisma.wallet.create({ data: { balance: 0, currency: 'FCFA' } });
        const newHQ = await prisma.branch.create({
            data: {
                code: 'MNG-HQ-001',
                name: 'Siège Social — Mongain',
                address: 'Libreville, Gabon',
                city: 'Libreville',
                region: 'Estuaire',
                isHQ: true,
                isActive: true,
                status: 'ACTIVE',
                activatedAt: new Date(),
                walletId: hqWallet.id,
            }
        });
        console.log(`✅ Agence Principale créée : ${newHQ.name} (ID: ${newHQ.id})`);
    } else {
        console.log(`⏭️  Agence Principale déjà présente : ${hq.name}`);
    }

    // ─── 3. Trésorerie Centrale ─────────────────────────────────────────
    const ct = await prisma.centralTreasury.findFirst();
    if (!ct) {
        const ctWallet = await prisma.wallet.create({ data: { balance: 0, currency: 'FCFA' } });
        await prisma.centralTreasury.create({ data: { name: 'Trésorerie Centrale Mongain', walletId: ctWallet.id } });
        console.log('✅ Trésorerie Centrale créée (solde 0 FCFA — à alimenter via Mint en Trésorerie)');
    } else {
        console.log('⏭️  Trésorerie Centrale déjà présente');
    }

    // ─── 4. Comptes Système (idempotent par kind) ────────────────────────
    const SYSTEM_ACCOUNTS = [
        { kind: 'CORPORATE', name: 'Corporate Mongain (Revenus & Frais)' },
        { kind: 'EXTERNAL_GATEWAY', name: 'Passerelle Externe (Mobile Money / MTN / AIRTEL)' },
        { kind: 'TONTINE_VAULT', name: 'Coffre Collectif Tontines' },
        { kind: 'SERVICE_PARTNER_SEEG', name: 'Partenaire SEEG Gabon (Électricité)' },
        { kind: 'SERVICE_PARTNER_CANAL', name: 'Partenaire Canal+ (Abonnements TV)' },
        { kind: 'SERVICE_PARTNER_TELECOM', name: 'Partenaire Télécom (Airtel/Moov Airtime)' },
    ] as const;

    for (const sa of SYSTEM_ACCOUNTS) {
        const existing = await prisma.systemAccount.findUnique({ where: { kind: sa.kind } });
        if (!existing) {
            const saWallet = await prisma.wallet.create({ data: { balance: 0, currency: 'FCFA' } });
            await prisma.systemAccount.create({
                data: { kind: sa.kind, name: sa.name, walletId: saWallet.id }
            });
            console.log(`  ✅ Compte Système créé : ${sa.name}`);
        } else {
            console.log(`  ⏭️  Compte Système déjà présent : ${sa.name}`);
        }
    }

    console.log('\n🎉 Bootstrap terminé avec succès !');
    console.log('\n📋 RÉSUMÉ DE LA PLATEFORME :');
    const [branchCount, saCount, ctNew] = await Promise.all([
        prisma.branch.count(),
        prisma.systemAccount.count(),
        prisma.centralTreasury.findFirst({ include: { wallet: true } }),
    ]);
    console.log(`   • Agences         : ${branchCount}`);
    console.log(`   • Comptes Système : ${saCount}`);
    console.log(`   • Trésorerie      : ${ctNew?.wallet?.balance?.toLocaleString('fr-FR')} FCFA`);
}

main()
    .catch(e => { console.error('❌ Erreur :', e.message); process.exit(1); })
    .finally(() => prisma.$disconnect());
