import { API_URL } from './config';

// Clés de storage du Portail Marchand Géant — DÉLIBÉRÉMENT différentes de celles utilisées
// par admin-web (qui stocke son token dans sessionStorage sous la clé `admin_token`, voir
// admin-web/src/utils/apiClient.ts). Les deux applications peuvent donc tourner dans le
// même navigateur (même poste, deux onglets) sans jamais se marcher dessus.
const TOKEN_KEY = 'merchant_portal_token';
const REFRESH_TOKEN_KEY = 'merchant_portal_refresh_token';
const USER_KEY = 'merchant_portal_user';

// Forme du user pas garantie à 100% (backend en cours de développement en parallèle) —
// on ne dépend que de ce qui est nécessaire à l'affichage, tout le reste est optionnel.
export type PortalUser = {
    id?: string;
    name?: string;
    businessName?: string;
    phone?: string;
    merchantTier?: string;
    // Ajouté par la capacité "membres d'équipe" (agent backend, en parallèle) : le géant
    // lui-même n'a jamais ce champ dans la réponse verify-otp (undefined), seuls les membres
    // invités en ont un. isPortalViewer() ci-dessous traite donc "absent" comme "pas VIEWER"
    // (= accès complet), ce qui correspond bien au compte géant.
    role?: 'ADMIN' | 'VIEWER';
    [key: string]: unknown;
};

export function getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getStoredUser(): PortalUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// true seulement pour un membre d'équipe explicitement 'VIEWER' — le géant lui-même (role
// absent) et un membre 'ADMIN' ont les pleins droits. Utilisé partout dans l'UI pour masquer
// (jamais juste désactiver) les actions d'écriture que le serveur refuserait de toute façon en
// 403 : POST/PATCH/DELETE sur /team, /affiliations, /payouts, /withdraw-to-agency, /employees.
export function isPortalViewer(): boolean {
    return getStoredUser()?.role === 'VIEWER';
}

export function saveSession(token: string, refreshToken?: string, user?: PortalUser) {
    localStorage.setItem(TOKEN_KEY, token);
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Purge la session locale. Émet aussi un évènement global : App.tsx l'écoute pour renvoyer
// immédiatement vers l'écran de connexion quel que soit l'écran actif au moment où le
// rafraîchissement de session échoue (voir apiRequest ci-dessous) — sans ça, un écran profond
// (ex: Affiliations) resterait affiché avec un token mort tant que l'utilisateur ne clique pas
// lui-même sur Déconnexion.
export function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('merchant-portal-session-cleared'));
}

// Lecture "sûre" d'une réponse HTTP : le corps peut être vide ou tronqué (coupure réseau,
// redéploiement serveur en plein milieu d'une requête) — on évite de laisser resp.json()
// planter avec un message technique illisible. Même pattern que
// admin-web/src/utils/apiFetch.ts, pour rester cohérent avec le reste de l'écosystème.
async function safeParse(resp: Response): Promise<any> {
    const text = await resp.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Réponse invalide du serveur (connexion interrompue). Réessayez.');
    }
}

let refreshInFlight: Promise<boolean> | null = null;

