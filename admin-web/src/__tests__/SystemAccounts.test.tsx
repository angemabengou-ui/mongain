import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SystemAccounts from '../SystemAccounts';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const sampleAccounts = [
    { id: 'treasury:ct_1', walletId: 'w_hq', name: 'Trésorerie Centrale Mongain', balance: 79840000, kind: 'CENTRAL_TREASURY' },
    { id: 'user:u_gateway', walletId: 'w_gateway', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)', phone: '+24133333333', balance: 1000000499, kind: 'SYSTEM_USER' },
];

const sampleTransactions = [
    {
        id: 'tx1', amount: 5000, reference: 'TOPUP-CB-1', status: 'COMPLETED', createdAt: '2026-01-01T10:00:00Z',
        senderWallet: { id: 'w_gateway', user: { name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)', phone: '+24133333333' } },
        receiverWallet: { id: 'w_client', user: { name: 'Jean Dupont', phone: '+24100000001' } },
    },
];

describe('SystemAccounts', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche la liste des comptes système', async () => {
        mockedApiFetch.mockResolvedValue({ accounts: sampleAccounts });
        render(<SystemAccounts token="tok" />);

        expect(await screen.findByText('Trésorerie Centrale Mongain')).toBeInTheDocument();
        expect(screen.getByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)')).toBeInTheDocument();
        expect(screen.getByText('1 000 000 499 FCFA')).toBeInTheDocument();
    });

    it("affiche une erreur avec bouton de réessai en cas d'échec", async () => {
        mockedApiFetch.mockRejectedValue(new Error("Impossible de contacter le serveur."));
        render(<SystemAccounts token="tok" />);

        expect(await screen.findByText('Impossible de contacter le serveur.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });

    it("ouvre le détail d'un compte et affiche son historique de mouvements", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ accounts: sampleAccounts })
            .mockResolvedValueOnce({ transactions: sampleTransactions });

        render(<SystemAccounts token="tok" />);
        const row = await screen.findByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)');
        fireEvent.click(row);

        expect(await screen.findByText('Retour aux comptes système')).toBeInTheDocument();
        expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/admin/system-accounts/w_gateway/transactions'), expect.anything());
    });

    it('déclenche onAdjust avec le walletId et le nom du compte sélectionné', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ accounts: sampleAccounts })
            .mockResolvedValueOnce({ transactions: [] });
        const onAdjust = vi.fn();
        const user = userEvent.setup();

        render(<SystemAccounts token="tok" onAdjust={onAdjust} />);
        fireEvent.click(await screen.findByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)'));
        await screen.findByText('Retour aux comptes système');

        await user.click(screen.getByRole('button', { name: /Créer un ajustement/i }));

        expect(onAdjust).toHaveBeenCalledWith('w_gateway', 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)');
    });

    it('filtre la liste par recherche', async () => {
        mockedApiFetch.mockResolvedValue({ accounts: sampleAccounts });
        const user = userEvent.setup();
        render(<SystemAccounts token="tok" />);

        await screen.findByText('Trésorerie Centrale Mongain');
        await user.type(screen.getByPlaceholderText(/Rechercher un compte/i), 'passerelle');

        expect(screen.queryByText('Trésorerie Centrale Mongain')).not.toBeInTheDocument();
        expect(screen.getByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)')).toBeInTheDocument();
    });
});
