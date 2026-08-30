import { getTransactionCategory, getTransactionTitle } from '../transactionLabels';

describe('transactionLabels', () => {
    describe('getTransactionTitle', () => {
        it.each([
            ['VAULT_DEP_v1', 'Dépôt Caisse Commune'],
            ['VAULT_OUT_v1', 'Retrait Caisse Commune'],
            ['VAULT_VOUCHER_v1', 'Bon Caisse Commune dépensé'],
            ['TONT_DBT_G1_C1_U1_abc', 'Cotisation Tontine'],
            ['TONT_PAY_G1_C1_U1', 'Cagnotte Tontine reçue'],
            ['TONT_EXIT_G1_U1', 'Règlement dette Tontine'],
            ['MPAYOUT-p1', 'Reversement marchand'],
            ['FEE-TLP-contrib_1', 'Frais de service'],
            ['SERVICE-ELECTRICITY-ABC123', 'Facture Électricité'],
            ['SERVICE-WATER-ABC123', 'Facture Eau'],
            ['SERVICE-AIRTIME-ABC123', 'Crédit téléphonique'],
            ['SERVICE-TV-ABC123', 'Abonnement TV'],
        ])('labels reference %s as %s', (reference, expected) => {
            expect(getTransactionTitle({ reference, type: 'outgoing' })).toBe(expected);
        });

        it('falls back to a generic transfer label for an unrecognized reference', () => {
            expect(getTransactionTitle({ reference: 'REF123', type: 'outgoing' })).toBe('Transfert envoyé');
            expect(getTransactionTitle({ reference: 'REF123', type: 'incoming' })).toBe('Transfert reçu');
        });
    });

    describe('getTransactionCategory', () => {
        it.each([
            ['VAULT_DEP_v1', 'VAULT'],
            ['VAULT_OUT_v1', 'VAULT'],
            ['TONT_DBT_G1_C1_U1', 'TONTINE'],
            ['FEE-TLP-c1', 'FEE'],
            ['MPAYOUT-p1', 'MERCHANT'],
            ['SERVICE-ELECTRICITY-x', 'SERVICE'],
            ['REF123', 'TRANSFER'],
        ])('categorizes reference %s as %s', (reference, expected) => {
            expect(getTransactionCategory({ reference, type: 'outgoing' })).toBe(expected);
        });
    });
});
