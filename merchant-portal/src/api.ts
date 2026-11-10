import { API_URL } from './config';

// Clés de storage du Portail Marchand Géant — DÉLIBÉRÉMENT différentes de celles utilisées
// par admin-web (qui stocke son token dans sessionStorage sous la clé `admin_token`, voir
// admin-web/src/utils/apiClient.ts). Les deux applications peuvent donc tourner dans le
// même navigateur (même poste, deux onglets) sans jamais se marcher dessus.
const TOKEN_KEY = 'merchant_portal_token';
const REFRESH_TOKEN_KEY = 'merchant_portal_refresh_token';
const USER_KEY = 'merchant_portal_user';

// Système de rôles à 4 niveaux (raffinement de l'ancien binaire ADMIN/VIEWER) — voir
// backend/prisma/schema.prisma MerchantPortalMember.role (colonne String libre, pas un enum
// SQL : n'importe laquelle des 4 valeurs y tient sans migration de schéma). Les anciennes
// lignes 'VIEWER' ont déjà été migrées en base vers 'AUDITOR' par l'agent backend (même sens :
// lecture seule) ; normalizePortalRole ci-dessous garde 'VIEWER' en repli défensif au cas où un
// objet utilisateur mis en cache localStorage avant cette migration traînerait encore jusqu'à
// la prochaine connexion.
//   ADMIN    : tous les droits, y compris gérer l'équipe et les réglages du portail.
//   MANAGER  : tout sauf gérer l'équipe (affiliations, paiements, retraits, employés, guichets).
//   OPERATOR : peut exécuter paiements/retraits/employés/guichets, mais pas affiliations ni équipe.
//   AUDITOR  : lecture seule partout (remplace l'ancien VIEWER, strictement même sens).
export type PortalRole = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR';

const KNOWN_PORTAL_ROLES: readonly string[] = ['ADMIN', 'MANAGER', 'OPERATOR', 'AUDITOR'];

