import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../utils/apiClient';
import { API_URL } from '../config';

// apiClient est une vraie instance axios (pas de mock d'axios.create) — on accède
// directement aux handlers d'interceptors enregistrés pour tester leur logique,
// sans dépendre d'un serveur HTTP réel ni d'une lib comme axios-mock-adapter.
const requestInterceptor = () => (apiClient.interceptors.request as any).handlers[0];
const responseInterceptor = () => (apiClient.interceptors.response as any).handlers[0];

describe('apiClient', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it('utilise API_URL comme baseURL', () => {
        expect(apiClient.defaults.baseURL).toBe(API_URL);
    });

    it("n'ajoute pas d'en-tête Authorization quand sessionStorage ne contient pas de token", async () => {
        const config = { headers: {} } as any;
        const result = await requestInterceptor().fulfilled(config);
        expect(result.headers.Authorization).toBeUndefined();
    });

    it('ajoute le token depuis sessionStorage en en-tête Authorization', async () => {
        sessionStorage.setItem('admin_token', 'my-secret-token');
        const config = { headers: {} } as any;
        const result = await requestInterceptor().fulfilled(config);
        expect(result.headers.Authorization).toBe('Bearer my-secret-token');
    });

    it('efface sessionStorage/localStorage et recharge la page sur une réponse 401', async () => {
        sessionStorage.setItem('admin_token', 'abc');
        localStorage.setItem('admin_role', 'SUPER_ADMIN');
        localStorage.setItem('admin_name', 'Jean');

        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        // jsdom n'implémente pas window.location.reload (navigation) ; on le stub.
        Object.defineProperty(window, 'location', { value: { ...originalLocation, reload: reloadSpy }, writable: true });

        const error = { response: { status: 401 } };
        await expect(responseInterceptor().rejected(error)).rejects.toBe(error);

        expect(sessionStorage.getItem('admin_token')).toBeNull();
        expect(localStorage.getItem('admin_role')).toBeNull();
        expect(localStorage.getItem('admin_name')).toBeNull();
        expect(reloadSpy).toHaveBeenCalled();

        Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    });

    it('efface le stockage sur une réponse 403 également', async () => {
        sessionStorage.setItem('admin_token', 'abc');
        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', { value: { ...originalLocation, reload: reloadSpy }, writable: true });

        const error = { response: { status: 403 } };
        await expect(responseInterceptor().rejected(error)).rejects.toBe(error);
        expect(sessionStorage.getItem('admin_token')).toBeNull();
        expect(reloadSpy).toHaveBeenCalled();

        Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    });

    it("ne touche pas au stockage pour une erreur qui n'est pas 401/403", async () => {
        sessionStorage.setItem('admin_token', 'abc');
        const reloadSpy = vi.fn();
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', { value: { ...originalLocation, reload: reloadSpy }, writable: true });

        const error = { response: { status: 500 } };
        await expect(responseInterceptor().rejected(error)).rejects.toBe(error);
        expect(sessionStorage.getItem('admin_token')).toBe('abc');
        expect(reloadSpy).not.toHaveBeenCalled();

        Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
    });

    it('laisse passer une réponse réussie inchangée', async () => {
        const response = { data: { ok: true } };
        const result = await responseInterceptor().fulfilled(response);
        expect(result).toBe(response);
    });
});
