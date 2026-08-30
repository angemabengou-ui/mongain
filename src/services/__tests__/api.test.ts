jest.mock('expo-secure-store', () => ({
    setItemAsync: jest.fn(),
    getItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import {
    apiGetMe,
    apiGetSystemSettings,
    apiLogin,
    apiLogoutServer,
    apiLookupUser,
    apiRegister,
    apiRequestOtp,
    apiRequestResetOTP,
    apiResetPIN,
    apiTransfer,
    apiUpdatePushToken,
    apiVerifyAppLockPin,
    apiVerifyLoginOtp,
    BASE_URL,
    deleteRefreshToken,
    deleteToken,
    getRefreshToken,
    getToken,
    saveRefreshToken,
    saveToken,
    setUnauthorizedHandler,
} from '../api';

const mockFetch = (impl: () => Promise<any>) => {
    (global as any).fetch = jest.fn(impl);
};

const okResponse = (data: any, status = 200) => ({
    ok: true,
    status,
    json: async () => data,
});

const errResponse = (data: any, status = 400) => ({
    ok: false,
    status,
    json: async () => data,
});

describe('api service', () => {
    beforeEach(async () => {
        // resetAllMocks (not clearAllMocks) so that queued mockResolvedValueOnce
        // values from a previous test never leak into the next one.
        jest.resetAllMocks();
        // Reset to a no-op handler so 401 tests in other files/tests don't leak.
        setUnauthorizedHandler(() => {});
        // api.ts caches the token/refresh token in a module-level variable (avoids a
        // SecureStore round-trip on every request) — that cache outlives resetAllMocks(),
        // since it's plain module state, not a jest mock. Without clearing it here, whichever
        // test runs first to call saveToken()/getToken() poisons every later test in this
        // file: they'd silently get back that cached value instead of exercising their own
        // mocked SecureStore response.
        await deleteToken();
        await deleteRefreshToken();
    });

    // ─── Token storage (native branch — Platform.OS defaults to 'ios' under jest-expo) ───
    describe('token storage (native)', () => {
        it('saveToken stores the token via SecureStore', async () => {
            await saveToken('tok-123');
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mongain_token', 'tok-123');
        });

        it('getToken reads the token via SecureStore', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok-abc');
            const token = await getToken();
            expect(SecureStore.getItemAsync).toHaveBeenCalledWith('mongain_token');
            expect(token).toBe('tok-abc');
        });

        it('deleteToken removes the token via SecureStore', async () => {
            await deleteToken();
            expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('mongain_token');
        });
    });

    describe('refresh token storage (native)', () => {
        it('saveRefreshToken stores it via SecureStore under its own key', async () => {
            await saveRefreshToken('refresh-123');
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mongain_refresh_token', 'refresh-123');
        });

        it('getRefreshToken reads it via SecureStore under its own key', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-abc');
            const token = await getRefreshToken();
            expect(SecureStore.getItemAsync).toHaveBeenCalledWith('mongain_refresh_token');
            expect(token).toBe('refresh-abc');
        });

        it('deleteRefreshToken removes it via SecureStore', async () => {
            await deleteRefreshToken();
            expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('mongain_refresh_token');
        });

        it('saveRefreshToken silently no-ops on an undefined/null token instead of crashing SecureStore', async () => {
            // Reproduit le cas d'un backend qui ne renvoie pas encore refreshToken (ancien
            // déploiement) : SecureStore.setItemAsync rejette avec "Invalid value provided to
            // SecureStore" si on lui passe autre chose qu'une string, ce qui bloquait toute la
            // connexion/l'OTP au lieu de simplement se passer du refresh silencieux.
            await expect(saveRefreshToken(undefined)).resolves.toBeUndefined();
            await expect(saveRefreshToken(null)).resolves.toBeUndefined();
            expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
        });
    });

    // ─── Success responses ───
    describe('success responses', () => {
        it('apiLogin resolves with token/user on success', async () => {
            mockFetch(() => Promise.resolve(okResponse({ token: 't1', user: { id: '1', name: 'Jean', phone: '+24177000000', wallet: null } })));

            const res = await apiLogin('+24177000000', '1234');

            expect(res.token).toBe('t1');
            expect(res.user?.name).toBe('Jean');
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/auth/login`);
            expect(options.method).toBe('POST');
            expect(JSON.parse(options.body)).toEqual({ phone: '+24177000000', pin: '1234' });
            expect(options.headers['Content-Type']).toBe('application/json');
            // Unauthenticated endpoint: no Authorization header.
            expect(options.headers['Authorization']).toBeUndefined();
        });

        it('apiLogin resolves with requireOtp when backend asks for 2FA', async () => {
            mockFetch(() => Promise.resolve(okResponse({ requireOtp: true })));
            const res = await apiLogin('+24177000000', '1234');
            expect(res.requireOtp).toBe(true);
            expect(res.token).toBeUndefined();
        });

        it('apiRequestOtp posts the phone number', async () => {
            mockFetch(() => Promise.resolve(okResponse({ message: 'sent' })));
            const res = await apiRequestOtp('+24177000000');
            expect(res.message).toBe('sent');
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/auth/request-otp`);
            expect(JSON.parse(options.body)).toEqual({ phone: '+24177000000' });
        });

        it('apiRegister posts registration payload and resolves token/user', async () => {
            mockFetch(() => Promise.resolve(okResponse({ token: 't2', user: { id: '2', name: 'Marie', phone: '+24177000001', wallet: null } })));
            const res = await apiRegister('Marie', 'marie01', '+24177000001', '4321', '9999');
            expect(res.token).toBe('t2');
            const [, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(JSON.parse(options.body)).toEqual({
                name: 'Marie', username: 'marie01', phone: '+24177000001', pin: '4321', otpCode: '9999',
            });
        });

        it('apiVerifyLoginOtp resolves token/user', async () => {
            mockFetch(() => Promise.resolve(okResponse({ token: 't3', user: { id: '3', name: 'Paul', phone: '+24177000002', wallet: null } })));
            const res = await apiVerifyLoginOtp('+24177000002', '1111');
            expect(res.token).toBe('t3');
        });

        it('apiRequestResetOTP and apiResetPIN hit the expected endpoints', async () => {
            mockFetch(() => Promise.resolve(okResponse({ message: 'ok' })));
            await apiRequestResetOTP('+24177000003');
            expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${BASE_URL}/api/auth/request-reset-otp`);

            mockFetch(() => Promise.resolve(okResponse({ message: 'reset ok' })));
            await apiResetPIN('+24177000003', '2222', '5678');
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/auth/reset-pin`);
            // Régression : le backend attend `otpCode` (resetPinSchema, auth.ts), pas `otp` —
            // cette assertion verrouillait le mauvais nom de champ, qui faisait échouer TOUTE
            // réinitialisation de PIN en conditions réelles sans qu'aucun test ne le détecte.
            expect(JSON.parse(options.body)).toEqual({ phone: '+24177000003', otpCode: '2222', newPin: '5678' });
        });

        // Régression : POST /api/auth/verify-pin exige authMiddleware côté serveur (voir
        // auth.ts) — cet appel n'envoyait auparavant aucun token (4e argument `auth` de
        // request() omis), ce qui finissait par déconnecter l'utilisateur au lieu de
        // déverrouiller l'app, même avec le bon code PIN.
        it('apiVerifyAppLockPin posts the pin authenticated', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok-lock');
            mockFetch(() => Promise.resolve(okResponse({ success: true })));
            const res = await apiVerifyAppLockPin('1234');
            expect(res.success).toBe(true);
            const [, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(options.headers['Authorization']).toBe('Bearer tok-lock');
        });

        it('apiGetSystemSettings issues an unauthenticated GET', async () => {
            mockFetch(() => Promise.resolve(okResponse({ airtelEnabled: true, moovEnabled: false, seegEnabled: true, tontineEnabled: true, taxP2P: 1, taxWithdraw: 2 })));
            await apiGetSystemSettings();
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/settings`);
            expect(options.method).toBe('GET');
            expect(options.headers['Authorization']).toBeUndefined();
        });
    });

    // ─── Authenticated requests ───
    describe('authenticated requests', () => {
        it('attaches Authorization header when a token is stored', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok-xyz');
            mockFetch(() => Promise.resolve(okResponse({ id: '1', name: 'Jean', phone: '+24177000000', wallet: null })));

            await apiGetMe();

            const [, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(options.headers['Authorization']).toBe('Bearer tok-xyz');
        });

        it('does not attach Authorization header when no token is stored', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
            mockFetch(() => Promise.resolve(okResponse({ id: '1', name: 'Jean', phone: '+24177000000', wallet: null })));

            await apiGetMe();

            const [, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(options.headers['Authorization']).toBeUndefined();
        });

        it('apiUpdatePushToken sends the push token authenticated', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok-push');
            mockFetch(() => Promise.resolve(okResponse({ message: 'ok' })));
            await apiUpdatePushToken('expo-push-token');
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/auth/push-token`);
            expect(options.headers['Authorization']).toBe('Bearer tok-push');
        });

        it('apiLookupUser encodes the phone number in the URL', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok');
            mockFetch(() => Promise.resolve(okResponse({ id: '1', name: 'X', phone: '+241 77 00 00 00', role: 'user' })));
            await apiLookupUser('+241 77 00 00 00');
            const [url] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/wallet/lookup/${encodeURIComponent('+241 77 00 00 00')}`);
        });

        it('apiTransfer posts amount/pin and resolves the transaction payload', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok');
            mockFetch(() => Promise.resolve(okResponse({
                message: 'ok',
                data: { transaction: {}, remainingBalance: 900, receiverName: 'Alice' },
            })));
            const res = await apiTransfer('+24177000009', 100, '1234');
            expect(res.data.remainingBalance).toBe(900);
            const [, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(JSON.parse(options.body)).toEqual({ receiverPhone: '+24177000009', amount: 100, pin: '1234' });
        });
    });

    // ─── Error / non-OK responses ───
    describe('error responses', () => {
        it('rejects with the server-provided message on non-OK response', async () => {
            mockFetch(() => Promise.resolve(errResponse({ message: 'Code PIN incorrect' }, 401 - 1)));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Code PIN incorrect');
        });

        it('falls back to data.error then a generic message on non-OK response', async () => {
            mockFetch(() => Promise.resolve(errResponse({ error: 'Bad request' }, 400)));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Bad request');

            mockFetch(() => Promise.resolve(errResponse({}, 400)));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Une erreur est survenue.');
        });

        it('rejects with a friendly message when the response body is not valid JSON', async () => {
            mockFetch(() => Promise.resolve({
                ok: false,
                status: 500,
                json: async () => { throw new Error('invalid json'); },
            }));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Réponse inattendue du serveur (500)');
        });

        // /api/auth/* retente automatiquement 2 fois (réveil à froid Render, voir request()
        // dans api.ts) avant d'abandonner — d'où le délai réel (~4s) couvert par le timeout
        // explicite ci-dessous, au-delà des 5000ms par défaut de Jest.
        it('translates a fetch network failure into a friendly offline message', async () => {
            mockFetch(() => Promise.reject(new Error('Network request failed')));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Vous êtes hors ligne');
        }, 10000);

        it('translates a "Failed to fetch" error into a friendly offline message', async () => {
            mockFetch(() => Promise.reject(new Error('Failed to fetch')));
            await expect(apiLogin('+24177000000', '0000')).rejects.toThrow('Vous êtes hors ligne');
        }, 10000);

        it('triggers the unauthorized handler and rejects on a 401 response when there is no refresh token to try', async () => {
            const onUnauthorized = jest.fn();
            setUnauthorizedHandler(onUnauthorized);
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('expired-token') // getToken() for the initial request
                .mockResolvedValueOnce(null); // getRefreshToken() inside tryRefreshSession
            mockFetch(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }));

            await expect(apiGetMe()).rejects.toThrow('Session expirée');
            expect(onUnauthorized).toHaveBeenCalledTimes(1);
            // No refresh token stored -> never even attempts the network refresh call.
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });
    });

    // ─── Renouvellement silencieux de session (refresh-on-401) ───
    describe('silent session refresh', () => {
        it('refreshes the token and transparently retries the original request on a 401', async () => {
            const onUnauthorized = jest.fn();
            setUnauthorizedHandler(onUnauthorized);
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('expired-token') // getToken() for the initial request
                .mockResolvedValueOnce('stored-refresh') // getRefreshToken() inside tryRefreshSession
                .mockResolvedValueOnce('new-access-token'); // getToken() for the retried request

            // /api/auth/me is hit twice (initial 401, then the transparent retry that
            // must succeed) — a plain per-URL mock can't tell those two calls apart, so
            // track how many times each URL was seen instead.
            const calls: string[] = [];
            let meCallCount = 0;
            (global as any).fetch = jest.fn((url: string) => {
                calls.push(url);
                if (url === `${BASE_URL}/api/auth/refresh`) {
                    return Promise.resolve(okResponse({ token: 'new-access-token', refreshToken: 'new-refresh-token' }));
                }
                meCallCount++;
                if (meCallCount === 1) {
                    return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
                }
                return Promise.resolve(okResponse({ id: '1', name: 'Jean', phone: '+24177000000', wallet: null }));
            });

            const user = await apiGetMe();

            expect(user.name).toBe('Jean');
            expect(onUnauthorized).not.toHaveBeenCalled();
            expect(calls).toEqual([`${BASE_URL}/api/auth/me`, `${BASE_URL}/api/auth/refresh`, `${BASE_URL}/api/auth/me`]);
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mongain_token', 'new-access-token');
            expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mongain_refresh_token', 'new-refresh-token');
            // The retried request carries the freshly-saved access token.
            const retryCallOptions = (global.fetch as jest.Mock).mock.calls[2][1];
            expect(retryCallOptions.headers['Authorization']).toBe('Bearer new-access-token');
        });

        it('logs out when the stored refresh token is itself rejected by the server', async () => {
            const onUnauthorized = jest.fn();
            setUnauthorizedHandler(onUnauthorized);
            (SecureStore.getItemAsync as jest.Mock)
                .mockResolvedValueOnce('expired-token')
                .mockResolvedValueOnce('stale-refresh');

            (global as any).fetch = jest.fn((url: string) => {
                if (url === `${BASE_URL}/api/auth/refresh`) {
                    return Promise.resolve({ ok: false, status: 401, json: async () => ({ error: 'Session expirée.' }) });
                }
                return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
            });

            await expect(apiGetMe()).rejects.toThrow('Session expirée');
            expect(onUnauthorized).toHaveBeenCalledTimes(1);
            // Only the original call + one refresh attempt: the retry-once guard must
            // prevent the refresh endpoint's own 401 from triggering another refresh loop.
            expect(global.fetch).toHaveBeenCalledTimes(2);
        });

        it('deduplicates concurrent refresh attempts into a single /auth/refresh call', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('stored-refresh');

            // Both apiGetMe() calls hit /api/auth/me twice each (initial 401 + retry) —
            // only the first two calls to that URL should fail, the rest (the retries)
            // must succeed once the shared refresh has completed.
            let refreshCalls = 0;
            let meCallCount = 0;
            (global as any).fetch = jest.fn((url: string) => {
                if (url === `${BASE_URL}/api/auth/refresh`) {
                    refreshCalls++;
                    return Promise.resolve(okResponse({ token: 'new-tok', refreshToken: 'new-refresh' }));
                }
                meCallCount++;
                if (meCallCount <= 2) {
                    return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
                }
                return Promise.resolve(okResponse({ id: '1', name: 'Jean', phone: '+24177000000', wallet: null }));
            });

            await Promise.all([apiGetMe(), apiGetMe()]);

            expect(refreshCalls).toBe(1);
        });
    });

    describe('apiLogoutServer', () => {
        it('posts to /api/auth/logout authenticated', async () => {
            (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('tok');
            mockFetch(() => Promise.resolve(okResponse({ message: 'Déconnecté.' })));
            await apiLogoutServer();
            const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
            expect(url).toBe(`${BASE_URL}/api/auth/logout`);
            expect(options.method).toBe('POST');
            expect(options.headers['Authorization']).toBe('Bearer tok');
        });
    });
});
