import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearch from '../components/GlobalSearch';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

describe('GlobalSearch', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it("n'interroge pas le serveur pour une requête de moins de 2 caractères", async () => {
        const user = userEvent.setup();
        render(<GlobalSearch token="tok" onNavigate={vi.fn()} />);

        await user.type(screen.getByPlaceholderText(/Rechercher un client/i), 'a');

        await new Promise(r => setTimeout(r, 350));
        expect(mockedApiFetch).not.toHaveBeenCalled();
    });

    it('affiche les résultats groupés par catégorie après saisie', async () => {
        mockedApiFetch.mockResolvedValue({
            users: [{ id: 'u1', name: 'Jean Dupont', phone: '+24100000001' }],
            vaults: [{ id: 'v1', name: 'Caisse Famille', admin: { name: 'Paul Président' } }],
            tontines: [{ id: 'g1', name: 'Tontine des Amis', creator: { name: 'Alice Ndong' } }],
        });
        const user = userEvent.setup();
        render(<GlobalSearch token="tok" onNavigate={vi.fn()} />);

        await user.type(screen.getByPlaceholderText(/Rechercher un client/i), 'ndong');

        expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
        expect(screen.getByText('Caisse Famille')).toBeInTheDocument();
        expect(screen.getByText('Tontine des Amis')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/search?q=ndong'), expect.anything());
    });

    it("affiche un message quand aucun résultat n'est trouvé", async () => {
        mockedApiFetch.mockResolvedValue({ users: [], vaults: [], tontines: [] });
        const user = userEvent.setup();
        render(<GlobalSearch token="tok" onNavigate={vi.fn()} />);

        await user.type(screen.getByPlaceholderText(/Rechercher un client/i), 'zzz');

        expect(await screen.findByText(/Aucun résultat/)).toBeInTheDocument();
    });

    it('navigue vers la fiche au clic sur un résultat et vide la recherche', async () => {
        mockedApiFetch.mockResolvedValue({
            users: [], vaults: [{ id: 'v1', name: 'Caisse Famille', admin: { name: 'Paul Président' } }], tontines: [],
        });
        const onNavigate = vi.fn();
        const user = userEvent.setup();
        render(<GlobalSearch token="tok" onNavigate={onNavigate} />);

        const input = screen.getByPlaceholderText(/Rechercher un client/i);
        await user.type(input, 'famille');
        fireEvent.click(await screen.findByText('Caisse Famille'));

        expect(onNavigate).toHaveBeenCalledWith('vaults', 'v1');
        await waitFor(() => expect(input).toHaveValue(''));
    });

    it('ferme le panneau au clic en dehors', async () => {
        mockedApiFetch.mockResolvedValue({ users: [{ id: 'u1', name: 'Jean Dupont' }], vaults: [], tontines: [] });
        const user = userEvent.setup();
        render(
            <div>
                <GlobalSearch token="tok" onNavigate={vi.fn()} />
                <div data-testid="outside">Ailleurs</div>
            </div>
        );

        await user.type(screen.getByPlaceholderText(/Rechercher un client/i), 'jean');
        expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();

        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(screen.queryByText('Jean Dupont')).not.toBeInTheDocument();
    });
});
