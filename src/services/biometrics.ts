import * as LocalAuthentication from 'expo-local-authentication';

export async function verifyBiometricsOrPin(): Promise<{ success: boolean; useBiometrics: boolean; pin?: string; error?: string }> {
    try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            return {
                success: false,
                useBiometrics: false,
                error: 'La biométrie n\'est pas disponible ou paramétrée sur cet appareil.'
            };
        }

        const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Confirmez l\'opération (Face ID / Empreinte)',
            fallbackLabel: 'Utiliser le code PIN',
            disableDeviceFallback: false,
        });

        if (auth.success) {
            return { success: true, useBiometrics: true };
        } else {
            return { success: false, useBiometrics: false, error: 'Authentification annulée ou échouée.' };
        }
    } catch (e: any) {
        return { success: false, useBiometrics: false, error: e.message };
    }
}
