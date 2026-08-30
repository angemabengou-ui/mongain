// Emplacement réservé pour un futur prestataire externe de vérification d'identité / détection
// de fraude (ex : Smile Identity, Onfido, Sumsub — courants sur les marchés où opère Mongain).
// Décision explicite (utilisateur) : préparer le terrain côté code, SANS intégrer de vrai
// prestataire ni engager de coût — l'intégration réelle est un choix de fournisseur/budget qui
// n'a pas encore été fait. Tant que KYC_VENDOR_API_KEY n'est pas défini, runKycVendorCheck()
// est un pur no-op (aucun appel réseau, aucune dépendance ajoutée) : il ne fait que renvoyer un
// statut neutre, immédiatement.
//
// Ce résultat est purement informatif : il ne bloque et ne conditionne jamais la décision KYC
// elle-même, qui reste une décision humaine (voir admin.ts, PUT /users/:id/kyc, gatée par
// perm_customer_kyc_validate). Le jour où un vrai prestataire est choisi, seul le corps de la
// branche `if (apiKey)` ci-dessous doit changer — le contrat (KycVendorCheckResult) et tous ses
// appelants restent inchangés.

export type KycVendorCheckStatus = 'NOT_CONFIGURED' | 'PASS' | 'FAIL' | 'REVIEW';

export interface KycVendorCheckResult {
    provider: string | null;
    status: KycVendorCheckStatus;
    checkedAt: Date;
}

export async function runKycVendorCheck(user: { id: string; idCardFront?: string | null; idCardBack?: string | null; selfie?: string | null }): Promise<KycVendorCheckResult> {
    const apiKey = process.env.KYC_VENDOR_API_KEY;

    if (!apiKey) {
        return { provider: null, status: 'NOT_CONFIGURED', checkedAt: new Date() };
    }

    // Aucun prestataire réel intégré à ce jour — voir le commentaire d'en-tête. Si
    // KYC_VENDOR_API_KEY est un jour défini sans que cette branche ait été implémentée, on
    // reste volontairement en NOT_CONFIGURED plutôt que de prétendre à tort qu'une
    // vérification a eu lieu.
    return { provider: null, status: 'NOT_CONFIGURED', checkedAt: new Date() };
}
