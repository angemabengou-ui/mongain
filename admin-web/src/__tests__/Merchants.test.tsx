import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Merchants from '../Merchants';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const sampleMerchant = {
    id: 'm1', name: 'Le Bon Coin', phone: '077999999',
    wallet: { balance: 50000 }, commissionWallet: { balance: 2500 },
    _count: { merchantPayoutRequests: 1 },
};

const sampleDetail = {
    id: 'm1', name: 'Le Bon Coin', phone: '077999999',
    wallet: { id: 'w1', balance: 50000 }, commissionWallet: { id: 'wc1', balance: 2500 },
    merchantPayoutRequests: [
        { id: 'p1', sourceAccount: 'COMMISSION', amount: 500, note: 'Test', status: 'PENDING', createdAt: '2026-01-01T10:00:00Z', processedBy: null },
    ],
};

describe('Merchants', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche la liste des marchands', async () => {
        mockedApiFetch.mockResolvedValue({ merchants: [sampleMerchant] });
        render(<Merchants token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Le Bon Coin')).toBeInTheDocument();
        expect(screen.getByText('Marchands')).toBeInTheDocument();
    });

    it("affiche un message quand aucun marchand n'existe", async () => {
        mockedApiFetch.mockResolvedValue({ merchants: [] });
        render(<Merchants token="tok" hasPerm={() => false} />);
        expect(await screen.findByText("Aucun compte marchand pour l'instant.")).toBeInTheDocument();
    });

    it("affiche une erreur avec bouton de réessai en cas d'échec", async () => {
        mockedApiFetch.mockRejectedValue(new Error("Impossible de contacter le serveur."));
        render(<Merchants token="tok" hasPerm={() => false} />);
        expect(await screen.findByText('Impossible de contacter le serveur.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });

    it("ouvre le détail d'un marchand et affiche les deux soldes séparés", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ merchants: [sampleMerchant] })
            .mockResolvedValueOnce({ merchant: sampleDetail, transactions: [] });

        render(<Merchants token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Le Bon Coin'));

        expect(await screen.findByText('Retour aux marchands')).toBeInTheDocument();
        expect(screen.getByText('Solde Ventes / Paiements')).toBeInTheDocument();
        expect(screen.getByText('Solde Commission')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenLastCalledWith(expect.stringContaining('/api/admin/merchants/m1'), expect.anything());
    });

    it("n'affiche pas les boutons Approuver/Rejeter sans perm_merchant_manage", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ merchants: [sampleMerchant] })
            .mockResolvedValueOnce({ merchant: sampleDetail, transactions: [] });

        render(<Merchants token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Le Bon Coin'));

        expect(await screen.findByText('Demandes de retrait (1)')).toBeInTheDocument();
        expect(screen.queryByText('Approuver')).not.toBeInTheDocument();
        expect(screen.queryByText('Rejeter')).not.toBeInTheDocument();
    });

    it('rejeter un retrait : exige un motif puis appelle POST /reject', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ merchants: [sampleMerchant] })
            .mockResolvedValueOnce({ merchant: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ merchant: { ...sampleDetail, merchantPayoutRequests: [{ ...sampleDetail.merchantPayoutRequests[0], status: 'REJECTED' }] }, transactions: [] })
            .mockResolvedValueOnce({ merchants: [sampleMerchant] });

        render(<Merchants token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Le Bon Coin'));
        fireEvent.click(await screen.findByText('Rejeter'));

        const confirmButton = await screen.findByRole('button', { name: 'Confirmer le rejet' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByPlaceholderText(/Motif du rejet/), { target: { value: 'Justificatif manquant' } });
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        expect(await screen.findByText('Retrait rejeté.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/merchants/m1/payouts/p1/reject'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Justificatif manquant' }) })
        );
    });

    it('approuver un retrait : appelle POST /approve sans motif requis', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ merchants: [sampleMerchant] })
            .mockResolvedValueOnce({ merchant: sampleDetail, transactions: [] })
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ merchant: { ...sampleDetail, merchantPayoutRequests: [{ ...sampleDetail.merchantPayoutRequests[0], status: 'EXECUTED' }] }, transactions: [] })
            .mockResolvedValueOnce({ merchants: [sampleMerchant] });

        render(<Merchants token="tok" hasPerm={() => true} />);
        fireEvent.click(await screen.findByText('Le Bon Coin'));
        fireEvent.click(await screen.findByText('Approuver'));

        fireEvent.click(await screen.findByRole('button', { name: "Confirmer l'approbation" }));

        expect(await screen.findByText('Retrait approuvé et exécuté.')).toBeInTheDocument();
        expect(mockedApiFetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/merchants/m1/payouts/p1/approve'),
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('revient à la liste au clic sur "Retour aux marchands"', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ merchants: [sampleMerchant] })
            .mockResolvedValueOnce({ merchant: sampleDetail, transactions: [] });

        render(<Merchants token="tok" hasPerm={() => false} />);
        fireEvent.click(await screen.findByText('Le Bon Coin'));
        fireEvent.click(await screen.findByText('Retour aux marchands'));

        expect(await screen.findByText('Marchands')).toBeInTheDocument();
    });
});
