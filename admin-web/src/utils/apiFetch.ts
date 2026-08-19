// Fetch JSON avec gestion robuste des réponses vides/tronquées (ex: redémarrage du
// serveur en plein milieu d'une requête) — au lieu de laisser resp.json() planter avec
// un message technique illisible ("JSON.parse: unexpected end of data..."), on renvoie
// un message clair et récupérable.
export async function apiFetch(url: string, options?: RequestInit) {
    let resp: Response;
    try {
        resp = await fetch(url, options);
    } catch {
        throw new Error('Connexion au serveur impossible. Vérifiez votre réseau et réessayez.');
    }

    const text = await resp.text();
    let data: any = {};
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Réponse invalide du serveur (connexion interrompue). Réessayez.');
        }
    }

    if (!resp.ok) throw new Error(data.error || `Erreur serveur (${resp.status}).`);
    return data;
}
