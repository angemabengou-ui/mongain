import { Platform } from 'react-native';

// ⚠️ URL du backend — adapter selon l'environnement :
// • Tunnel public (Localtunnel)                   : https://tame-frogs-guess.loca.lt
// • Téléphone Android physique (même réseau WiFi) : http://192.168.1.108:3000
// • Émulateur Android (AVD)                       : http://10.0.2.2:3000
// • Simulateur iOS / navigateur web               : http://localhost:3000
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://mongain-backend.onrender.com';

const TOKEN_KEY = 'mongain_token';
const REFRESH_TOKEN_KEY = 'mongain_refresh_token';

import * as SecureStore from 'expo-secure-store';

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;

// ─── Stockage du token ─────────────────────────────────────────────
export const saveToken = async (token: string) => {
    cachedToken = token;
    if (Platform.OS === 'web') {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        await SecureStore.setItemAsync(TOKEN_KEY, token);
    }
};

export const getToken = async (): Promise<string | null> => {
    if (cachedToken) return cachedToken;
    let t = null;
    if (Platform.OS === 'web') {
        t = localStorage.getItem(TOKEN_KEY);
    } else {
        t = await SecureStore.getItemAsync(TOKEN_KEY);
    }
    if (t) cachedToken = t;
    return t;
};

export const deleteToken = async () => {
    cachedToken = null;
    if (Platform.OS === 'web') {
        localStorage.removeItem(TOKEN_KEY);
    } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
};

// ─── Stockage du refresh token ──────────────────────────────────────
// Session longue durée : l'access token (ci-dessus) est volontairement court, le
// refresh token sert à en obtenir un nouveau en silence (voir tryRefreshSession)
// sans jamais redemander le PIN à l'utilisateur, tant qu'il revient dans les temps.
export const saveRefreshToken = async (token: string | null | undefined) => {
    if (!token) return;
    cachedRefreshToken = token;
    if (Platform.OS === 'web') {
        localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
        await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    }
};

export const getRefreshToken = async (): Promise<string | null> => {
    if (cachedRefreshToken) return cachedRefreshToken;
    let t = null;
    if (Platform.OS === 'web') {
        t = localStorage.getItem(REFRESH_TOKEN_KEY);
    } else {
        t = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    }
    if (t) cachedRefreshToken = t;
    return t;
};

export const deleteRefreshToken = async () => {
    cachedRefreshToken = null;
    if (Platform.OS === 'web') {
        localStorage.removeItem(REFRESH_TOKEN_KEY);
    } else {
        await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    }
};

// ─── Auto-logout callback ──────────────────────────────────────────
// Enregistrer ici une fonction de logout depuis AuthContext
let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { _onUnauthorized = fn; };

// ─── Renouvellement silencieux de session ───────────────────────────
// Appelé une seule fois par vague de 401 concurrents (ex: la home charge solde +
// transactions + stats marchand en parallèle) grâce à _refreshPromise : tous les
// appels échoués attendent la même tentative de renouvellement au lieu de faire
// chacun leur propre requête /auth/refresh (ce qui ferait échouer les rotations
// suivantes, une seule pouvant réussir par ancien refresh token).
let _refreshPromise: Promise<boolean> | null = null;

const tryRefreshSession = async (): Promise<boolean> => {
    if (!_refreshPromise) {
        _refreshPromise = (async () => {
            try {
                const refreshToken = await getRefreshToken();
                if (!refreshToken) return false;

                const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken }),
                });
                if (!res.ok) return false;

                const data = await res.json();
                if (!data.token || !data.refreshToken) return false;

                await saveToken(data.token);
                await saveRefreshToken(data.refreshToken);
                return true;
            } catch {
                return false;
            }
        })();
    }
    try {
        return await _refreshPromise;
    } finally {
        _refreshPromise = null;
    }
};

