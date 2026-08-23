import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TellerTerminal from '../TellerTerminal';

const token = 'test-token';

const openSession = {
    id: 's1',
    status: 'OPEN',
    openedAt: '2026-08-22T08:00:00Z',
    initialCash: 100,
    totalCashInValue: 50,
    totalCashOutValue: 20,
};

function buildFetchMock(overrides: {
    sessionsResponse?: any;
    cashInResponse?: any;
    cashOutResponse?: any;
    lookupResponse?: any;
} = {}) {
    return vi.fn((url: string, opts?: any) => {
        const method = opts?.method;
        if (url.endsWith('/api/agency/sessions') && !method) {
            return Promise.resolve({ ok: true, json: async () => overrides.sessionsResponse ?? [openSession] });
        }
        if (url.endsWith('/api/agency/sessions/open') && method === 'POST') {
            return Promise.resolve({ ok: true, json: async () => ({ session: openSession }) });
        }
        if (url.includes('/api/admin/teller/lookup/')) {
            return Promise.resolve(overrides.lookupResponse ?? { ok: true, json: async () => ({ name: 'Client Test', phone: '077000000', role: 'USER' }) });
        }
        if (url.endsWith('/api/agency/cash-in') && method === 'POST') {
            return Promise.resolve(overrides.cashInResponse ?? { ok: true, json: async () => ({ fee: 100, transaction: { reference: 'TX-001' } }) });
        }
        if (url.endsWith('/api/agency/cash-out') && method === 'POST') {
            return Promise.resolve(overrides.cashOutResponse ?? { ok: true, json: async () => ({ fee: 0, transaction: { reference: 'TX-002' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
}

describe('TellerTerminal', () => {
    beforeEach(() => {
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("affiche l'écran d'ouverture de caisse si aucune session active", async () => {
        vi.stubGlobal('fetch', buildFetchMock({ sessionsResponse: [] }));

        render(<TellerTerminal token={token} userName="Marc" />);

        await screen.findByText('Ouverture de Caisse');
        expect(screen.getByText(/Marc/)).toBeInTheDocument();
    });

    it('ouvre une session de caisse avec succès', async () => {
        vi.stubGlobal('fetch', buildFetchMock({ sessionsResponse: [] }));
        const user = userEvent.setup();

        render(<TellerTerminal token={token} userName="Marc" />);
        await screen.findByText('Ouverture de Caisse');

        const input = screen.getByPlaceholderText('0');
        await user.type(input, '1000');
        await user.click(screen.getByRole('button', { name: 'Ouvrir la Caisse' }));

        await screen.findByText('Session Caisse Active');
    });

    it('affiche le terminal actif avec le résumé du shift', async () => {
        vi.stubGlobal('fetch', buildFetchMock());

        render(<TellerTerminal token={token} userName="Marc" />);

        await screen.findByText('Session Caisse Active');
        expect(screen.getByText('100 FCFA')).toBeInTheDocument(); // Mise Initiale
        expect(screen.getAllByText('130 FCFA')).toHaveLength(2); // Solde Estimé + Total Attendu
    });

    it('affiche une alerte si le montant est invalide lors du cash-in', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<TellerTerminal token={token} userName="Marc" />);
        await screen.findByText('Session Caisse Active');

        await user.click(screen.getByRole('button', { name: /CASH-IN/i }));
        await user.click(screen.getByRole('button', { name: 'Continuer' }));

        expect(window.alert).toHaveBeenCalledWith('Montant invalide');
    });

    it('complète une opération de cash-in avec succès', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<TellerTerminal token={token} userName="Marc" />);
        await screen.findByText('Session Caisse Active');

        await user.click(screen.getByRole('button', { name: /CASH-IN/i }));
        await user.type(screen.getByPlaceholderText('Numéro de téléphone (+241...)'), '077000000');
        await user.type(screen.getByPlaceholderText('25000'), '25000');
        await user.click(screen.getByRole('button', { name: 'Continuer' }));

        await screen.findByText("Confirmer l'opération");
        await user.click(screen.getByRole('button', { name: 'Confirmer Dépôt' }));

        await screen.findByText('Opération Réussie');
        expect(screen.getByText(/TX-001/)).toBeInTheDocument();
    });

    it("affiche une erreur et revient à l'étape 1 si le cash-out échoue (fonds insuffisants)", async () => {
        vi.stubGlobal('fetch', buildFetchMock({
            cashOutResponse: { ok: false, json: async () => ({ error: 'Fonds insuffisants au guichet' }) },
        }));
        const user = userEvent.setup();

        render(<TellerTerminal token={token} userName="Marc" />);
        await screen.findByText('Session Caisse Active');

        await user.click(screen.getByRole('button', { name: /CASH-OUT/i }));
        await user.type(screen.getByPlaceholderText('Numéro de téléphone (+241...)'), '077000000');
        await user.type(screen.getByPlaceholderText('25000'), '5000');
        await user.click(screen.getByRole('button', { name: 'Continuer' }));

        await screen.findByText("Confirmer l'opération");
        await user.click(screen.getByRole('button', { name: 'Autoriser Retrait' }));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Fonds insuffisants au guichet'));
        await screen.findByText('Nouvelle Opération');
    });
});
