import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../Dashboard';
import apiClient from '../utils/apiClient';

vi.mock('../utils/apiClient', () => ({
    default: { get: vi.fn() },
}));
const mockedGet = vi.mocked(apiClient.get);

const stats = { revenue: 125000, totalVolume: 4500000, totalUsers: 320, agentsCount: 12, merchantsCount: 8 };
const ledger = [
    { reference: 'FEE-1', status: 'COMPLETED', amount: 500, createdAt: new Date().toISOString() },
];

describe('Dashboard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedGet.mockReset();
        // jsdom n'implémente pas ResizeObserver, dont recharts' ResponsiveContainer a besoin.
        (global as any).ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    });

    it('affiche le message de connexion pendant le chargement', () => {
        mockedGet.mockReturnValue(new Promise(() => {})); // ne se résout jamais
        render(<Dashboard />);
        expect(screen.getByText('Connexion au serveur...')).toBeInTheDocument();
    });

    it('affiche les statistiques une fois chargées', async () => {
        mockedGet.mockImplementation((url: string) => {
            if (url.includes('/stats')) return Promise.resolve({ data: stats });
            return Promise.resolve({ data: ledger });
        });
        render(<Dashboard />);
        expect(await screen.findByText('Tableau de Bord')).toBeInTheDocument();
        expect(screen.getByText(/125[\s ]000 FCFA/)).toBeInTheDocument();
        expect(screen.getByText(/320/)).toBeInTheDocument();
    });

    it("affiche un message d'erreur quand le serveur répond une erreur", async () => {
        mockedGet.mockRejectedValue({ response: { data: { error: 'Session expirée.' } } });
        render(<Dashboard />);
        expect(await screen.findByText(/Session expirée\./)).toBeInTheDocument();
    });

    it('affiche un message générique quand le serveur est injoignable', async () => {
        mockedGet.mockRejectedValue(new Error('network fail'));
        render(<Dashboard />);
        expect(await screen.findByText(/Impossible de contacter le serveur\./)).toBeInTheDocument();
    });
});
