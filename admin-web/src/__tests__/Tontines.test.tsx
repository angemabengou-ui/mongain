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
    participants: [{ id: 'p1', userId: 'u1', user: { name: 'Alice Ndong', phone: '077111111' }, status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: true }],
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

    it('reporter le prélèvement : exige un motif, utilise le nombre de jours saisi, puis appelle POST /postpone', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true, group: sampleDetail })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ groups: [sampleGroup] });

        render(<Tontines token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));
        fireEvent.click(await screen.findByText('Reporter le prélèvement'));

        const confirmButton = await screen.findByRole('button', { name: 'Reporter' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Nombre de jours de report'), { target: { value: '5' } });
        fireEvent.change(screen.getByPlaceholderText(/Motif du report/), { target: { value: 'Deux membres ont besoin de plus de temps' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        expect(await screen.findByText('Prélèvement reporté.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/tontines/g1/postpone'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ days: 5, reason: 'Deux membres ont besoin de plus de temps' }) })
        );
    });

    it("mise en pause d'un participant : envoie son vrai userId (pas p.user.id, absent du payload serveur)", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true, participant: { id: 'p1', status: 'PAUSED' } })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ groups: [sampleGroup] });

        render(<Tontines token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));
        // Index 1 : le bouton du groupe (en-tête) est le premier, celui de la ligne participant le second.
        fireEvent.click((await screen.findAllByRole('button', { name: 'Mettre en pause' }))[1]);
        fireEvent.click(await screen.findByRole('button', { name: 'Confirmer la pause' }));

        expect(await screen.findByText('Participant mis en pause.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/tontines/g1/participants/u1/pause'),
            expect.objectContaining({ method: 'POST' })
        );
    });

    it("paiement d'urgence : affiche le bouton pour un participant éligible, exige un motif, puis appelle POST /emergency-payout", async () => {
        const eligibleDetail = {
            ...sampleDetail,
            participants: [{ id: 'p1', userId: 'u1', user: { name: 'Alice Ndong', phone: '077111111' }, status: 'ACTIVE', payoutOrder: 1, hasReceivedPayout: false }],
        };
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: eligibleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true, completed: false, debitedCount: 1, totalPot: 10000 })
            .mockResolvedValueOnce({ group: eligibleDetail, transactions: [] })
            .mockResolvedValueOnce({ groups: [sampleGroup] });

        render(<Tontines token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));
        fireEvent.click(await screen.findByText('Urgence'));

        const confirmButton = await screen.findByRole('button', { name: 'Déclencher le paiement' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByPlaceholderText(/Motif de l'urgence/), { target: { value: 'Urgence médicale du membre' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        expect(await screen.findByText("Paiement d'urgence déclenché.")).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/tontines/g1/participants/u1/emergency-payout'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Urgence médicale du membre' }) })
        );
    });

    it("ne devrait pas afficher le bouton de paiement d'urgence pour un participant ayant déjà reçu sa cagnotte", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: sampleDetail, transactions: [] });

        render(<Tontines token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));

        expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
        expect(screen.queryByText('Urgence')).not.toBeInTheDocument();
    });

    it("affiche le montant restant dû pour une cotisation PARTIAL (dépôt libre incomplet) dans le détail des échecs", async () => {
        const detailWithPartialCycle = {
            ...sampleDetail,
            cycles: [{
                id: 'c1', cycleNumber: 1, status: 'PARTIAL', totalExpected: 20000, totalCollected: 14000,
                executedAt: '2026-01-01T10:00:00Z',
                contributions: [
                    { participantId: 'p1', status: 'PAID', amount: 10000, participant: { user: { name: 'Alice Ndong' } } },
                    { participantId: 'p2', status: 'PARTIAL', amount: 4000, participant: { user: { name: 'Bob Obiang' } } },
                ],
            }],
        };
        mockedApiFetch
            .mockResolvedValueOnce({ groups: [sampleGroup] })
            .mockResolvedValueOnce({ group: detailWithPartialCycle, transactions: [] });

        render(<Tontines token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Tontine des Amis'));

        // Cotisation de 10 000 FCFA, Bob a versé 4 000 → il doit encore 6 000 FCFA.
        // toLocaleString('fr-FR') insère une espace fine insécable (pas une espace normale)
        // entre les milliers — le "." du regex reste neutre vis-à-vis de ce caractère exact.
        expect(await screen.findByText(/Bob Obiang \(doit 6.000 FCFA\)/)).toBeInTheDocument();
    });
});
