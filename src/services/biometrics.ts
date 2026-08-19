import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

// Le serveur ne fait jamais confiance à un simple booléen "useBiometrics" envoyé par le
// client (faille corrigée côté backend : voir backend/src/routes/wallet.ts). À la place,
// le code PIN réel est mis en cache localement dans le Keychain/Keystore, protégé par une
// authentification biométrique obligatoire à la lecture (option `requireAuthentication` de
// SecureStore). Le déverrouillage biométrique ne fait donc que révéler le vrai PIN, qui est
// ensuite envoyé et vérifié côté serveur comme n'importe quel PIN saisi manuellement.
const PIN_KEY = 'mongain_biometric_pin';
const FLAG_KEY = 'mongain_biometric_pin_enabled';

export async function isBiometricHardwareAvailable(): Promise<boolean> {
    try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        return hasHardware && isEnrolled;
    } catch {
        return false;
    }
}

export async function isBiometricPinEnabled(): Promise<boolean> {
    try {
        return (await SecureStore.getItemAsync(FLAG_KEY)) === '1';
    } catch {
        return false;
    }
}

// À appeler juste après une confirmation PIN manuelle réussie, pour proposer le
// déverrouillage biométrique lors des prochaines opérations.
export async function enableBiometricPin(pin: string): Promise<boolean> {
    try {
        if (!(await isBiometricHardwareAvailable())) return false;
        await SecureStore.setItemAsync(PIN_KEY, pin, {
            requireAuthentication: true,
            authenticationPrompt: 'Confirmez pour activer le déverrouillage biométrique',
        } as SecureStore.SecureStoreOptions);
        await SecureStore.setItemAsync(FLAG_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

// À appeler quand le PIN change (pin-change.tsx, réinitialisation) : le PIN mis en cache
// serait sinon obsolète et ferait échouer toutes les opérations biométriques suivantes.
export async function disableBiometricPin(): Promise<void> {
    await SecureStore.deleteItemAsync(PIN_KEY).catch(() => { });
    await SecureStore.deleteItemAsync(FLAG_KEY).catch(() => { });
}

export async function verifyBiometricsOrPin(): Promise<{ success: boolean; pin?: string; error?: string }> {
    try {
        if (!(await isBiometricPinEnabled())) {
            return { success: false, error: 'Le déverrouillage biométrique n\'est pas encore activé. Utilisez votre code PIN.' };
        }
        if (!(await isBiometricHardwareAvailable())) {
            return { success: false, error: 'La biométrie n\'est pas disponible ou paramétrée sur cet appareil.' };
        }

        // La simple lecture de cet élément protégé déclenche l'invite biométrique du
        // système (Face ID / empreinte / verrouillage appareil).
        const pin = await SecureStore.getItemAsync(PIN_KEY, {
            requireAuthentication: true,
            authenticationPrompt: 'Confirmez l\'opération (Face ID / Empreinte)',
        } as SecureStore.SecureStoreOptions);

        if (!pin) return { success: false, error: 'Authentification annulée ou échouée.' };
        return { success: true, pin };
    } catch (e: any) {
        return { success: false, error: e.message || 'Authentification biométrique impossible.' };
    }
}
