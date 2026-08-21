// Client de l'API PVit (agrégateur de paiement Mobile Money/carte, mypvit.pro) — remplace
// l'ancien mobileMoney.ts qui ne faisait que simuler un succès sans jamais rien appeler en
// vrai. Référence : https://docs.mypvit.pro (section "Initier un paiement").
//
// Les identifiants sont gérés depuis l'admin-web (Paramètres > Passerelles de Paiement,
// SystemSettings.pvit*) plutôt que par variable d'environnement Render, pour que l'équipe
// puisse les reconfigurer sans accès au dashboard Render.
import { logError } from '../utils/errorLog';

const PVIT_BASE_URL = 'https://api.mypvit.pro/v2';

const OPERATOR_CODES = {
    AIRTEL: 'AIRTEL_MONEY',
    MOOV: 'MOOV_MONEY',
} as const;

export type PVitNetwork = keyof typeof OPERATOR_CODES;

export interface PVitSettings {
    pvitSecretKey?: string | null;
    pvitCodeUrlPayment?: string | null;
    pvitMerchantOperationAccountCode?: string | null;
    pvitCallbackUrlCode?: string | null;
}

export function isPvitConfigured(settings: PVitSettings): boolean {
    return !!(
        settings.pvitSecretKey &&
        settings.pvitCodeUrlPayment &&
        settings.pvitMerchantOperationAccountCode &&
        settings.pvitCallbackUrlCode
    );
}

// Gabon : nos numéros sont stockés en +241XXXXXXXX (sans le 0 initial), mais PVit attend le
// format local à 9 chiffres avec le 0 (ex: 077XXXXXX) — même convention que numero_client
// dans la doc de l'ancienne API et customer_account_number dans la nouvelle.
export function toPvitCustomerAccountNumber(phone: string): string {
    const local = phone.replace(/^\+241/, '').replace(/\s/g, '');
    return local.startsWith('0') ? local : `0${local}`;
}

interface PVitPaymentResponse {
    status: string;
    status_code: string;
    operator: string;
    reference_id: string;
    merchant_reference_id: string;
    message: string;
}

export async function initiatePvitPayment(settings: PVitSettings, params: {
    amount: number;
    reference: string;
    customerAccountNumber: string;
    network: PVitNetwork;
}): Promise<PVitPaymentResponse> {
    if (!isPvitConfigured(settings)) throw new Error('PVit non configuré.');

    let res: Response;
    try {
        const urlCode = settings.pvitCodeUrlPayment!.trim();
        const secret = settings.pvitSecretKey!.trim();

        res = await fetch(`${PVIT_BASE_URL}/${urlCode}/rest`, {
            method: 'POST',
            headers: {
                'X-Secret': secret,
                'X-Callback-MediaType': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: params.amount,
                reference: params.reference,
                service: 'RESTFUL',
                transaction_type: 'PAYMENT',
                operator_code: OPERATOR_CODES[params.network],
                customer_account_number: params.customerAccountNumber,
                merchant_operation_account_code: settings.pvitMerchantOperationAccountCode,
                callback_url_code: settings.pvitCallbackUrlCode,
                owner_charge: 'CUSTOMER',
                owner_charge_operator: 'CUSTOMER',
            }),
        });
    } catch {
        throw new Error('Impossible de contacter PVit. Réessayez dans un instant.');
    }

    const rawBody = await res.text();
    let data: any = null;
    try { data = rawBody ? JSON.parse(rawBody) : null; } catch { /* corps non-JSON, géré ci-dessous */ }

    if (!res.ok || !data) {
        const detail = data?.message || data?.error || data?.errors || (rawBody && rawBody.length < 300 ? rawBody : null);
        // Journalisé en base (page "Erreurs Système" de l'admin-web) plutôt que seulement en
        // console — sinon un rejet PVit n'est visible que dans les logs Render.
        await logError('PVIT_PAYMENT', detail ? String(detail) : `HTTP ${res.status}`, {
            httpStatus: res.status,
            rawBody: rawBody?.slice(0, 2000),
            requestReference: params.reference,
            network: params.network,
        });
        throw new Error(detail ? `PVit : ${detail}` : `PVit a refusé la demande (HTTP ${res.status}).`);
    }
    return data;
}

// Fonction pour Envoyer de l'argent depuis Mongain vers un compte Mobile Money (Retrait client)
export async function initiatePvitTransfer(settings: PVitSettings, params: {
    amount: number;
    reference: string;
    customerAccountNumber: string;
    network: PVitNetwork;
}): Promise<PVitPaymentResponse> {
    if (!isPvitConfigured(settings)) throw new Error('PVit non configuré.');

    let res: Response;
    try {
        const urlCode = settings.pvitCodeUrlPayment!.trim();
        const secret = settings.pvitSecretKey!.trim();

        res = await fetch(`${PVIT_BASE_URL}/${urlCode}/rest`, {
            method: 'POST',
            headers: {
                'X-Secret': secret,
                'X-Callback-MediaType': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                amount: params.amount,
                reference: params.reference,
                service: 'RESTFUL',
                // Clé importante pour les retraits : TRANSFER au lieu de PAYMENT.
                // Cela ordonne à PVit de débiter notre compte marchand et de créditer le client.
                transaction_type: 'TRANSFER',
                operator_code: OPERATOR_CODES[params.network],
                customer_account_number: params.customerAccountNumber,
                merchant_operation_account_code: settings.pvitMerchantOperationAccountCode,
                callback_url_code: settings.pvitCallbackUrlCode,
                owner_charge: 'CUSTOMER',
                owner_charge_operator: 'CUSTOMER',
            }),
        });
    } catch {
        throw new Error('Impossible de contacter PVit. Réessayez dans un instant.');
    }

    const rawBody = await res.text();
    let data: any = null;
    try { data = rawBody ? JSON.parse(rawBody) : null; } catch { /* corps non-JSON, géré ci-dessous */ }

    if (!res.ok || !data) {
        const detail = data?.message || data?.error || data?.errors || (rawBody && rawBody.length < 300 ? rawBody : null);
        await logError('PVIT_TRANSFER', detail ? String(detail) : `HTTP ${res.status}`, {
            httpStatus: res.status,
            rawBody: rawBody?.slice(0, 2000),
            requestReference: params.reference,
            network: params.network,
        });
        throw new Error(detail ? `PVit : ${detail}` : `PVit a refusé la demande de transfert (HTTP ${res.status}).`);
    }
    return data;
}
