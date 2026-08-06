import { Platform } from 'react-native';

// ⚠️ URL du backend — adapter selon l'environnement :
// • Tunnel public (Localtunnel)                   : https://tame-frogs-guess.loca.lt
// • Téléphone Android physique (même réseau WiFi) : http://192.168.1.108:3000
// • Émulateur Android (AVD)                       : http://10.0.2.2:3000
// • Simulateur iOS / navigateur web               : http://localhost:3000
export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://mongain-backend.onrender.com';

const TOKEN_KEY = 'mongain_token';

import * as SecureStore from 'expo-secure-store';

// ─── Stockage du token ─────────────────────────────────────────────
export const saveToken = async (token: string) => {
    if (Platform.OS === 'web') {
        localStorage.setItem(TOKEN_KEY, token);
    } else {
        await SecureStore.setItemAsync(TOKEN_KEY, token);
    }
};

export const getToken = async (): Promise<string | null> => {
    if (Platform.OS === 'web') {
        return localStorage.getItem(TOKEN_KEY);
    }
    return await SecureStore.getItemAsync(TOKEN_KEY);
};

export const deleteToken = async () => {
    if (Platform.OS === 'web') {
        localStorage.removeItem(TOKEN_KEY);
    } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
};

// ─── Auto-logout callback ──────────────────────────────────────────
// Enregistrer ici une fonction de logout depuis AuthContext
let _onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { _onUnauthorized = fn; };

// ─── Client HTTP de base ───────────────────────────────────────────
const request = async (method: string, path: string, body?: object, auth = false) => {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Bypass-Tunnel-Reminder': 'true',
        'ngrok-skip-browser-warning': 'true' // In case we use ngrok later
    };

    if (auth) {
        const token = await getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        // Auto-logout si token expiré ou invalide
        if (res.status === 401 && _onUnauthorized) {
            _onUnauthorized();
            throw new Error('Session expirée. Veuillez vous reconnecter.');
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Une erreur est survenue.');
        return data;
    } catch (e: any) {
        if (e.message.includes('Failed to fetch') || e.message.includes('Network request failed')) {
            throw new Error('Vous êtes hors ligne 📡. Veuillez vérifier votre connexion internet.');
        }
        throw e;
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

export const apiRegister = (name: string, phone: string, pin: string, otpCode: string) =>
    request('POST', '/api/auth/register', { name, phone, pin, otpCode }) as Promise<{ token: string; user: User }>;

export const apiLogin = (phone: string, pin: string) =>
    request('POST', '/api/auth/login', { phone, pin }) as Promise<{ token: string; user: User }>;

export const apiGetMe = () =>
    request('GET', '/api/auth/me', undefined, true) as Promise<User>;

export const apiUpdateProfile = (name: string, idCardFront?: string, idCardBack?: string, selfie?: string) =>
    request('PUT', '/api/auth/profile', { name, idCardFront, idCardBack, selfie }, true) as Promise<User>;

export const apiUpdatePin = (oldPin: string, newPin: string) =>
    request('PUT', '/api/auth/pin', { oldPin, newPin }, true) as Promise<{ message: string }>;

export const apiUpdatePushToken = (pushToken: string) =>
    request('PUT', '/api/auth/push-token', { pushToken }, true) as Promise<{ message: string }>;

export const apiRequestResetOTP = (phone: string) =>
    request('POST', '/api/auth/request-reset-otp', { phone }, false) as Promise<{ message: string }>;

export const apiResetPIN = (phone: string, otp: string, newPin: string) =>
    request('POST', '/api/auth/reset-pin', { phone, otp, newPin }, false) as Promise<{ message: string }>;

// ─── API Wallet ───────────────────────────────────────────────────

export const apiLookupUser = (phone: string) =>
    request('GET', `/api/wallet/lookup/${encodeURIComponent(phone)}`, undefined, true) as Promise<{ id: string; name: string; phone: string; role: string }>;

export const apiGetBalance = () =>
    request('GET', '/api/wallet/balance', undefined, true) as Promise<{ balance: number; currency: string }>;

export const apiGetTransactions = () =>
    request('GET', '/api/wallet/transactions', undefined, true) as Promise<Transaction[]>;

export const apiTransfer = (receiverPhone: string, amount: number, pin?: string, useBiometrics?: boolean) =>
    request('POST', '/api/wallet/transfer', { receiverPhone, amount, pin, useBiometrics }, true) as Promise<{
        message: string;
        data: { transaction: any; remainingBalance: number; receiverName: string };
    }>;

export const apiDeposit = (amount: number) =>
    request('POST', '/api/wallet/deposit', { amount }, true) as Promise<{ message: string; balance: number }>;

export const apiWithdraw = (amount: number, pin?: string, agentPhone?: string, useBiometrics?: boolean) =>
    request('POST', '/api/wallet/withdraw', { amount, pin, agentPhone, useBiometrics }, true) as Promise<{ message: string; balance: number }>;

export const apiMerchantCharge = (payerPhone: string, amount: number, withdrawCode: string) =>
    request('POST', '/api/wallet/charge', { payerPhone, amount, withdrawCode }, true) as Promise<any>;

export const apiAgentWithdrawConfirm = (payerPhone: string, amount: number, withdrawCode: string) =>
    request('POST', '/api/wallet/agent-withdraw', { payerPhone, amount, withdrawCode }, true) as Promise<any>;

// Reclamations
export const apiGetReclamations = () => request('GET', '/api/reclamation', undefined, true) as Promise<any[]>;
export const apiCreateReclamation = (title: string, description: string) => request('POST', '/api/reclamation', { title, description }, true) as Promise<any>;