// ─── Client HTTP de base ───────────────────────────────────────────
// Réveil à froid du backend (plan gratuit Render, mis en veille après inactivité) : la TOUTE
// PREMIÈRE requête suivant une veille échoue au niveau connexion (le conteneur n'écoute pas
// encore) — mesuré en pratique : ~20s sans aucune réponse, puis tout redevient normal en
// dessous de la seconde. Sans retry, l'utilisateur voyait "Vous êtes hors ligne" au premier
// essai alors que le serveur (et ses données) était parfaitement sain une poignée de secondes
// plus tard, et devait relancer l'action lui-même pour que ça marche.
const WAKEUP_MAX_RETRIES = 2;
const WAKEUP_RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 15000;

export const request = async (method: string, path: string, body?: object, auth = false, _isRetry = false, _wakeupAttempt = 0): Promise<any> => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'ngrok-skip-browser-warning': 'true' // In case we use ngrok later
    };

    if (auth) {
        const token = await getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        // Token expiré : on tente un renouvellement silencieux une seule fois avant
        // de déclencher la déconnexion complète (voir tryRefreshSession ci-dessus).
        if (res.status === 401 && !_isRetry) {
            const refreshed = await tryRefreshSession();
            if (refreshed) {
                return request(method, path, body, auth, true);
            }
        }

        // Auto-logout si le renouvellement a échoué (ou n'était pas applicable)
        if (res.status === 401 && _onUnauthorized) {
            if (path === '/api/auth/logout') {
                return; // Empêcher la boucle infinie si le logout retourne 401 (token déjà invalidé).
            }
            _onUnauthorized();
            throw new Error('Session expirée. Veuillez vous reconnecter.');
        }

        let data: any;
        try {
            data = await res.json();
        } catch {
            throw new Error(`Réponse inattendue du serveur (${res.status}). Veuillez réessayer.`);
        }
        if (!res.ok) {
            const err: any = new Error(data.message || data.error || 'Une erreur est survenue.');
            // La quasi-totalité des écrans lisent l'erreur via `e.response?.data?.error` (habitude
            // Axios) — sans cette propriété, ce message précis renvoyé par le serveur était
            // systématiquement ignoré au profit du message générique codé en dur de chaque écran.
            err.response = { status: res.status, data };
            throw err;
        }
        return data;
    } catch (e: any) {
        const isConnectionFailure = e.name === 'AbortError' || e.message.includes('Failed to fetch') || e.message.includes('Network request failed');

        // Nouvelle tentative silencieuse réservée à un échec de CONNEXION (jamais une réponse
        // HTTP d'erreur déjà reçue) sur GET ou /api/auth/* — jamais sur une écriture financière
        // (/wallet, /merchant, /vaults, /tontine, /services) : là, on ne peut pas distinguer
        // "le serveur n'a rien reçu" de "le serveur a bien traité la demande mais la réponse
        // s'est perdue", et renvoyer silencieusement risquerait un double transfert/retrait.
        const allowConnectionRetry = method === 'GET' || path.startsWith('/api/auth/');
        if (isConnectionFailure && allowConnectionRetry && _wakeupAttempt < WAKEUP_MAX_RETRIES) {
            await new Promise(r => setTimeout(r, WAKEUP_RETRY_DELAY_MS));
            return request(method, path, body, auth, _isRetry, _wakeupAttempt + 1);
        }

        if (e.name === 'AbortError') {
            throw new Error('Le serveur met trop de temps à répondre (il est peut-être en train de redémarrer). Veuillez réessayer dans un instant.');
        }
        if (isConnectionFailure) {
            throw new Error('Vous êtes hors ligne 📡. Veuillez vérifier votre connexion internet.');
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
};

// ─── Types ────────────────────────────────────────────────────────

export interface Wallet {
    id: string;
    balance: number;
    currency: string;
}

export interface User {
    id: string;
    name: string;
    username?: string;
    email?: string;
    phone: string;
    kycStatus?: string;
    kycLevel?: number;
    role?: string;
    wallet: Wallet | null;
}

export interface Transaction {
    id: string;
    type: 'incoming' | 'outgoing';
    amount: number;
    currency: string;
    status: string;
    reference?: string;
    counterpart: string;
    counterpartPhone: string;
    createdAt: string;
}

// ─── API Auth ─────────────────────────────────────────────────────

export const apiRequestOtp = (phone: string) =>
    request('POST', '/api/auth/request-otp', { phone }) as Promise<{ message: string }>;

export const apiRegister = (name: string, username: string, phone: string, pin: string, otpCode: string) =>
    request('POST', '/api/auth/register', { name, username, phone, pin, otpCode }) as Promise<{ token: string; refreshToken: string; user: User }>;

export const apiLogin = (phone: string, pin: string) =>
    request('POST', '/api/auth/login', { phone, pin }) as Promise<{ token?: string; refreshToken?: string; user?: User; requireOtp?: boolean; message?: string }>;

export const apiVerifyLoginOtp = (phone: string, otpCode: string) =>
    request('POST', '/api/auth/verify-login-otp', { phone, otpCode }) as Promise<{ token: string; refreshToken: string; user: User }>;

// Révoque le refresh token côté serveur — best-effort, appelé au logout explicite.
export const apiLogoutServer = () =>
    request('POST', '/api/auth/logout', undefined, true) as Promise<{ message: string }>;

// Régression : POST /api/auth/verify-pin exige authMiddleware côté serveur, mais cet appel
// omettait le 4e argument `auth` de request() (défaut à false) — aucun token n'était donc
// jamais envoyé. Le 401 qui en résultait déclenchait une tentative de rafraîchissement
// silencieux (qui réussit, l'utilisateur ayant un refreshToken valide), puis la RETENTATIVE
// répétait la même erreur (le flag `auth` manquant persiste), ce qui finissait par déclencher
// une DÉCONNEXION COMPLÈTE — même en saisissant le bon code PIN. Le verrou biométrique en
// mode PIN de secours (pas de matériel biométrique, ou "Utiliser le code PIN") ne pouvait
// donc jamais être déverrouillé.
export const apiVerifyAppLockPin = (pin: string) =>
    request('POST', '/api/auth/verify-pin', { pin }, true) as Promise<{ success: boolean; error?: string }>;

export const apiGetMe = () =>
    request('GET', '/api/auth/me', undefined, true) as Promise<User>;

export const apiUpdateProfile = (name: string, username?: string, email?: string, idCardFront?: string, idCardBack?: string, selfie?: string) =>
    request('PUT', '/api/auth/profile', { name, username, email, idCardFront, idCardBack, selfie }, true) as Promise<User>;

export const apiUpdatePin = (oldPin: string, newPin: string) =>
    request('PUT', '/api/auth/pin', { oldPin, newPin }, true) as Promise<{ message: string }>;

export const apiUpdatePushToken = (pushToken: string) =>
    request('PUT', '/api/auth/push-token', { pushToken }, true) as Promise<{ message: string }>;

export const apiRequestResetOTP = (phone: string) =>
    request('POST', '/api/auth/request-reset-otp', { phone }, false) as Promise<{ message: string }>;

// Régression : le backend attend `otpCode` (voir auth.ts, resetPinSchema), pas `otp` — le
// mauvais nom de champ faisait échouer TOUTE réinitialisation de PIN avec un 400, quel que
// soit le code SMS saisi. Le succès renvoie en plus une session complète (token +
// refreshToken + user), pas un simple message : l'utilisateur peut donc être reconnecté
// directement plutôt que renvoyé se reconnecter manuellement avec le PIN qu'il vient de
// définir (voir AuthContext.resetPin, qui suit le même schéma que register/verifyLoginOtp).
export const apiResetPIN = (phone: string, otpCode: string, newPin: string) =>
    request('POST', '/api/auth/reset-pin', { phone, otpCode, newPin }, false) as Promise<{ token: string; refreshToken: string; user: User }>;

// ─── API Wallet ───────────────────────────────────────────────────

export const apiLookupUser = (phone: string) =>
    request('GET', `/api/wallet/lookup/${encodeURIComponent(phone)}`, undefined, true) as Promise<{ id: string; name: string; phone: string; role: string }>;

// Retrouve, parmi une liste de numéros (carnet de contacts du téléphone), lesquels ont un
// compte Mongain — voir src/services/contacts.ts pour l'utilisation complète (permission,
// lecture du carnet, normalisation des numéros).
export const apiMatchContacts = (phones: string[]) =>
    request('POST', '/api/wallet/match-contacts', { phones }, true) as Promise<{ matches: { id: string; name: string; phone: string; role: string }[] }>;

export const apiGetDailyLimits = () =>
    request('GET', '/api/wallet/limits', undefined, true) as Promise<{ skip?: boolean, dailySpend: number, dailyLimit: number, kycStatus: string, kycLevel: number }>;

export const apiGetSystemSettings = () =>
    request('GET', '/api/settings', undefined, false) as Promise<{
        airtelEnabled: boolean, moovEnabled: boolean, seegEnabled: boolean, tontineEnabled: boolean,
        taxP2P: number, taxWithdraw: number
    }>;

export interface AppNotification {
    id: string; title: string; body: string; type: string; isRead: boolean; createdAt: string;
}

export const apiGetNotifications = () =>
    request('GET', '/api/notifications', undefined, true) as Promise<AppNotification[]>;

export const apiGetUnreadCount = () =>
    request('GET', '/api/notifications/unread-count', undefined, true) as Promise<{ count: number }>;

export const apiMarkAsRead = (id?: string) =>
    request('PUT', id ? `/api/notifications/${id}/read` : '/api/notifications/read-all', undefined, true);

export const apiGetBalance = () =>
    request('GET', '/api/wallet/balance', undefined, true) as Promise<{ balance: number; currency: string }>;

export const apiGetTransactions = (limit?: number) =>
    request('GET', `/api/wallet/transactions${limit ? `?limit=${limit}` : ''}`, undefined, true) as Promise<Transaction[]>;

export const apiTransfer = (receiverPhone: string, amount: number, pin: string) =>
    request('POST', '/api/wallet/transfer', { receiverPhone, amount, pin }, true) as Promise<{
        message: string;
        data: { transaction: any; remainingBalance: number; receiverName: string };
    }>;

export const apiClientInitiatedWithdraw = (receiverPhone: string, amount: number, pin: string) =>
    request('POST', '/api/wallet/client-initiated-withdraw', { receiverPhone, amount, pin }, true) as Promise<{
        message: string;
        data: { transaction: any; remainingBalance: number; agentName: string; agentPhone: string };
    }>;

export const apiTopUp = (amount: number, cardToken?: string) =>
    request('POST', '/api/wallet/topup', { amount, cardToken }, true) as Promise<{ message: string; balance: number }>;

export const apiPullDeposit = (phone: string, amount: number, network: string) =>
    request('POST', '/api/wallet/pull', { phone, amount, network }, true) as Promise<{ message: string, reference: string, network: string }>;

export const apiPushWithdrawal = (phone: string, amount: number, network: string, pin: string) =>
    request('POST', '/api/wallet/push', { phone, amount, network, pin }, true) as Promise<{ message: string, reference: string, network: string }>;

export const apiGenerateWithdrawCode = (amount: number) =>
    request('POST', '/api/wallet/generate-withdraw-code', { amount }, true) as Promise<{ code: string; expiresAt: string }>;



// Reclamations
export const apiGetReclamations = () => request('GET', '/api/reclamation', undefined, true) as Promise<any[]>;
export const apiCreateReclamation = (title: string, description: string) => request('POST', '/api/reclamation', { title, description }, true) as Promise<any>;

// Services
export const apiPayService = (type: string, amount: number, reference?: string) =>
    request('POST', '/api/wallet/pay-service', { type, amount, reference }, true) as Promise<{ message: string; balance: number; serviceToken?: string }>;

// Factures SEEG / Canal+ (backend/src/routes/services.ts)
export const apiPayBill = (service: 'SEEG' | 'CANAL', accountNumber: string, amount: number, pin: string) =>
    request('POST', '/api/services/pay-bill', { service, accountNumber, amount, pin }, true) as Promise<{ message: string; seegCode?: string; reference: string }>;

// Recharge crédit Airtel / Moov (backend/src/routes/services.ts)
export const apiAirtimeTopUp = (network: 'AIRTEL' | 'MOOV', phoneNumber: string, amount: number, pin: string) =>
    request('POST', '/api/services/topup', { network, phoneNumber, amount, pin }, true) as Promise<{ message: string; reference: string }>;

// Marchand
export const apiGetMerchantStats = () =>
    request('GET', '/api/merchant/stats', undefined, true) as Promise<{
        balance: number; commissionBalance: number; todaySalesAmount: number; todaySalesCount: number;
        allTimeSalesAmount: number; todayCommission: number; allTimeCommission: number;
    }>;

export const apiGetMerchantTransactions = (category?: 'SALES' | 'COMMISSION') =>
    request('GET', `/api/merchant/transactions${category ? `?category=${category}` : ''}`, undefined, true) as Promise<any[]>;

// sourceAccount : 'SALES' (solde ventes/paiements) ou 'COMMISSION' (solde commission) —
// voir MerchantPayoutRequest (backend/prisma/schema.prisma) et admin.merchants.ts pour le
// traitement (approbation/rejet) côté staff.
export const apiCreateMerchantPayout = (sourceAccount: 'SALES' | 'COMMISSION', amount: number, note?: string) =>
    request('POST', '/api/merchant/payouts', { sourceAccount, amount, note }, true) as Promise<{ success: boolean; data: any }>;

export const apiGetMerchantPayouts = () =>
    request('GET', '/api/merchant/payouts', undefined, true) as Promise<any[]>;

// Tontine
export const apiGetTontineGroups = () =>
    request('GET', '/api/tontine/groups', undefined, true) as Promise<{ data: { groups: any[]; myParticipations: any[] } }>;

export const apiCreateTontine = (name: string, contribution: number, frequency: string, isPublic?: boolean) =>
    request('POST', '/api/tontine/create', { name, contribution, frequency, isPublic }, true) as Promise<any>;

export const apiJoinTontine = (groupId: string) =>
    request('POST', '/api/tontine/join', { groupId }, true) as Promise<any>;

// Tontines publiques rejoignables librement (isPublic=true, non déjà rejointes) — voir
// backend/src/routes/tontine.ts GET /discover.
export const apiDiscoverTontines = (q?: string) =>
    request('GET', `/api/tontine/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`, undefined, true) as Promise<{ success: boolean; data: any[] }>;

// Nouvelles Fonctions Tontine Privée
export const apiGetTontineDetails = (groupId: string) =>
    request('GET', `/api/tontine/details/${groupId}`, undefined, true) as Promise<any>;

export const apiInviteToTontine = (groupId: string, phone: string) =>
    request('POST', '/api/tontine/invite', { groupId, phone }, true) as Promise<any>;

export const apiReorderTontine = (groupId: string, orderMap: { participantId: string, newOrder: number }[]) =>
    request('POST', '/api/tontine/reorder', { groupId, orderMap }, true) as Promise<any>;

export const apiLeaveTontine = (groupId: string) =>
    request('POST', '/api/tontine/leave', { groupId }, true) as Promise<any>;

// Cotisation et fréquence : rejetées par le serveur dès que le premier cycle a tourné
// (voir tontine.ts, PUT /settings) — le nom et isPublic restent modifiables à tout moment.
export const apiUpdateTontineSettings = (groupId: string, data: { name?: string; contribution?: number; frequency?: string; isPublic?: boolean }) =>
    request('PUT', '/api/tontine/settings', { groupId, ...data }, true) as Promise<any>;

// Dissolution définitive — irréversible, réservée au créateur (voir tontine.ts, POST /cancel).
export const apiCancelTontine = (groupId: string) =>
    request('POST', '/api/tontine/cancel', { groupId }, true) as Promise<any>;

// Réponse au sondage de relance en fin de boucle (voir tontine.ts, POST /renewal-vote).
export const apiVoteTontineRenewal = (groupId: string, vote: 'YES' | 'NO') =>
    request('POST', '/api/tontine/renewal-vote', { groupId, vote }, true) as Promise<any>;

// Cotisation volontaire, montant libre, pour le tour en cours — jusqu'ici, seul le CRON
// quotidien pouvait prélever une cotisation, pour le montant fixe et entier de la part
// (voir tontine.ts, POST /contribute).
export const apiContributeTontine = (groupId: string, amount: number) =>
    request('POST', '/api/tontine/contribute', { groupId, amount }, true) as Promise<any>;

// ==========================================
// VAULTS (CAISSE COMMUNE / MULTISIG)
// ==========================================

export const apiGetVaults = () =>
    request('GET', '/api/vaults', undefined, true) as Promise<any>;

export const apiCreateVault = (data: { name: string; description?: string; requiredApprovals?: number }) =>
    request('POST', '/api/vaults', data, true) as Promise<any>;

export const apiUpdateVaultSettings = (id: string, data: { requiredApprovals?: number; name?: string; description?: string }) =>
    request('PUT', `/api/vaults/${id}/settings`, data, true) as Promise<any>;

export const apiLeaveVault = (id: string) =>
    request('POST', `/api/vaults/${id}/leave`, undefined, true) as Promise<any>;

export const apiGetVaultDetails = (id: string) =>
    request('GET', `/api/vaults/${id}`, undefined, true) as Promise<any>;

export const apiInviteVault = (id: string, phone: string) =>
    request('POST', `/api/vaults/${id}/invite`, { phone }, true) as Promise<any>;

export const apiUpdateVaultRoles = (id: string, data: { targetUserId: string, isInitiator: boolean, isValidator: boolean, isTreasurer: boolean, isAdmin: boolean, isRequiredValidator?: boolean }) =>
    request('PUT', `/api/vaults/${id}/roles`, data, true) as Promise<any>;

export const apiDepositVault = (id: string, amount: string) =>
    request('POST', `/api/vaults/${id}/deposit`, { amount }, true) as Promise<any>;

export const apiWithdrawRequestVault = (id: string, data: { amount: string, destinationType: string, destinationId?: string, destinationPhone?: string, reason: string }) =>
    request('POST', `/api/vaults/${id}/withdraw-request`, data, true) as Promise<any>;

export const apiApproveVault = (id: string, txId: string) =>
    request('POST', `/api/vaults/${id}/approve/${txId}`, undefined, true) as Promise<any>;

export const apiGetMyVouchers = () =>
    request('GET', '/api/vaults/vouchers/my', undefined, true) as Promise<any>;

export const apiSpendVoucher = (voucherId: string, destinationPhone: string, pin: string) =>
    request('POST', `/api/vaults/vouchers/${voucherId}/spend`, { destinationPhone, pin }, true) as Promise<any>;

// --- CREDIT (V14) ---

export const apiGetCreditEligibility = () => request('GET', '/api/credit/eligibility', undefined, true) as Promise<{ eligible: boolean, maxAmount: number, interestRate: number, loyaltyPoints: number }>;
export const apiGetActiveLoans = () => request('GET', '/api/credit/active', undefined, true) as Promise<any[]>;
export const apiApplyCredit = (amount: number) => request('POST', '/api/credit/apply', { amount }, true) as Promise<{ success: boolean, loan: any, balance: number }>;
export const apiRepayCredit = (loanId: string) => request('POST', '/api/credit/repay', { loanId }, true) as Promise<{ success: boolean, balance: number }>;


// --- MARKET & ESCROW (V16) ---
export const apiGetMarketListings = () => request('GET', '/api/market/listings', undefined, true) as Promise<{ success: boolean, listings: any[] }>;
export const apiCreateListing = (data: { title: string, description: string, price: number }) => request('POST', '/api/market/listings', data, true) as Promise<{ success: boolean }>;
export const apiBuyMarketItem = (id: string, pin: string) => request('POST', `/api/market/buy/${id}`, { pin }, true) as Promise<{ success: boolean, message: string }>;
export const apiReleaseEscrow = (escrowId: string) => request('POST', `/api/market/escrow/${escrowId}/release`, undefined, true) as Promise<{ success: boolean }>;

// --- 3D-SECURE & INVOICES (V21) ---
export const apiGetMyInvoices = () => request('GET', '/api/b2b/invoices/my', undefined, true) as Promise<{ success: boolean, invoices: any[] }>;
export const apiPayInvoice = (id: string, pin: string) => request('POST', `/api/b2b/invoices/${id}/pay`, { pin }, true) as Promise<{ success: boolean, message: string }>;
export const apiRejectInvoice = (id: string) => request('POST', `/api/b2b/invoices/${id}/reject`, undefined, true) as Promise<{ success: boolean, message: string }>;
