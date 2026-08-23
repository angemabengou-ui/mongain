import { describe, expect, it, vi, beforeEach } from 'vitest';
import { apiFetch } from '../utils/apiFetch';

function mockFetchOnce(opts: { ok: boolean; status?: number; text: string }) {
    return vi.fn().mockResolvedValue({
        ok: opts.ok,
        status: opts.status ?? (opts.ok ? 200 : 500),
        text: () => Promise.resolve(opts.text),
    });
}

describe('apiFetch', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('retourne les données JSON parsées quand la réponse est OK', async () => {
        vi.stubGlobal('fetch', mockFetchOnce({ ok: true, text: JSON.stringify({ hello: 'world' }) }));
        const data = await apiFetch('http://x/api/test');
        expect(data).toEqual({ hello: 'world' });
    });

    it('retourne un objet vide quand le corps de la réponse est vide et la réponse est OK', async () => {
        vi.stubGlobal('fetch', mockFetchOnce({ ok: true, text: '' }));
        const data = await apiFetch('http://x/api/test');
        expect(data).toEqual({});
    });

    it('lève une erreur avec le message du serveur quand la réponse n\'est pas OK', async () => {
        vi.stubGlobal('fetch', mockFetchOnce({ ok: false, status: 403, text: JSON.stringify({ error: 'Accès refusé' }) }));
        await expect(apiFetch('http://x/api/test')).rejects.toThrow('Accès refusé');
    });

    it('lève une erreur générique quand la réponse n\'est pas OK et sans corps', async () => {
        vi.stubGlobal('fetch', mockFetchOnce({ ok: false, status: 500, text: '' }));
        await expect(apiFetch('http://x/api/test')).rejects.toThrow('Erreur serveur (500).');
    });

    it('lève une erreur explicite quand le JSON est invalide', async () => {
        vi.stubGlobal('fetch', mockFetchOnce({ ok: true, text: '{not valid json' }));
        await expect(apiFetch('http://x/api/test')).rejects.toThrow('Réponse invalide du serveur (connexion interrompue). Réessayez.');
    });

    it('lève une erreur de connexion quand fetch rejette (réseau indisponible)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
        await expect(apiFetch('http://x/api/test')).rejects.toThrow('Connexion au serveur impossible. Vérifiez votre réseau et réessayez.');
    });

    it('transmet les options (method, headers, body) à fetch', async () => {
        const fetchMock = mockFetchOnce({ ok: true, text: '{}' });
        vi.stubGlobal('fetch', fetchMock);
        await apiFetch('http://x/api/test', { method: 'PUT', headers: { Authorization: 'Bearer abc' } });
        expect(fetchMock).toHaveBeenCalledWith('http://x/api/test', { method: 'PUT', headers: { Authorization: 'Bearer abc' } });
    });
});
