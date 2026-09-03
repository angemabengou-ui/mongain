import { prisma } from '../prisma';

// Définitions des comptes techniques connus — nom affiché + solde initial à la création.
// Remplace 8 copies dispersées de la même logique "find-or-create par téléphone en dur"
// (wallet.ts x4, tontineService.ts, services.ts x2, index.ts), chacune avec son propre PIN
// factice (parfois même en clair) sur un compte qui ne se connecte jamais. `EXTERNAL_GATEWAY`
// démarre pré-provisionnée (simule un agrégateur externe déjà approvisionné), les autres à 0.
const SYSTEM_ACCOUNT_DEFS = {
    CORPORATE: { name: 'COMPTE CORPORATE (REVENUS)', initialBalance: 0 },
    EXTERNAL_GATEWAY: { name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)', initialBalance: 999999999 },
    TONTINE_VAULT: { name: 'COFFRE TONTINE (SYSTEME)', initialBalance: 0 },
    SERVICE_PARTNER_SEEG: { name: 'SERVICE PARTENAIRE - SEEG', initialBalance: 0 },
    SERVICE_PARTNER_CANAL: { name: 'SERVICE PARTENAIRE - CANAL', initialBalance: 0 },
    SERVICE_PARTNER_TELECOM: { name: 'SERVICE PARTENAIRE - TELECOM', initialBalance: 0 },
    // market.ts avait sa propre fonction locale getEscrowWallet() dupliquant exactement ce
    // même pattern find-or-create ; même clé `kind` ('MARKET_ESCROW') donc aucune migration
    // de données nécessaire, juste la même ligne SystemAccount retrouvée par upsert.
    MARKET_ESCROW: { name: 'RÉSERVE ESCROW MARKETPLACE', initialBalance: 0 },
} as const;

export type SystemAccountKind = keyof typeof SYSTEM_ACCOUNT_DEFS;

// `client` accepte soit le PrismaClient racine, soit un client de transaction (`tx`) — dans
// ce second cas, la création fait partie de la transaction appelante (rollback inclus en cas
// d'échec plus loin), comme getOrCreateCorporateWallet(tx) auparavant. `upsert` par `kind`
// (contrainte unique) élimine la fenêtre de course qu'avait le pattern find-then-create
// précédent (deux tout premiers appels concurrents pouvaient chacun créer leur propre ligne
// avant qu'aucun n'ait commité) : le second appel concurrent échoue proprement sur la
// contrainte unique plutôt que de dupliquer le compte.
export async function getSystemAccount(kind: SystemAccountKind, client: any = prisma) {
    const def = SYSTEM_ACCOUNT_DEFS[kind];
    return client.systemAccount.upsert({
        where: { kind },
        update: {},
        create: {
            kind,
            name: def.name,
            wallet: { create: { balance: def.initialBalance, currency: 'FCFA' } }
        },
        include: { wallet: true }
    });
}
