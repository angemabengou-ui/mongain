jest.mock('expo-local-authentication', () => ({
    hasHardwareAsync: jest.fn(),
    isEnrolledAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
    setItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
    disableBiometricPin,
    enableBiometricPin,
    isBiometricHardwareAvailable,
    isBiometricPinEnabled,
    verifyBiometricsOrPin,
} from '../biometrics';

describe('biometrics service', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('isBiometricHardwareAvailable', () => {
        it('resolves true when hardware exists and is enrolled', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
            await expect(isBiometricHardwareAvailable()).resolves.toBe(true);
        });

        it('resolves false when hardware is missing', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
            await expect(isBiometricHardwareAvailable()).resolves.toBe(false);
        });

        it('resolves false when hardware exists but nothing is enrolled', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
            await expect(isBiometricHardwareAvailable()).resolves.toBe(false);
        });

        it('resolves false (does not throw) when the native call rejects', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockRejectedValue(new Error('native error'));
            await expect(isBiometricHardwareAvailable()).resolves.toBe(false);
        });
    });

    describe('isBiometricPinEnabled', () => {
        it('resolves true when the stored flag is "1"', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('1');
            await expect(isBiometricPinEnabled()).resolves.toBe(true);
        });

        it('resolves false when the stored flag is missing/other', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
            await expect(isBiometricPinEnabled()).resolves.toBe(false);
        });

        it('resolves false (does not throw) when SecureStore rejects', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('keystore error'));
            await expect(isBiometricPinEnabled()).resolves.toBe(false);
        });
    });

    describe('enableBiometricPin', () => {
        it('stores the pin (protected) and sets the enabled flag when hardware is available', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
            (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

            const result = await enableBiometricPin('1234');

            expect(result).toBe(true);
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
                'mongain_biometric_pin',
                '1234',
                expect.objectContaining({ requireAuthentication: true })
            );
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mongain_biometric_pin_enabled', '1');
        });

        it('returns false without storing anything when hardware is unavailable', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

            const result = await enableBiometricPin('1234');

            expect(result).toBe(false);
            expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
        });

        it('returns false when SecureStore throws while saving', async () => {
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
            (SecureStore.setItemAsync as jest.Mock).mockRejectedValue(new Error('write failed'));

            await expect(enableBiometricPin('1234')).resolves.toBe(false);
        });
    });

    describe('disableBiometricPin', () => {
        it('deletes both the cached pin and the enabled flag', async () => {
            (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
            await disableBiometricPin();
            expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('mongain_biometric_pin');
            expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('mongain_biometric_pin_enabled');
        });

        it('does not throw when a delete call rejects', async () => {
            (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('delete failed'));
            await expect(disableBiometricPin()).resolves.toBeUndefined();
        });
    });

    describe('verifyBiometricsOrPin', () => {
        it('fails when biometric pin has not been enabled yet', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null); // FLAG_KEY check
            const res = await verifyBiometricsOrPin();
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/pas encore activé/);
        });

        it('fails when biometric hardware is unavailable', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('1'); // enabled flag
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);

            const res = await verifyBiometricsOrPin();
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/biométrie n'est pas disponible/);
        });

        it('succeeds and returns the cached pin after a successful biometric prompt', async () => {
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('1') // enabled flag
                .mockResolvedValueOnce('9876'); // cached pin
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

            const res = await verifyBiometricsOrPin();
            expect(res.success).toBe(true);
            expect(res.pin).toBe('9876');
        });

        it('fails when the protected read returns no pin (auth cancelled)', async () => {
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('1') // enabled flag
                .mockResolvedValueOnce(null); // cancelled biometric prompt
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

            const res = await verifyBiometricsOrPin();
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/annulée ou échouée/);
        });

        it('surfaces the native error message when the prompt throws', async () => {
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('1')
                .mockRejectedValueOnce(new Error('biometric hardware busy'));
            (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
            (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

            const res = await verifyBiometricsOrPin();
            expect(res.success).toBe(false);
            expect(res.error).toBe('biometric hardware busy');
        });
    });
});
