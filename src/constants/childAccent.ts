// Accent visuel des écrans "Comptes Enfant" UNIQUEMENT — ne touche jamais theme.ts ni
// useAppTheme() : le genre de l'enfant n'a de sens que dans cette gestion parentale, jamais
// comme thème global de l'application (le compte enfant lui-même utilise le thème clair/sombre
// standard une fois connecté).
export const CHILD_ACCENT = {
    MALE: { color: '#2563FF', tint: '#2563FF15', label: 'Garçon' },
    FEMALE: { color: '#EC4899', tint: '#EC489915', label: 'Fille' },
    default: { color: '#7E3AF2', tint: '#7E3AF215', label: 'Enfant' },
} as const;

export function getChildAccent(gender?: string | null) {
    if (gender === 'MALE') return CHILD_ACCENT.MALE;
    if (gender === 'FEMALE') return CHILD_ACCENT.FEMALE;
    return CHILD_ACCENT.default;
}
