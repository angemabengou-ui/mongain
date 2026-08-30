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
    // Not a physical device in the test runner -> registerForPushNotificationsAsync
    // short-circuits before calling any Notifications permission APIs.
    isDevice: false,
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
import React, { useState } from 'react';
import { Alert, Text, TouchableOpacity } from 'react-native';
import * as Device from 'expo-device';
import * as api from '../../services/api';
import { AuthProvider, useAuth } from '../AuthContext';

const mockUser = (overrides: Partial<any> = {}) => ({
    id: '1', name: 'Jean', username: 'jean01', phone: '+24177000000', wallet: null, ...overrides,
});

function TestConsumer() {
    const { user, token, isLoading, login, logout, verifyLoginOtp, register } = useAuth();
    const [loginResult, setLoginResult] = useState<any>(null);

    return (
        <>
            <Text testID="loading">{String(isLoading)}</Text>
            <Text testID="user">{user ? user.name : 'none'}</Text>
            <Text testID="token">{token || 'none'}</Text>
            <Text testID="login-result">{loginResult ? JSON.stringify(loginResult) : 'none'}</Text>
            <TouchableOpacity testID="login-btn" onPress={async () => setLoginResult(await login('+24177000000', '1234'))} />
            <TouchableOpacity testID="logout-btn" onPress={() => logout()} />
            <TouchableOpacity testID="verify-otp-btn" onPress={() => verifyLoginOtp('+24177000000', '9999')} />
            <TouchableOpacity testID="register-btn" onPress={() => register('Jean', 'jean01', '+24177000000', '1234', '9999')} />
        </>
    );
}

const renderWithProvider = () => render(
    <AuthProvider>
        <TestConsumer />
    </AuthProvider>
);

