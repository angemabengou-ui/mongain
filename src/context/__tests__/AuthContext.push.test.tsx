// Couvre la branche ANDROID de registerForPushNotificationsAsync (AuthContext.tsx) : création
// du canal 'transactions-v2' puis envoi du token au backend. Cette branche n'est JAMAIS
// exercée dans AuthContext.test.tsx, qui mocke expo-device à isDevice: false précisément pour
// l'éviter — et même avec isDevice: true, Platform.OS vaut 'ios' par défaut sous jest-expo
// (voir api.test.ts), donc `if (Platform.OS === 'android')` ne s'exécuterait toujours pas.
// Fichier séparé (même convention que api.web.test.ts) car mocker
// react-native/Libraries/Utilities/Platform affecte tous les imports du fichier.
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
    __esModule: true,
    default: {
        OS: 'android',
        select: (obj: any) => obj.android ?? obj.default,
    },
}));

jest.mock('socket.io-client', () => ({
    io: jest.fn(() => ({
        on: jest.fn(),
        disconnect: jest.fn(),
        emit: jest.fn(),
    })),
}));

jest.mock('expo-notifications', () => ({
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(),
    AndroidImportance: { MAX: 5 },
    getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
    getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test]' })),
}));

jest.mock('expo-device', () => ({
    // Contrairement à AuthContext.test.tsx : un vrai appareil ici, pour dérouler tout le
    // chemin permission → token → apiUpdatePushToken.
    isDevice: true,
    isRootedExperimentalAsync: jest.fn(async () => false),
}));

jest.mock('expo-constants', () => ({
    __esModule: true,
    default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } }, easConfig: {} },
}));

jest.mock('../../services/api', () => ({
    BASE_URL: 'http://test.local',
    apiGetMe: jest.fn(),
    apiGetSystemSettings: jest.fn(),
    apiLogin: jest.fn(),
    apiLogoutServer: jest.fn(),
    apiRegister: jest.fn(),
    apiUpdatePushToken: jest.fn(),
    apiVerifyLoginOtp: jest.fn(),
    deleteRefreshToken: jest.fn(),
    deleteToken: jest.fn(),
    getToken: jest.fn(),
    saveRefreshToken: jest.fn(),
    saveToken: jest.fn(),
    setUnauthorizedHandler: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as api from '../../services/api';
import { AuthProvider, useAuth } from '../AuthContext';

const mockUser = (overrides: Partial<any> = {}) => ({
    id: '1', name: 'Jean', username: 'jean01', phone: '+24177000000', wallet: null, ...overrides,
});

function TestConsumer() {
    const { isLoading, login } = useAuth();
    return (
        <>
            <Text testID="loading">{String(isLoading)}</Text>
            <TouchableOpacity testID="login-btn" onPress={() => login('+24177000000', '1234')} />
        </>
    );
}

const renderWithProvider = () => render(
    <AuthProvider>
        <TestConsumer />
    </AuthProvider>
);

describe('AuthContext — enregistrement push sur Android (Device.isDevice + Platform.OS mockés)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (api.getToken as jest.Mock).mockResolvedValue(null);
        (api.apiGetSystemSettings as jest.Mock).mockResolvedValue({});
        (api.apiLogin as jest.Mock).mockResolvedValue({ token: 'new-tok', user: mockUser() });
        // Sans ceci, apiUpdatePushToken() (jest.fn() nu) renvoie `undefined`, et le
        // `.catch(() => {})` best-effort de AuthContext.tsx plante sur `undefined.catch` — ce
        // chemin n'est jamais atteint dans AuthContext.test.tsx (isDevice: false là-bas).
        (api.apiUpdatePushToken as jest.Mock).mockResolvedValue({ message: 'ok' });
    });

    it('crée le canal transactions-v2 avec son explicite AVANT de demander la permission, puis envoie le token au backend', async () => {
        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('login-btn'));

        await waitFor(() => expect(api.apiUpdatePushToken).toHaveBeenCalledWith('ExponentPushToken[test]'));

        // Régression pour le piège de versionnage de canal documenté dans AuthContext.tsx :
        // un canal Android ne peut avoir son 'sound' fixé qu'à sa création. Si ce test se met
        // à échouer parce que l'ID est redevenu 'default'/'transactions' ou que 'sound' a
        // disparu des options, c'est qu'on a réintroduit exactement le bug qui rendait les
        // téléphones déjà installés muets à vie pour ce canal.
        expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
            'transactions-v2',
            expect.objectContaining({ sound: 'default', importance: Notifications.AndroidImportance.MAX }),
        );

        // Ordre important (doc SDK 57) : le prompt de permission POST_NOTIFICATIONS
        // n'apparaît sur Android 13+ qu'une fois un canal déjà créé — inverser l'ordre romprait
        // silencieusement ce prompt sur les appareils réels sans qu'aucun test naïf ne le
        // détecte (getPermissionsAsync/requestPermissionsAsync sont mockés ici et répondent
        // toujours, qu'un canal existe ou non).
        const channelCallOrder = (Notifications.setNotificationChannelAsync as jest.Mock).mock.invocationCallOrder[0];
        const permCallOrder = (Notifications.getPermissionsAsync as jest.Mock).mock.invocationCallOrder[0];
        expect(channelCallOrder).toBeLessThan(permCallOrder);
    });

    it("n'envoie aucun token au backend si l'utilisateur refuse la permission de notification", async () => {
        (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
        (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('login-btn'));

        await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalled());

        // Best-effort, comme le commentaire de AuthContext.tsx le documente : un refus de
        // permission doit couper court AVANT tout appel token/API, jamais échouer bruyamment.
        expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
        expect(api.apiUpdatePushToken).not.toHaveBeenCalled();
    });
});
