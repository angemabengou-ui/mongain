const mockCreate = jest.fn();
jest.mock('twilio', () => jest.fn(() => ({ messages: { create: mockCreate } })));

describe('sendSms', () => {
    const OLD_ENV = process.env;
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.resetModules();
        mockCreate.mockReset();
        process.env = { ...OLD_ENV };
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    afterAll(() => {
        process.env = OLD_ENV;
    });

    it('devrait simuler l\'envoi et retourner true quand SMS_ENABLED n\'est pas "true"', async () => {
        delete process.env.SMS_ENABLED;
        const { sendSms } = require('../sms');

        const result = await sendSms('+24177777777', 'Message de test');

        expect(result).toBe(true);
        expect(mockCreate).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('devrait simuler l\'envoi même si SMS_ENABLED=true mais sans identifiants Twilio', async () => {
        process.env.SMS_ENABLED = 'true';
        delete process.env.TWILIO_ACCOUNT_SID;
        delete process.env.TWILIO_AUTH_TOKEN;
        const { sendSms } = require('../sms');

        const result = await sendSms('+24177777777', 'Message de test');

        expect(result).toBe(true);
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('devrait envoyer un SMS réel via Twilio quand tout est configuré', async () => {
        process.env.SMS_ENABLED = 'true';
        process.env.TWILIO_ACCOUNT_SID = 'ACtest';
        process.env.TWILIO_AUTH_TOKEN = 'tokentest';
        process.env.TWILIO_PHONE_NUMBER = '+10000000000';
        mockCreate.mockResolvedValue({ sid: 'SM123' });
        const { sendSms } = require('../sms');

        const result = await sendSms('+24177777777', 'Bonjour');

        expect(result).toBe(true);
        expect(mockCreate).toHaveBeenCalledWith({ body: 'Bonjour', from: '+10000000000', to: '+24177777777' });
    });

    it('devrait propager l\'erreur si l\'appel Twilio échoue', async () => {
        process.env.SMS_ENABLED = 'true';
        process.env.TWILIO_ACCOUNT_SID = 'ACtest';
        process.env.TWILIO_AUTH_TOKEN = 'tokentest';
        process.env.TWILIO_PHONE_NUMBER = '+10000000000';
        mockCreate.mockRejectedValue(new Error('Twilio indisponible'));
        const { sendSms } = require('../sms');

        await expect(sendSms('+24177777777', 'Bonjour')).rejects.toThrow('Twilio indisponible');
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
