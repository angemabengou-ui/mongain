import { prisma } from '../prisma';

// Import CSV du répertoire d'employés (voir routes/b2b.ts POST /employees/import, marchand
// mobile normal, et routes/merchant-portal.ts POST /employees/import, marchand géant portail
// web — les deux appellent cette MÊME fonction plutôt que de dupliquer le parsing). Format
// attendu : "nom,telephone", une ligne par employé, avec ou sans ligne d'en-tête. Un simple
// texte brut (pas un vrai upload multipart) suffit ici — cohérent avec le reste de ce
// backend, qui n'a pas d'infrastructure de fichiers.

// Volontairement permissif (chiffres, espaces, points, tirets, + optionnel en tête) : ce
// backend voit cohabiter plusieurs formats de saisie (+241..., 0..., avec espaces...) sur
// User.phone/MerchantEmployee.phone sans normalisation stricte imposée à la création — le but
// ici est seulement de distinguer "ressemble à un téléphone" de "ressemble à un nom", pas de
// valider un format E.164.
const PHONE_LIKE = /^\+?[0-9][0-9\s.-]{5,20}$/;

export interface CsvImportResult {
    created: number;
    skipped: number;
    errors: string[];
}

export async function importEmployeesFromCsv(merchantId: string, csv: string): Promise<CsvImportResult> {
    const rawLines = csv.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (rawLines.length === 0) {
        return { created: 0, skipped: 0, errors: ['Fichier CSV vide.'] };
    }

    // Détecte une ligne d'en-tête : si la 2e colonne de la toute première ligne ne ressemble
    // PAS à un numéro de téléphone (ex: "nom,telephone" ou "Nom,Téléphone"), on l'ignore comme
    // en-tête plutôt que de tenter de créer un employé "telephone" avec ce numéro invalide.
    const firstCols = rawLines[0].split(',').map((c) => c.trim());
    const hasHeader = firstCols.length < 2 || !PHONE_LIKE.test(firstCols[1].replace(/\s+/g, ''));
    const dataLines = hasHeader ? rawLines.slice(1) : rawLines;

    const errors: string[] = [];
    const valid: { name: string; phone: string }[] = [];

    dataLines.forEach((line, idx) => {
        // Numéro de ligne du FICHIER ORIGINAL (pas seulement des lignes de données) — plus
        // utile au marchand pour retrouver la ligne fautive dans son fichier source.
        const lineNumber = idx + 1 + (hasHeader ? 1 : 0);
        const cols = line.split(',').map((c) => c.trim());

        if (cols.length < 2 || !cols[0] || !cols[1]) {
            errors.push(`Ligne ${lineNumber} : format invalide (attendu "nom,telephone").`);
            return;
        }

        const [name, phoneRaw] = cols;
        const phone = phoneRaw.replace(/\s+/g, '');
        if (!PHONE_LIKE.test(phone)) {
            errors.push(`Ligne ${lineNumber} : numéro de téléphone invalide ("${phoneRaw}").`);
            return;
        }

        valid.push({ name, phone });
    });

    if (valid.length === 0) {
        return { created: 0, skipped: 0, errors };
    }

    // skipDuplicates : la contrainte @@unique([merchantId, phone]) (schema.prisma) gère la
    // déduplication elle-même, y compris entre deux lignes identiques DANS le même fichier
    // (une seule des deux est insérée) — pas besoin de dédupliquer `valid` nous-mêmes avant.
    const createResult = await prisma.merchantEmployee.createMany({
        data: valid.map((v) => ({ merchantId, name: v.name, phone: v.phone })),
        skipDuplicates: true,
    });

    return {
        created: createResult.count,
        skipped: valid.length - createResult.count,
        errors,
    };
}
