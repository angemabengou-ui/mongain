import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogs from '../AuditLogs';

describe('AuditLogs', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('affiche le journal une fois les logs chargés', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve([
                { id: '1', createdAt: '2026-08-20T10:00:00Z', admin: { name: 'Alice Corp', phone: '077000000' }, action: 'LOGIN', details: 'Connexion réussie' },
            ]),
        }));

        render(<AuditLogs token="tok" />);

        expect(await screen.findByText('Alice Corp')).toBeInTheDocument();
        expect(screen.getByText('LOGIN')).toBeInTheDocument();
        expect(screen.getByText('Connexion réussie')).toBeInTheDocument();
        expect(screen.getByText("Journaux d'Audit (Sécurité)")).toBeInTheDocument();
    });

    it("affiche un message quand aucun log n'est disponible", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
        render(<AuditLogs token="tok" />);
        expect(await screen.findByText("Aucun log d'audit disponible.")).toBeInTheDocument();
    });

    it('affiche un message d\'erreur explicite en cas de 403 (accès refusé)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: () => Promise.resolve({ error: 'Accès interdit' }),
        }));
        render(<AuditLogs token="tok" />);
        expect(await screen.findByText(/Accès interdit/)).toBeInTheDocument();
    });

    it('affiche un message quand le serveur est injoignable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')));
        render(<AuditLogs token="tok" />);
        expect(await screen.findByText(/Impossible de contacter le serveur\./)).toBeInTheDocument();
    });

    it('affiche le message de chargement pendant le fetch', async () => {
        let resolveFetch: (v: any) => void = () => {};
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(res => { resolveFetch = res; })));
        render(<AuditLogs token="tok" />);
        expect(screen.getByText('Chargement des logs...')).toBeInTheDocument();
        resolveFetch({ ok: true, json: () => Promise.resolve([]) });
        await waitFor(() => expect(screen.queryByText('Chargement des logs...')).not.toBeInTheDocument());
    });
});
