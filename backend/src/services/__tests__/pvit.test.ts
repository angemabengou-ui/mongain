import { logError } from '../../utils/errorLog';
import {
    initiatePvitPayment,
    initiatePvitTransfer,
    isPvitConfigured,
    toPvitCustomerAccountNumber,
} from '../pvit';

jest.mock('../../utils/errorLog', () => ({
    logError: jest.fn(),
}));

const fullSettings = {
    pvitSecretKey: 'secret',
    pvitCodeUrlPayment: 'code123',
    pvitMerchantOperationAccountCode: 'merch123',
    pvitCallbackUrlCode: 'cb123',
};

describe('isPvitConfigured', () => {
    it('devrait retourner true si tous les champs requis sont présents', () => {
        expect(isPvitConfigured(fullSettings)).toBe(true);
    });

    it('devrait retourner false si pvitSecretKey manque', () => {
        expect(isPvitConfigured({ ...fullSettings, pvitSecretKey: null })).toBe(false);
    });

    it('devrait retourner false si pvitCodeUrlPayment manque', () => {
        expect(isPvitConfigured({ ...fullSettings, pvitCodeUrlPayment: undefined })).toBe(false);
    });

    it('devrait retourner false si pvitMerchantOperationAccountCode manque', () => {
        expect(isPvitConfigured({ ...fullSettings, pvitMerchantOperationAccountCode: null })).toBe(false);
    });

    it('devrait retourner false si pvitCallbackUrlCode manque', () => {
        expect(isPvitConfigured({ ...fullSettings, pvitCallbackUrlCode: null })).toBe(false);
    });

    it('devrait retourner false pour un objet vide', () => {
        expect(isPvitConfigured({})).toBe(false);
    });
});

describe('toPvitCustomerAccountNumber', () => {
    it('devrait convertir un numéro +241 en format local avec 0 initial', () => {
        expect(toPvitCustomerAccountNumber('+24177123456')).toBe('077123456');
    });

    it('devrait garder le 0 initial si déjà présent après retrait du préfixe', () => {
        expect(toPvitCustomerAccountNumber('+241077123456')).toBe('077123456');
    });

    it('devrait retirer les espaces', () => {
        expect(toPvitCustomerAccountNumber('+241 77 123 456')).toBe('077123456');
    });

    it('devrait ajouter un 0 si le numéro ne commence pas déjà par +241', () => {
        expect(toPvitCustomerAccountNumber('77123456')).toBe('077123456');
    });
});

describe('initiatePvitPayment', () => {
    const params = {
        amount: 5000,
        reference: 'REF-1',
        customerAccountNumber: '077123456',
        network: 'AIRTEL' as const,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).fetch = jest.fn();
    });

    it('devrait lever une exception si PVit n\'est pas configuré', async () => {
        await expect(initiatePvitPayment({}, params)).rejects.toThrow('PVit non configuré.');
    });

    it('devrait retourner les données JSON en cas de succès', async () => {
        const responseData = { status: 'SUCCESS', status_code: '00', operator: 'AIRTEL_MONEY', reference_id: 'r1', merchant_reference_id: 'REF-1', message: 'ok' };
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),
        });

        const result = await initiatePvitPayment(fullSettings, params);

        expect(result).toEqual(responseData);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://api.mypvit.pro/v2/code123/rest',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'X-Secret': 'secret' }),
            })
        );
        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.transaction_type).toBe('PAYMENT');
        expect(body.operator_code).toBe('AIRTEL_MONEY');
    });

    it('devrait lever une exception si fetch échoue (erreur réseau)', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));

        await expect(initiatePvitPayment(fullSettings, params)).rejects.toThrow('Impossible de contacter PVit. Réessayez dans un instant.');
    });

    it('devrait lever une exception détaillée et journaliser si res.ok est false', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 400,
            text: jest.fn().mockResolvedValue(JSON.stringify({ message: 'Solde marchand insuffisant' })),
        });

        await expect(initiatePvitPayment(fullSettings, params)).rejects.toThrow('PVit : Solde marchand insuffisant');
        expect(logError).toHaveBeenCalledWith('PVIT_PAYMENT', 'Solde marchand insuffisant', expect.objectContaining({ httpStatus: 400 }));
    });

    it('devrait lever une exception avec le code HTTP si le corps n\'est pas du JSON valide', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
            text: jest.fn().mockResolvedValue('Internal Server Error'),
        });

        await expect(initiatePvitPayment(fullSettings, params)).rejects.toThrow('PVit : Internal Server Error');
    });

    it('devrait lever une exception générique si res.ok mais corps vide', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(''),
        });

        await expect(initiatePvitPayment(fullSettings, params)).rejects.toThrow('PVit a refusé la demande (HTTP 200).');
    });

    it('devrait lever une exception et journaliser si HTTP 200 mais status indique un rejet', async () => {
        const responseData = { status: 'FAILED', status_code: '05', operator: 'AIRTEL_MONEY', reference_id: 'r1', merchant_reference_id: 'REF-1', message: 'Solde insuffisant côté PVit' };
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),
        });

        await expect(initiatePvitPayment(fullSettings, params)).rejects.toThrow('PVit : Solde insuffisant côté PVit');
        expect(logError).toHaveBeenCalledWith('PVIT_PAYMENT', expect.stringContaining('FAILED'), expect.objectContaining({ pvitStatus: 'FAILED' }));
    });
});

describe('initiatePvitTransfer', () => {
    const params = {
        amount: 3000,
        reference: 'REF-2',
        customerAccountNumber: '077123456',
        network: 'MOOV' as const,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (global as any).fetch = jest.fn();
    });

    it('devrait lever une exception si PVit n\'est pas configuré', async () => {
        await expect(initiatePvitTransfer({}, params)).rejects.toThrow('PVit non configuré.');
    });

    it('devrait retourner les données JSON en cas de succès avec transaction_type TRANSFER', async () => {
        const responseData = { status: 'SUCCESS', status_code: '00', operator: 'MOOV_MONEY', reference_id: 'r2', merchant_reference_id: 'REF-2', message: 'ok' };
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            status: 200,
            text: jest.fn().mockResolvedValue(JSON.stringify(responseData)),
        });

        const result = await initiatePvitTransfer(fullSettings, params);

        expect(result).toEqual(responseData);
        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(body.transaction_type).toBe('TRANSFER');
        expect(body.operator_code).toBe('MOOV_MONEY');
    });

    it('devrait lever une exception si fetch échoue (erreur réseau)', async () => {
        (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));

        await expect(initiatePvitTransfer(fullSettings, params)).rejects.toThrow('Impossible de contacter PVit. Réessayez dans un instant.');
    });

    it('devrait lever une exception détaillée et journaliser en cas d\'échec HTTP', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 403,
            text: jest.fn().mockResolvedValue(JSON.stringify({ error: 'Compte bloqué' })),
        });

        await expect(initiatePvitTransfer(fullSettings, params)).rejects.toThrow('PVit : Compte bloqué');
        expect(logError).toHaveBeenCalledWith('PVIT_TRANSFER', 'Compte bloqué', expect.objectContaining({ httpStatus: 403 }));
    });
});
