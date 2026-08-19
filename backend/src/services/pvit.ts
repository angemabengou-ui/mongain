// Client de l'API PVit (agrégateur de paiement Mobile Money/carte, mypvit.pro) — remplace
// l'ancien mobileMoney.ts qui ne faisait que simuler un succès sans jamais rien appeler en
// vrai. Référence : https://docs.mypvit.pro (section "Initier un paiement").
const PVIT_BASE_URL = 'https://api.mypvit.pro/v2';

const OPERATOR_CODES = {
    AIRTEL: 'AIRTEL_MONEY',
    MOOV: 'MOOV_MONEY',
} as const;

export type PVitNetwork = keyof typeof OPERATOR_CODES;

export function isPvitConfigured(): boolean {
    return !!(
        process.env.PVIT_SECRET_KEY &&
        process.env.PVIT_CODE_URL_PAYMENT &&
        process.env.PVIT_MERCHANT_OPERATION_ACCOUNT_CODE &&
        process.env.PVIT_CALLBACK_URL_CODE
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

export async function initiatePvitPayment(params: {
    amount: number;
    reference: string;
    customerAccountNumber: string;
    network: PVitNetwork;
}): Promise<PVitPaymentResponse> {
    if (!isPvitConfigured()) throw new Error('PVit non configuré.');

    let res: Response;
    try {
        res = await fetch(`${PVIT_BASE_URL}/${process.env.PVIT_CODE_URL_PAYMENT}/rest`, {
            method: 'POST',
            headers: {
                'X-Secret': process.env.PVIT_SECRET_KEY!,
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
                merchant_operation_account_code: process.env.PVIT_MERCHANT_OPERATION_ACCOUNT_CODE,
                callback_url_code: process.env.PVIT_CALLBACK_URL_CODE,
                owner_charge: 'CUSTOMER',
                owner_charge_operator: 'CUSTOMER',
            }),
        });
    } catch {
        throw new Error('Impossible de contacter PVit. Réessayez dans un instant.');
    }

    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data) {
        throw new Error(data?.message || `PVit a refusé la demande (HTTP ${res.status}).`);
    }
    return data;
}
