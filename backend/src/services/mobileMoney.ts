
/**
 * TELECOM GATEWAY ENGINE - MONGAIN V5
 * Interface unifiée (Adapter Pattern) pour l'abstraction des opérateurs Mobile Money africains.
 * 
 * L'objectif est de permettre à `wallet.ts` (ou `services.ts`) de déclencher 
 * un PULL (Dépôt) ou un PUSH (Retrait) sans se soucier de si l'utilisateur est sur Airtel ou Moov.
 */

export interface MobileMoneyResponse {
    success: boolean;
    reference: string;
    message: string;
    status: 'PENDING' | 'SUCCESS' | 'FAILED';
    networkFee?: number;
}

export abstract class TelecomProvider {
    abstract name: string;
    abstract currency: string;

    /**
     * DÉPÔT (PULL) : Demande à l'Opérateur de prélever l'argent du client (Le client reçoit un pop-up USSD)
     */
    abstract initiateDeposit(phone: string, amount: number): Promise<MobileMoneyResponse>;

    /**
     * RETRAIT (PUSH) : Demande à l'Opérateur d'envoyer l'argent depuis la banque Mongain vers le numéro du client
     */
    abstract initiateWithdraw(phone: string, amount: number): Promise<MobileMoneyResponse>;

    /**
     * Vérifie le statut d'une transaction asynchrone (ex: Airtel MoMopay)
     */
    abstract checkTransactionStatus(reference: string): Promise<MobileMoneyResponse>;
}

// ----------------------------------------------------------------------
// IMPLEMENTATION : MOOV AFRICA (GABON)
// ----------------------------------------------------------------------
export class MoovGateway extends TelecomProvider {
    name = "MOOV_AFRICA";
    currency = "XAF";

    async initiateDeposit(phone: string, amount: number): Promise<MobileMoneyResponse> {
        console.log(`[MOOV] Simulation de dépôt PULL USSD vers le numéro ${phone} pour ${amount} FCFA.`);
        // Placeholder pour l'appel Axios vers Moov Flooz API
        return {
            success: true,
            status: 'PENDING',
            reference: `MOOV-${Date.now()}`,
            message: 'Appel USSD déclenché sur le téléphone du client.'
        };
    }

    async initiateWithdraw(phone: string, amount: number): Promise<MobileMoneyResponse> {
        console.log(`[MOOV] Simulation de transfert PUSH vers le numéro ${phone} pour ${amount} FCFA.`);
        return {
            success: true,
            status: 'SUCCESS',
            reference: `MOOV-OUT-${Date.now()}`,
            message: 'Le compte Moov du client a été crédité.'
        };
    }

    async checkTransactionStatus(ref: string): Promise<MobileMoneyResponse> {
        return { success: true, status: 'SUCCESS', reference: ref, message: 'Approuvé' };
    }
}

// ----------------------------------------------------------------------
// IMPLEMENTATION : AIRTEL MONEY (GABON)
// ----------------------------------------------------------------------
export class AirtelGateway extends TelecomProvider {
    name = "AIRTEL_MONEY";
    currency = "XAF";

    async initiateDeposit(phone: string, amount: number): Promise<MobileMoneyResponse> {
        console.log(`[AIRTEL] Simulation de requête OpenAPI vers Airtel Money (PULL). Numéro: ${phone}`);
        return {
            success: true,
            status: 'PENDING',
            reference: `AIRTEL-${Date.now()}`,
            message: 'En attente de la validation PIN du client.'
        };
    }

    async initiateWithdraw(phone: string, amount: number): Promise<MobileMoneyResponse> {
        console.log(`[AIRTEL] Simulation de décaissement (PUSH). B2C vers ${phone}`);
        return {
            success: true,
            status: 'SUCCESS',
            reference: `AIRTEL-OUT-${Date.now()}`,
            message: 'Transfert effectué vers le portefeuille Airtel.'
        };
    }

    async checkTransactionStatus(ref: string): Promise<MobileMoneyResponse> {
        return { success: true, status: 'SUCCESS', reference: ref, message: 'Approuvé' };
    }
}

export class TelecomGatewayManager {
    static getProvider(phone: string, requestedNetwork?: 'AIRTEL' | 'MOOV'): TelecomProvider {
        // En vrai production, un algorithme détecte le réseau (077/074 = Airtel, 066/062 = Moov)
        if (requestedNetwork === 'MOOV' || phone.startsWith('06')) {
            return new MoovGateway();
        }
        return new AirtelGateway(); // Par défaut ou 077/074
    }
}
