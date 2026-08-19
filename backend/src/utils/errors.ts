// Neon (PostgreSQL serverless) met son compute en veille après une période d'inactivité :
// le premier appel après une pause échoue avec "Can't reach database server" (P1001) le temps
// que le compute se réveille (1-3s). Sans ce helper, ce message technique brut — avec chemin de
// fichier interne et hostname de la base — remontait tel quel jusqu'à l'écran de connexion.
export function isDbConnectivityError(e: any): boolean {
    const code = e?.code || e?.errorCode;
    const msg = String(e?.message || '');
    return (
        code === 'P1001' || code === 'P1002' || code === 'P1008' || code === 'P1017' ||
        e?.name === 'PrismaClientInitializationError' ||
        msg.includes("Can't reach database server") ||
        msg.includes('Server has closed the connection')
    );
}

export function friendlyErrorMessage(e: any, fallback = 'Une erreur inattendue est survenue.'): string {
    if (isDbConnectivityError(e)) {
        return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques secondes.';
    }
    return e?.message || fallback;
}

// Un seul nouvel essai après une courte pause suffit à couvrir le réveil du compute Neon —
// à réserver aux lectures idempotentes (jamais après une écriture déjà partiellement appliquée).
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 1500): Promise<T> {
    let lastError: any;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e: any) {
            lastError = e;
            if (!isDbConnectivityError(e) || i === attempts - 1) throw e;
            await new Promise(r => setTimeout(r, delayMs));
        }
    }
    throw lastError;
}
