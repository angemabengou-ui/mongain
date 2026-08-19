import { prisma } from '../prisma';

// Journal technique persistant — sans ça, un échec (ex: PVit qui rejette une demande) n'était
// visible que dans les logs Render, que personne ne consulte au quotidien. L'admin-web lit
// cette table (page "Erreurs Système") pour que l'équipe voie les vrais échecs sans relayer
// des captures d'écran à chaque test.
export async function logError(
    source: string,
    message: string,
    details?: unknown,
    meta?: { userId?: string; path?: string }
) {
    try {
        const detailsStr = details == null ? null : (typeof details === 'string' ? details : JSON.stringify(details));
        await prisma.errorLog.create({
            data: {
                source,
                message: String(message).slice(0, 2000),
                details: detailsStr ? detailsStr.slice(0, 5000) : null,
                userId: meta?.userId,
                path: meta?.path,
            }
        });
    } catch (e) {
        // La journalisation elle-même ne doit jamais faire échouer l'opération réelle.
        console.error('Échec de journalisation d\'erreur:', e);
    }
}