// Forme du user pas garantie à 100% (backend en cours de développement en parallèle) —
// on ne dépend que de ce qui est nécessaire à l'affichage, tout le reste est optionnel.
export type PortalUser = {
    id?: string;
    name?: string;
    businessName?: string;
    phone?: string;
    merchantTier?: string;
    // Le champ RÉELLEMENT renvoyé par POST /auth/verify-otp (voir
    // backend/src/routes/merchant-portal.ts) est `portalRole`, pas `role` — l'ancien code de ce
    // fichier lisait `.role`, qui n'existe jamais sur cet objet ; isPortalViewer() ne détectait
    // donc en pratique jamais un membre en lecture seule (bug corrigé ici). `role` reste lu en
    // repli par getPortalRole() ci-dessous au cas où cette forme changerait encore. Absent pour
    // le géant lui-même, qui n'a jamais de ligne MerchantPortalMember et garde donc les pleins
    // droits (le serveur renvoie explicitement `portalRole: 'ADMIN'` pour lui, mais on ne
    // dépend pas de cette présence pour rester robuste).
    portalRole?: PortalRole;
    role?: PortalRole;
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

// Rôle de la session actuellement connectée (géant ou membre). Absent (ni `portalRole` ni
// `role` sur l'objet stocké) => le géant lui-même => pleins droits (ADMIN). Une valeur inconnue
// ou l'ancien 'VIEWER' retombe sur 'AUDITOR', le plus restrictif — jamais sur ADMIN par défaut
// pour une valeur qu'on ne reconnaît pas, à la différence du cas "champ absent" qui a un sens
// métier précis et documenté ci-dessus.
export function getPortalRole(): PortalRole {
    const raw = getStoredUser()?.portalRole ?? getStoredUser()?.role;
    if (raw === undefined || raw === null) return 'ADMIN';
    if (typeof raw === 'string' && KNOWN_PORTAL_ROLES.includes(raw)) return raw as PortalRole;
    return 'AUDITOR';
}

// Gestion de l'équipe (inviter/changer de rôle/désactiver/supprimer un membre) — ADMIN
// uniquement, jamais délégable. Voir routes/merchant-portal.ts requirePortalAdmin sur
// POST/PATCH/DELETE /team.
export function canManageTeam(): boolean {
    return getPortalRole() === 'ADMIN';
}

// Réglages du portail (seuil de double validation, PATCH /settings) — ADMIN uniquement, comme
// canManageTeam() aujourd'hui, mais gardé comme prédicat séparé : "gérer l'équipe" et "gérer
// les réglages" restent deux permissions conceptuellement distinctes côté serveur même si elles
// se recoupent actuellement sur le seul rôle ADMIN.
export function canManageSettings(): boolean {
    return getPortalRole() === 'ADMIN';
}

// Affiliations (affilier un marchand, révoquer, modifier la fréquence attendue) — ADMIN et
// MANAGER. Ni OPERATOR (exécution seulement) ni AUDITOR (lecture seule).
export function canManageAffiliations(): boolean {
    const role = getPortalRole();
    return role === 'ADMIN' || role === 'MANAGER';
}

// Exécuter des mouvements : paiement des employés, retrait vers agence, répertoire d'employés
// (ajout/suppression, import CSV), guichets (créer/désactiver). Tout rôle SAUF AUDITOR.
export function canExecutePayments(): boolean {
    return getPortalRole() !== 'AUDITOR';
}

// Approuver un paiement de masse resté AWAITING_APPROVAL (double validation) — ADMIN et MANAGER
// uniquement, voir routes/merchant-portal.ts POST /payouts/:id/approve. Le serveur refuse en
// plus qu'un initiateur approuve son propre lot (403), vérifié indépendamment de ce prédicat de
// rôle — voir wasInitiatedBySelf() dans EmployeePayouts.tsx.
export function canApprovePayments(): boolean {
    const role = getPortalRole();
    return role === 'ADMIN' || role === 'MANAGER';
}

// Rétro-compatibilité : conservé pour ne rien casser d'éventuel appelant restant, désormais
// strictement équivalent à getPortalRole() === 'AUDITOR' (même sens que l'ancien VIEWER). Tous
// les écrans de ce portail utilisent maintenant getPortalRole()/canXxx() ci-dessus plutôt que ce
// booléen unique, devenu insuffisant pour distinguer 4 rôles.
export function isPortalViewer(): boolean {
    return getPortalRole() === 'AUDITOR';
}

// Décodage SUPERFICIEL (pas de vérification de signature — jamais utilisé pour une décision de
// sécurité, seulement pour une aide d'affichage) du payload d'un JWT portail, pour en extraire
// `memberId` (voir routes/merchant-portal.ts POST /auth/verify-otp : posé uniquement pour une
// session de MEMBRE, absent pour une session géant). Nécessaire car la réponse de connexion
// elle-même ne renvoie pas cet identifiant dans `user` (seulement dans le JWT) : c'est pourtant
// la seule façon, côté client, de savoir "suis-je l'initiateur de CE lot" sans que le serveur
// n'ajoute un champ dédié à chaque paiement.
function decodeTokenPayload(): Record<string, unknown> | null {
    const token = getToken();
    if (!token) return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(escape(atob(base64)));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

// Identifiant MerchantPortalMember de la session en cours, ou null pour le géant lui-même
// (jamais de ligne membre) — à comparer à PayoutBulk.initiatedByMemberId (également null quand
// c'est le géant qui a initié) pour savoir si l'utilisateur connecté est l'initiateur d'un lot
// donné. Voir EmployeePayouts.tsx.
export function getOwnPortalMemberId(): string | null {
    const id = decodeTokenPayload()?.memberId;
    return typeof id === 'string' && id ? id : null;
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

    affiliationTerms: (id: string) => `/api/merchant-portal/affiliations/${id}/terms`,

    // ── Routes des 4 nouvelles capacités (rôles enrichis, approbation à plusieurs, import CSV,
    // guichets) développées EN PARALLÈLE par l'agent backend — absentes de
    // backend/src/routes/merchant-portal.ts au moment de l'écriture de ce fichier (vérifié :
    // seuls /team, /payouts, /employees "simples" existent à cette date, toujours gatés par
    // l'ancien requirePortalAdmin binaire ADMIN/VIEWER). Formes construites sur la spécification
    // transmise ; les écrans qui les consomment lisent leurs réponses défensivement, même
    // pattern pickString/pickNumber qu'ailleurs dans ce portail.

    // GET (tous rôles) / PATCH (ADMIN uniquement) { portalApprovalThreshold: number | null }.
    portalSettings: '/api/merchant-portal/settings',

    // GET (tous rôles) — liste des lots de paiement restés AWAITING_APPROVAL faute d'avoir
    // dépassé le seuil configuré (portalApprovalThreshold) sans encore être validés par un
    // second membre habilité.
    payoutsPendingApproval: '/api/merchant-portal/payouts/pending-approval',

    // POST (ADMIN, MANAGER) — exécute réellement le lot. Refuse (403) si l'appelant est le même
    // membre que l'initiateur du lot.
    payoutApprove: (id: string) => `/api/merchant-portal/payouts/${id}/approve`,

    // POST { csv: string } (ADMIN, MANAGER, OPERATOR) — import en masse du répertoire
    // d'employés depuis un texte "nom,téléphone" (une ligne par employé, en-tête optionnel).
    // Réponse : { created, skipped, errors }.
    employeesImport: '/api/merchant-portal/employees/import',

    // GET (tous rôles) / POST { name, phone, pin } / DELETE (ADMIN, MANAGER, OPERATOR) — guichets
    // physiques (login téléphone+PIN dédié à un terminal/caissier, PAS un accès au portail web).
    tills: '/api/merchant-portal/tills',
    tillById: (id: string) => `/api/merchant-portal/tills/${id}`,

    // ── Open API (Mongain Connect)
    gatewayKeys: '/api/gateway/keys',
    gatewayKeyGenerate: '/api/gateway/keys/generate',
    gatewayKeyUpdate: (id: string) => `/api/gateway/keys/${id}`,
    gatewayKeyRotate: (id: string) => `/api/gateway/keys/${id}/rotate`,
    gatewayWebhookDeliveries: '/api/gateway/webhook-deliveries',
};

// Gérer l'API Ouverte (Génération de clés secrètes, webhooks) — ADMIN uniquement.
export function canManageDevelopers(): boolean {
    return getPortalRole() === 'ADMIN';
}
