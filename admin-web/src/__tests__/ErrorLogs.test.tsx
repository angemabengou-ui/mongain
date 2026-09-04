import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorLogs from '../ErrorLogs';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const sampleLog = { id: 'e1', createdAt: '2026-08-20T10:00:00Z', source: 'PVIT', message: 'Timeout upstream', resolved: false, path: '/api/wallet/push', details: null };

describe('ErrorLogs', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche les erreurs système chargées', async () => {
        mockedApiFetch.mockResolvedValue({ logs: [sampleLog], total: 1, sources: ['PVIT'] });
        render(<ErrorLogs token="tok" />);
        expect(await screen.findByText('Timeout upstream')).toBeInTheDocument();
        expect(screen.getByText('Erreurs Système')).toBeInTheDocument();
        expect(screen.getByText('1 erreur au total')).toBeInTheDocument();
    });

    it("affiche un message quand il n'y a pas d'erreur non résolue", async () => {
        mockedApiFetch.mockResolvedValue({ logs: [], total: 0, sources: [] });
        render(<ErrorLogs token="tok" />);
        expect(await screen.findByText(/Aucune erreur non résolue/)).toBeInTheDocument();
    });

    it("affiche un message d'erreur avec un bouton pour réessayer en cas d'échec", async () => {
        mockedApiFetch.mockRejectedValue(new Error('Connexion au serveur impossible.'));
        render(<ErrorLogs token="tok" />);
        expect(await screen.findByText('Connexion au serveur impossible.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });

    it('marque une erreur comme résolue et rafraîchit la liste', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ logs: [sampleLog], total: 1, sources: ['PVIT'] })
            .mockResolvedValueOnce({}) // PUT resolve
            .mockResolvedValueOnce({ logs: [], total: 0, sources: [] }); // refresh

        render(<ErrorLogs token="tok" />);
        await screen.findByText('Timeout upstream');

        fireEvent.click(screen.getByRole('button', { name: 'Marquer résolue' }));

        await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(3));
        const [url, options] = mockedApiFetch.mock.calls[1];
        expect(url).toContain('/error-logs/e1/resolve');
        expect(options?.method).toBe('PUT');
    });

    it('déplie une ligne pour afficher les détails au clic', async () => {
        mockedApiFetch.mockResolvedValue({ logs: [sampleLog], total: 1, sources: ['PVIT'] });
        render(<ErrorLogs token="tok" />);
        const row = await screen.findByText('Timeout upstream');
        fireEvent.click(row);
        expect(await screen.findByText('Aucun détail supplémentaire.')).toBeInTheDocument();
    });
});
