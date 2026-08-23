import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BranchDashboard from '../BranchDashboard';

const token = 'test-token';

const branchData = {
    name: 'Agence Libreville',
    balance: 500,
    wallet: { balance: 300 },
    staff: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sessions: [] as any[],
    targetTreasuryRequests: [] as any[],
};

describe('BranchDashboard', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("affiche un message de chargement puis les données de l'agence", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData });

        render(<BranchDashboard token={token} staffId="staff-1" />);

        expect(screen.getByText(/Chargement sécurisé de l'agence/)).toBeInTheDocument();

        await screen.findByText(/Tableau de Bord Agence/);
        expect(screen.getByText(/Agence Libreville/)).toBeInTheDocument();
        expect(screen.getByText('500 FCFA')).toBeInTheDocument();
        expect(screen.getByText('300 FCFA')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it("affiche un message d'erreur si le chargement échoue", async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Accès refusé' }) });

        render(<BranchDashboard token={token} staffId="staff-1" />);

        await screen.findByText(/Erreur critique/);
        expect(screen.getByText(/Accès refusé/)).toBeInTheDocument();
    });

    it("permet d'ouvrir une session de caisse", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData }); // fetch initial
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // POST open session
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData }); // refetch après ouverture

        const user = userEvent.setup();
        render(<BranchDashboard token={token} staffId="staff-1" />);

        await screen.findByText(/Tableau de Bord Agence/);

        const input = screen.getByPlaceholderText('0 FCFA');
        await user.type(input, '1000');
        await user.click(screen.getByRole('button', { name: 'Ouvrir le Guichet' }));

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/agency/sessions/open'),
            expect.objectContaining({ method: 'POST' })
        );
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Session ouverte'));
    });
});
