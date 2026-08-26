import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Vaults from '../Vaults';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const sampleVault = {
    id: 'v1', name: 'Caisse Famille', admin: { name: 'Paul Président', phone: '077222222' },
    balance: 50000, requiredApprovals: 2, _count: { members: 4, transactions: 1 },
};

const sampleDetail = {
    id: 'v1', name: 'Caisse Famille', description: null, admin: { name: 'Paul Président', phone: '077222222' },
    balance: 50000, requiredApprovals: 2,
    members: [{ id: 'm1', user: { name: 'Paul Président', phone: '077222222' }, isAdmin: true, isInitiator: false, isValidator: false, isTreasurer: false }],
    transactions: [],
    vouchers: [],
};

describe('Vaults', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche la liste des caisses communes', async () => {
        mockedApiFetch.mockResolvedValue({ vaults: [sampleVault] });
        render(<Vaults token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Caisse Famille')).toBeInTheDocument();
        expect(screen.getByText('Paul Président')).toBeInTheDocument();
        expect(screen.getByText('Caisses Communes')).toBeInTheDocument();
    });

    it("affiche un message quand aucune caisse n'existe", async () => {
        mockedApiFetch.mockResolvedValue({ vaults: [] });
        render(<Vaults token="tok" hasPerm={() => false} />);
        expect(await screen.findByText("Aucune caisse commune créée pour l'instant.")).toBeInTheDocument();
    });

    it("affiche une erreur avec bouton de réessai en cas d'échec", async () => {
        mockedApiFetch.mockRejectedValue(new Error("Impossible de contacter le serveur."));
        render(<Vaults token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Impossible de contacter le serveur.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });

    it("ouvre le détail d'une caisse au clic sur une ligne", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ vaults: [sampleVault] })
            .mockResolvedValueOnce({ vault: sampleDetail });

        render(<Vaults token="tok" hasPerm={() => false} />);
        const row = await screen.findByText('Caisse Famille');
        fireEvent.click(row);

        expect(await screen.findByText('Retour aux caisses')).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Membres' })).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/admin/vaults/v1'), expect.anything());
    });

    it('revient à la liste au clic sur "Retour aux caisses"', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ vaults: [sampleVault] })
            .mockResolvedValueOnce({ vault: sampleDetail });

        render(<Vaults token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Caisse Famille'));
        fireEvent.click(await screen.findByText('Retour aux caisses'));

        expect(await screen.findByText('Caisses Communes')).toBeInTheDocument();
    });

    it("n'affiche pas le bouton Geler sans perm_vault_manage", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ vaults: [sampleVault] })
            .mockResolvedValueOnce({ vault: sampleDetail });

        render(<Vaults token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Caisse Famille'));

        expect(await screen.findByRole('heading', { name: 'Membres' })).toBeInTheDocument();
        expect(screen.queryByText('Geler la caisse')).not.toBeInTheDocument();
    });

    it('geler la caisse : ouvre la confirmation, exige un motif, puis appelle POST /freeze', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ vaults: [sampleVault] })
            .mockResolvedValueOnce({ vault: sampleDetail })
            .mockResolvedValueOnce({ success: true, vault: { ...sampleDetail, isFrozen: true } })
            .mockResolvedValueOnce({ vault: { ...sampleDetail, isFrozen: true } })
            .mockResolvedValueOnce({ vaults: [sampleVault] });

        render(<Vaults token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Caisse Famille'));
        fireEvent.click(await screen.findByText('Geler la caisse'));

        const confirmButton = await screen.findByRole('button', { name: 'Geler' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByPlaceholderText(/Motif du gel/), { target: { value: 'Litige signalé par un membre' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        expect(await screen.findByText('Caisse gelée.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/vaults/v1/freeze'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Litige signalé par un membre' }) })
        );
    });
});
