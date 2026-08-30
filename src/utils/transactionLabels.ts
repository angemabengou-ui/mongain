import { Transaction } from '../services/api';

// Seule source de vérité pour "à quoi correspond cette transaction ?", dérivée du préfixe de
// reference — utilisée à la fois par l'historique (par transaction) et par l'aperçu des
// dépenses (regroupement par catégorie). Une seconde copie de cette logique ailleurs
// finirait tôt ou tard par diverger (même écueil que la RBAC dupliquée front/back
// rencontrée ailleurs dans cette app) : n'importe quel nouveau préfixe de référence
// (ex : un futur rail de paiement) ne doit être ajouté qu'ICI.
export type TransactionCategory = 'TRANSFER' | 'VAULT' | 'TONTINE' | 'FEE' | 'MERCHANT' | 'SERVICE';

function getServiceTitle(ref: string): string {
    if (ref.includes('ELECTRICITY')) return 'Facture Électricité';
    if (ref.includes('WATER')) return 'Facture Eau';
    if (ref.includes('AIRTIME')) return 'Crédit téléphonique';
    if (ref.includes('TV')) return 'Abonnement TV';
    return 'Paiement de service';
}

// Sans ce libellé dérivé de la référence, un dépôt de caisse commune, une cotisation de
// tontine ou un reversement marchand apparaissaient tous comme un "Transfert" générique
// identique à un vrai transfert P2P — impossible de distinguer, dans son propre historique,
// pourquoi une somme précise est sortie ou entrée sans aller rouvrir chaque module séparément.
export function getTransactionTitle(tx: Pick<Transaction, 'reference' | 'type'>): string {
    const ref: string = tx.reference || '';
    if (ref.startsWith('VAULT_DEP_')) return 'Dépôt Caisse Commune';
    if (ref.startsWith('VAULT_OUT_')) return 'Retrait Caisse Commune';
    if (ref.startsWith('VAULT_VOUCHER_')) return 'Bon Caisse Commune dépensé';
    if (ref.startsWith('TONT_DBT_')) return 'Cotisation Tontine';
    if (ref.startsWith('TONT_PAY_')) return 'Cagnotte Tontine reçue';
    if (ref.startsWith('TONT_EXIT_')) return 'Règlement dette Tontine';
    if (ref.startsWith('MPAYOUT-')) return 'Reversement marchand';
    if (ref.startsWith('FEE')) return 'Frais de service';
    if (ref.startsWith('SERVICE-')) return getServiceTitle(ref);
    return tx.type === 'outgoing' ? 'Transfert envoyé' : 'Transfert reçu';
}

export function getTransactionCategory(tx: Pick<Transaction, 'reference' | 'type'>): TransactionCategory {
    const ref: string = tx.reference || '';
    if (ref.startsWith('VAULT_')) return 'VAULT';
    if (ref.startsWith('TONT_')) return 'TONTINE';
    if (ref.startsWith('FEE')) return 'FEE';
    if (ref.startsWith('MPAYOUT-')) return 'MERCHANT';
    if (ref.startsWith('SERVICE-')) return 'SERVICE';
    return 'TRANSFER';
}

export const CATEGORY_INFO: Record<TransactionCategory, { label: string; icon: string; color: string }> = {
    TRANSFER: { label: 'Transferts', icon: 'swap-horizontal', color: '#3B82F6' },
    VAULT: { label: 'Caisse Commune', icon: 'shield-checkmark', color: '#059669' },
    TONTINE: { label: 'Tontine', icon: 'sync', color: '#7C3AED' },
    FEE: { label: 'Frais', icon: 'receipt', color: '#F59E0B' },
    MERCHANT: { label: 'Marchands', icon: 'storefront', color: '#DB2777' },
    SERVICE: { label: 'Factures & Services', icon: 'flash', color: '#0EA5E9' },
};
