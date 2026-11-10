// FCFA n'a pas de sous-unité : on arrondit systématiquement et on n'affiche/n'envoie jamais
// de décimales, quelle que soit la source (API, saisie utilisateur).
export function fmtFCFA(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '0 FCFA';
    return `${Math.round(num).toLocaleString('fr-FR')} FCFA`;
}

export function fmtNumber(value: unknown): string {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '0';
    return Math.round(num).toLocaleString('fr-FR');
}

// Arrondit un montant saisi par l'utilisateur vers un entier FCFA valide, ou null si invalide.
export function parseAmountInput(raw: string): number | null {
    const cleaned = raw.replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const num = Math.round(Number(cleaned));
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
}

// Retourne la première valeur numérique définie parmi une liste de clés candidates — utile
// pour lire défensivement un objet dont la forme exacte côté API n'est pas garantie.
export function pickNumber(obj: Record<string, any> | null | undefined, keys: string[]): number | undefined {
    if (!obj) return undefined;
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    }
    return undefined;
}

// Comme pickNumber, mais distingue explicitement `null` (valeur significative : "réglage
// désactivé", ex. portalApprovalThreshold) de l'absence du champ (repli également sur null,
// puisqu'un champ manquant se comporte comme désactivé côté serveur). pickNumber ne convient
// pas ici : il traite toujours `null` comme "pas un nombre" et ne permettrait donc jamais de
// distinguer "0/désactivé" d'un champ simplement absent — sans conséquence pour un montant de
// transaction (toujours attendu), mais significatif pour un réglage optionnel.
export function pickNullableNumber(obj: Record<string, any> | null | undefined, keys: string[]): number | null {
    if (!obj) return null;
    for (const key of keys) {
        if (!(key in obj)) continue;
        const v = obj[key];
        if (v === null) return null;
        if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
        if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.round(Number(v));
    }
    return null;
}

export function pickString(obj: Record<string, any> | null | undefined, keys: string[]): string | undefined {
    if (!obj) return undefined;
    for (const key of keys) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim() !== '') return v;
    }
    return undefined;
}
