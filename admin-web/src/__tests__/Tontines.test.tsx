import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Tontines from '../Tontines';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const sampleGroup = {
    id: 'g1', name: 'Tontine des Amis', status: 'ACTIVE', contribution: 10000, frequency: 'MONTHLY', currentCycle: 2,
    creator: { name: 'Alice Ndong', phone: '077111111' }, _count: { participants: 3 },
};

const sampleDetail = {
    id: 'g1', name: 'Tontine des Amis', status: 'ACTIVE', contribution: 10000, frequency: 'MONTHLY', currentCycle: 2,
    creator: { name: 'Alice Ndong', phone: '077111111' },
    participants: [{ id: 'p1', user: { name: 'Alice Ndong', phone: '077111111' }, status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: true }],
};

const sampleTransactions = [
    { id: 'tx1', reference: 'TONT_DBT_Gg1_C1_Uu1', amount: 10000, fee: 100, status: 'COMPLETED', createdAt: '2026-01-01T10:00:00Z', senderWallet: { user: { name: 'Alice Ndong', phone: '077111111' } } },
];

describe('Tontines', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche la liste des tontines', async () => {
        mockedApiFetch.mockResolvedValue({ groups: [sampleGroup] });
        render(<Tontines token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Tontine des Amis')).toBeInTheDocument();
        expect(screen.getByText('Alice Ndong')).toBeInTheDocument();
        expect(screen.getByText('Tontines')).toBeInTheDocument();
    });

    it("affiche un message quand aucune tontine n'existe", async () => {
        mockedApiFetch.mockResolvedValue({ groups: [] });
        render(<Tontines token="tok" hasPerm={() => false} />);
        expect(await screen.findByText("Aucune tontine créée pour l'instant.")).toBeInTheDocument();
    });

    it("affiche une erreur avec bouton de réessai en cas d'échec", async () => {
        mockedApiFetch.mockRejectedValue(new Error("Impossible de contacter le serveur."));
        render(<Tontines token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Impossible de contacter le serveur.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });

    it("ouvre le détail d'une tontine au clic sur une ligne et affiche ses mouvements", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: sampleTransactions });

        render(<Tontines token="tok" hasPerm={() => false} />);
        const row = await screen.findByText('Tontine des Amis');
        fireEvent.click(row);

        expect(await screen.findByText('Retour aux tontines')).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
        expect(screen.getByText('💸 Cotisation')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/admin/tontines/g1'), expect.anything());
    });

    it('revient à la liste au clic sur "Retour aux tontines"', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] });

        render(<Tontines token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));
        fireEvent.click(await screen.findByText('Retour aux tontines'));

        expect(await screen.findByText('Tontines')).toBeInTheDocument();
    });

    it("n'affiche pas le bouton Mettre en pause sans perm_tontine_manage", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] });

        render(<Tontines token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));

        expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
        expect(screen.queryByText('Mettre en pause')).not.toBeInTheDocument();
    });

    it('mise en pause : ouvre la confirmation, exige un motif, puis appelle POST /pause', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true, group: { ...sampleDetail, isPaused: true } })
            .mockResolvedValueOnce({ group: { ...sampleDetail, isPaused: true }, transactions: [] })
            .mockResolvedValueOnce({ groups: [sampleGroup] });

        render(<Tontines token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));
        // Le bouton d'action du groupe (en-tête) et celui de la ligne participant partagent
        // le même libellé « Mettre en pause » — le premier du DOM est celui de l'en-tête.
        fireEvent.click((await screen.findAllByRole('button', { name: 'Mettre en pause' }))[0]);

        const confirmButton = await screen.findByRole('button', { name: 'Confirmer la pause' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByPlaceholderText(/Motif de la pause/), { target: { value: 'Cagnotte contestée par un membre' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        expect(await screen.findByText('Tontine mise en pause.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/tontines/g1/pause'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Cagnotte contestée par un membre' }) })
        );
    });
});