// Tente un rafraîchissement via POST /auth/refresh. Mutualisé (une seule requête de
// rafraîchissement en vol) : si plusieurs appels API partent en parallèle (ex: Dashboard qui
// charge les stats pendant que la sidebar vérifie autre chose) et expirent tous en même temps,
// un seul appel réseau de rafraîchissement est émis, les autres attendent son résultat.
async function tryRefreshSession(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        const refreshToken = getRefreshToken();
        if (!refreshToken) return false;
        try {
            const resp = await fetch(`${API_URL}/api/merchant-portal/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });
            if (!resp.ok) return false;
            const data = await safeParse(resp);
            if (!data.token) return false;
            localStorage.setItem(TOKEN_KEY, data.token);
            if (data.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
            return true;
        } catch {
            return false;
        }
    })();
    const result = await refreshInFlight;
    refreshInFlight = null;
    return result;
}

export class SessionExpiredError extends Error {
    constructor() {
        super('Votre session a expiré. Veuillez vous reconnecter.');
        this.name = 'SessionExpiredError';
    }
}

// Wrapper fetch central du portail :
// - Préfixe l'URL avec API_URL et ajoute le Content-Type JSON par défaut.
// - Attache automatiquement le Bearer token (sauf options.auth === false, pour /auth/login
//   et /auth/verify-otp qui n'ont pas encore de token).
// - Sur un 401 : tente UNE fois un rafraîchissement de session puis rejoue la requête ; si le
//   rafraîchissement échoue (refresh token absent/expiré), purge la session et lève
//   SessionExpiredError (App.tsx renvoie alors vers l'écran de connexion).
// - Normalise les erreurs réseau et HTTP en Error(message) lisible pour l'utilisateur final.
export async function apiRequest(path: string, options: RequestInit = {}, config: { auth?: boolean } = {}): Promise<any> {
    const auth = config.auth !== false;

    const doFetch = async (): Promise<Response> => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) };
        if (auth) {
            const token = getToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
        }
        try {
            return await fetch(`${API_URL}${path}`, { ...options, headers });
        } catch {
            throw new Error('Connexion au serveur impossible. Vérifiez votre réseau et réessayez.');
        }
    };

    let resp = await doFetch();

    if (resp.status === 401 && auth) {
        const refreshed = await tryRefreshSession();
        if (refreshed) {
            resp = await doFetch();
        } else {
            clearSession();
            throw new SessionExpiredError();
        }
    }

    const data = await safeParse(resp);
    if (!resp.ok) {
        throw new Error(data.error || `Erreur serveur (${resp.status}).`);
    }
    return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints — vérifiés directement contre backend/src/routes/merchant-portal.ts (lu, jamais
// modifié : ce fichier appartient à l'agent backend qui travaille en parallèle). Toutes les
// routes ci-dessous existent réellement à date ; les commentaires notent les quelques points
// de forme qui ont une incidence sur l'UI.
// ─────────────────────────────────────────────────────────────────────────────
export const ENDPOINTS = {
    login: '/api/merchant-portal/auth/login',
    verifyOtp: '/api/merchant-portal/auth/verify-otp',
    refresh: '/api/merchant-portal/auth/refresh',
    logout: '/api/merchant-portal/auth/logout',
    dashboard: '/api/merchant-portal/dashboard',
    reports: (period: 'day' | 'month') => `/api/merchant-portal/reports?period=${period}`,
    affiliations: '/api/merchant-portal/affiliations',
    affiliationById: (id: string) => `/api/merchant-portal/affiliations/${id}`,
    affiliationCompliance: (id: string) => `/api/merchant-portal/affiliations/${id}/compliance`,

    // POST /api/merchant-portal/payouts — réutilise runMassPayout() (factorée hors de
    // routes/b2b.ts). Body : { name, entries: [{phone, amount}], pin, idempotencyKey }.
    // Réponse 202 : { success, message, bulkId } — traitement asynchrone (processBulkAsync),
    // PAS le lot complet avec le statut par bénéficiaire. Il n'existe PAS de route GET pour
    // lister ces lots sous ce namespace (seul /api/b2b/payouts GET existe, protégé par
    // authMiddleware classique — un token portail, qui ne porte pas de `jwtVersion`, n'y
    // passerait pas) : voir EmployeePayouts.tsx qui journalise donc localement les envois de
    // la session plutôt que d'interroger un historique serveur.
    employeePayouts: '/api/merchant-portal/payouts',

    // POST/GET /api/merchant-portal/withdraw-to-agency — réutilise createMerchantPayoutRequest()
    // (factorée hors de routes/b2b.ts). Ce n'est PAS un code de retrait instantané : ça crée une
    // MerchantPayoutRequest au statut PENDING, exécutée manuellement plus tard par un membre du
    // staff (admin.merchants.ts). Body POST : { sourceAccount: 'SALES' | 'COMMISSION', amount,
    // note? } — PAS de PIN (le modèle ne débite rien tout de suite, donc aucune vérification PIN
    // côté serveur pour cette route). Réponse POST : { success, data: MerchantPayoutRequest }.
    // Réponse GET (historique) : { success, data: MerchantPayoutRequest[] }.
    agencyWithdrawal: '/api/merchant-portal/withdraw-to-agency',

    // ── Routes développées EN PARALLÈLE par l'agent backend (capacités "membres d'équipe",
    // "fréquence attendue / conformité" et "répertoire d'employés") — absentes de
    // backend/src/routes/merchant-portal.ts au moment de l'écriture de ce fichier (vérifié :
    // aucune trace de /team, /employees, expectedFrequency ou complianceStatus dans le fichier
    // réel à cette date). Formes ci-dessous construites sur la spécification transmise ; les
    // écrans qui les consomment lisent leurs réponses défensivement (mêmes helpers pickString/
    // pickNumber qu'ailleurs dans ce portail) pour absorber un écart de forme une fois la vraie
    // route mergée, plutôt que de planer en attendant.
    team: '/api/merchant-portal/team',
    teamById: (id: string) => `/api/merchant-portal/team/${id}`,

    employees: '/api/merchant-portal/employees',
    employeeById: (id: string) => `/api/merchant-portal/employees/${id}`,

    affiliationExpectedFrequency: (id: string) => `/api/merchant-portal/affiliations/${id}/expected-frequency`,
};
