import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupportCenter from '../SupportCenter';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

const stats = {
    open: 5, inProgress: 2, waitingCustomer: 1, slaBreached: 0, critical: 1, refundPending: 3, fraudCases: 2,
};

const tickets = [
    {
        id: 'ticket-aaaaaaaa-1111', title: 'Problème de retrait', category: 'CASH_OUT', priority: 'HIGH', status: 'OPEN',
        user: { name: 'Jean Dupont', phone: '+24100000001' }, assignee: null, createdAt: '2026-01-01T10:00:00Z',
        description: 'Le retrait a échoué mais le compte a été débité.',
    },
];

const fraudCases = [
    {
        id: 'fraud-bbbbbbbb-2222', type: 'IDENTITY_THEFT', riskLevel: 'HIGH', status: 'OPEN',
        user: { name: 'Marie Curie', phone: '+24100000002' }, analyst: null, createdAt: '2026-01-02T10:00:00Z',
    },
];

const refunds = [
    {
        id: 'refund-cccccccc-3333', amount: 15000, refundType: 'FULL', reason: 'Double débit', status: 'REQUESTED',
        user: { name: 'Paul Martin', phone: '+24100000003' }, requester: { name: 'Agent Support' }, approver: null,
    },
];

function setupApiFetch() {
    mockedApiFetch.mockImplementation(async (url: string) => {
        if (url.includes('/reclamations/stats')) return stats;
        if (url.includes('/reclamations?')) return { tickets };
        if (url.includes('/reclamations/ticket-aaaaaaaa-1111')) return { ...tickets[0], notes: [] };
        if (url.includes('/fraud-cases?')) return { cases: fraudCases };
        if (url.includes('/refund-requests?')) return { refunds };
        return {};
    });
}

describe('SupportCenter', () => {
    beforeEach(() => {
        mockedApiFetch.mockReset();
        setupApiFetch();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('affiche le tableau de bord avec les statistiques chargées', async () => {
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        expect(await screen.findByText('5')).toBeInTheDocument(); // Ouverts
        expect(screen.getByText('Support & Réclamations')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/reclamations/stats'),
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) })
        );
    });

    it("charge et affiche les tickets dans l'onglet Boîte de Réception", async () => {
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('5');

        await user.click(screen.getByRole('button', { name: /Boîte de Réception/i }));

        expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
        expect(screen.getByText('+24100000001')).toBeInTheDocument();
    });

    it('ouvre le détail du ticket au clic et affiche la description', async () => {
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await user.click(screen.getByRole('button', { name: /Boîte de Réception/i }));
        await screen.findByText('Jean Dupont');

        await user.click(screen.getByText('Jean Dupont'));

        expect(await screen.findByText('Le retrait a échoué mais le compte a été débité.')).toBeInTheDocument();
    });

    it("affiche une erreur si le chargement des tickets échoue", async () => {
        mockedApiFetch.mockImplementation(async (url: string) => {
            if (url.includes('/reclamations/stats')) return stats;
            if (url.includes('/reclamations?')) throw new Error('Erreur serveur (500).');
            return {};
        });
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await user.click(screen.getByRole('button', { name: /Boîte de Réception/i }));

        expect(await screen.findByText('Erreur serveur (500).')).toBeInTheDocument();
    });

    it('masque les actions de remboursement pour un rôle non-Finance', async () => {
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => false} />);
        await user.click(screen.getByRole('button', { name: /Remboursements/i }));

        expect(await screen.findByText('Paul Martin')).toBeInTheDocument();
        expect(screen.getByText("En attente d'approbation Finance")).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Approuver/i })).not.toBeInTheDocument();
    });

    it('affiche les actions Approuver/Rejeter pour un rôle Finance (SUPER_ADMIN)', async () => {
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await user.click(screen.getByRole('button', { name: /Remboursements/i }));

        await screen.findByText('Paul Martin');
        const approveBtn = screen.getByRole('button', { name: /Approuver/i });
        expect(approveBtn).toBeInTheDocument();

        await user.click(approveBtn);

        await waitFor(() => {
            expect(mockedApiFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/refund-requests/refund-cccccccc-3333/approve'),
                expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'APPROVE' }) })
            );
        });
    });

    it('affiche les dossiers de fraude dans leur onglet dédié', async () => {
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await user.click(screen.getByRole('button', { name: /Fraudes/i }));

        expect(await screen.findByText('Marie Curie')).toBeInTheDocument();
        expect(screen.getByText("Usurpation d'identité")).toBeInTheDocument();
    });

    it("ajoute une note interne sur un ticket et l'affiche dans la chronologie", async () => {
        mockedApiFetch.mockImplementation(async (url: string, opts: any) => {
            if (url.includes('/reclamations/stats')) return stats;
            if (url.includes('/reclamations?')) return { tickets };
            if (opts?.method === 'POST' && url.includes('/notes')) {
                return { note: { id: 'note-1', authorName: 'Moi', content: 'Suivi en cours', isInternal: true, createdAt: '2026-01-03T10:00:00Z' }, status: 'IN_PROGRESS' };
            }
            if (url.includes('/reclamations/ticket-aaaaaaaa-1111')) return { ...tickets[0], notes: [] };
            return {};
        });
        const user = userEvent.setup();
        render(<SupportCenter token="tok" hasPerm={() => true} />);
        await user.click(screen.getByRole('button', { name: /Boîte de Réception/i }));
        await user.click(await screen.findByText('Jean Dupont'));
        await screen.findByText('Le retrait a échoué mais le compte a été débité.');

        const textarea = screen.getByPlaceholderText('Ajouter une note ou réponse…');
        await user.type(textarea, 'Suivi en cours');
        await user.click(screen.getByRole('button', { name: 'Envoyer' }));

        expect(await screen.findByText('Suivi en cours')).toBeInTheDocument();
    });
});
