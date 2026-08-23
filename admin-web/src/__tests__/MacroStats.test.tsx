import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MacroStats from '../MacroStats';

const stats = { revenue: 200000, totalVolume: 8000000, totalUsers: 500, agentsCount: 20, merchantsCount: 15 };
const ledger = [
    { status: 'COMPLETED', type: 'P2P', amount: 1000, reference: 'TX-1', createdAt: new Date().toISOString() },
    { status: 'FAILED', type: 'P2P', amount: 500, reference: 'TX-2', createdAt: new Date().toISOString() },
];

function mockFetchResponses() {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url.includes('/stats')) return Promise.resolve({ ok: true, json: () => Promise.resolve(stats) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ledger) });
    }));
}

describe('MacroStats', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        (global as any).ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    });

    it('affiche le message de chargement pendant le fetch', () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
        render(<MacroStats token="tok" />);
        expect(screen.getByText("Chargement de l'Analytique Globale...")).toBeInTheDocument();
    });

    it('affiche les statistiques macro une fois chargées', async () => {
        mockFetchResponses();
        render(<MacroStats token="tok" />);
        expect(await screen.findByText('Analytique Globale')).toBeInTheDocument();
        expect(screen.getByText(/200[\s ]000 FCFA/)).toBeInTheDocument();
        expect(screen.getByText('1 / 2 opérations réussies')).toBeInTheDocument();
    });

    it('affiche un message d\'erreur si les requêtes stats échouent', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
        render(<MacroStats token="tok" />);
        expect(await screen.findByText('Erreur de connexion au serveur.')).toBeInTheDocument();
    });
});