describe('AuthContext', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        (api.getToken as jest.Mock).mockResolvedValue(null);
        (api.apiGetSystemSettings as jest.Mock).mockResolvedValue({ airtelEnabled: true });
        // Every logged-in test triggers the socket/push-notification effect, which
        // console.warns because expo-device is mocked as a non-physical device — expected
        // and irrelevant to what these tests assert, so keep it out of the test output.
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('useAuth throws when used outside an AuthProvider', async () => {
        // Swallow the expected React error-boundary console output for this one assertion.
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const Bare = () => { useAuth(); return null; };
        // render() is async in this testing-library version, so the throw surfaces as a
        // rejected promise rather than a synchronous throw.
        await expect(render(<Bare />)).rejects.toThrow('useAuth doit être utilisé dans un AuthProvider');
        spy.mockRestore();
    });

    it('starts with no session, then flips isLoading to false when no token is stored', async () => {
        await renderWithProvider();

        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
        expect(screen.getByTestId('user').props.children).toBe('none');
        expect(screen.getByTestId('token').props.children).toBe('none');
        expect(api.getToken).toHaveBeenCalled();
    });

    it('warns (without blocking) when Device.isRootedExperimentalAsync detects a rooted/jailbroken device', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        (Device.isRootedExperimentalAsync as jest.Mock).mockResolvedValueOnce(true);

        await renderWithProvider();

        await waitFor(() => expect(alertSpy).toHaveBeenCalled());
        // Non bloquant : la session se restaure normalement malgré l'avertissement.
        expect(screen.getByTestId('loading').props.children).toBe('false');
        alertSpy.mockRestore();
    });

    it('does not warn when the device is not detected as rooted/jailbroken', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        expect(alertSpy).not.toHaveBeenCalled();
        alertSpy.mockRestore();
    });

    it('restores the session from a stored token on mount', async () => {
        (api.getToken as jest.Mock).mockResolvedValue('stored-tok');
        (api.apiGetMe as jest.Mock).mockResolvedValue(mockUser({ name: 'Restored User' }));

        await renderWithProvider();

        await waitFor(() => expect(screen.getByTestId('user').props.children).toBe('Restored User'));
        expect(screen.getByTestId('token').props.children).toBe('stored-tok');
        expect(screen.getByTestId('loading').props.children).toBe('false');
        expect(api.apiGetSystemSettings).toHaveBeenCalled();
    });

    it('clears an invalid stored token when restoring the session fails', async () => {
        (api.getToken as jest.Mock).mockResolvedValue('stale-tok');
        (api.apiGetMe as jest.Mock).mockRejectedValue(new Error('401'));

        await renderWithProvider();

        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
        expect(screen.getByTestId('user').props.children).toBe('none');
        expect(screen.getByTestId('token').props.children).toBe('none');
        expect(api.deleteToken).toHaveBeenCalled();
    });

    it('login() stores the token/user and reports success', async () => {
        (api.apiLogin as jest.Mock).mockResolvedValue({ token: 'new-tok', user: mockUser() });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('login-btn'));

        await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('new-tok'));
        expect(screen.getByTestId('user').props.children).toBe('Jean');
        expect(screen.getByTestId('login-result').props.children).toBe(JSON.stringify({ success: true }));
        expect(api.saveToken).toHaveBeenCalledWith('new-tok');
    });

    it('login() surfaces requireOtp without setting a session', async () => {
        (api.apiLogin as jest.Mock).mockResolvedValue({ requireOtp: true });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('login-btn'));

        await waitFor(() => expect(screen.getByTestId('login-result').props.children).toBe(JSON.stringify({ requireOtp: true })));
        expect(screen.getByTestId('token').props.children).toBe('none');
        expect(screen.getByTestId('user').props.children).toBe('none');
        expect(api.saveToken).not.toHaveBeenCalled();
    });

    it('verifyLoginOtp() stores the token/user returned by the backend', async () => {
        (api.apiVerifyLoginOtp as jest.Mock).mockResolvedValue({ token: 'otp-tok', refreshToken: 'otp-refresh', user: mockUser({ name: 'OTP User' }) });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('verify-otp-btn'));

        await waitFor(() => expect(screen.getByTestId('user').props.children).toBe('OTP User'));
        expect(screen.getByTestId('token').props.children).toBe('otp-tok');
        expect(api.saveToken).toHaveBeenCalledWith('otp-tok');
        expect(api.saveRefreshToken).toHaveBeenCalledWith('otp-refresh');
    });

    it('register() stores the token/user returned by the backend', async () => {
        (api.apiRegister as jest.Mock).mockResolvedValue({ token: 'reg-tok', refreshToken: 'reg-refresh', user: mockUser({ name: 'New User' }) });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));

        fireEvent.press(screen.getByTestId('register-btn'));

        await waitFor(() => expect(screen.getByTestId('user').props.children).toBe('New User'));
        expect(screen.getByTestId('token').props.children).toBe('reg-tok');
        expect(api.saveRefreshToken).toHaveBeenCalledWith('reg-refresh');
    });

    it('logout() revokes the server session and clears the local session', async () => {
        (api.apiLogin as jest.Mock).mockResolvedValue({ token: 'new-tok', user: mockUser() });
        (api.apiLogoutServer as jest.Mock).mockResolvedValue({ message: 'Déconnecté.' });

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
        fireEvent.press(screen.getByTestId('login-btn'));
        await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('new-tok'));

        fireEvent.press(screen.getByTestId('logout-btn'));

        await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('none'));
        expect(screen.getByTestId('user').props.children).toBe('none');
        expect(api.apiLogoutServer).toHaveBeenCalled();
        expect(api.deleteToken).toHaveBeenCalled();
        expect(api.deleteRefreshToken).toHaveBeenCalled();
    });

    it('logout() still clears the local session when server revocation fails (offline)', async () => {
        (api.apiLogin as jest.Mock).mockResolvedValue({ token: 'new-tok', user: mockUser() });
        (api.apiLogoutServer as jest.Mock).mockRejectedValue(new Error('Vous êtes hors ligne'));

        await renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('loading').props.children).toBe('false'));
        fireEvent.press(screen.getByTestId('login-btn'));
        await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('new-tok'));

        fireEvent.press(screen.getByTestId('logout-btn'));

        await waitFor(() => expect(screen.getByTestId('token').props.children).toBe('none'));
        expect(screen.getByTestId('user').props.children).toBe('none');
        expect(api.deleteToken).toHaveBeenCalled();
        expect(api.deleteRefreshToken).toHaveBeenCalled();
    });
});
