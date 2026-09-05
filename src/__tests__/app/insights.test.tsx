import { render, screen } from '@testing-library/react-native';
import React from 'react';

function textOf(el: any) {
    return (Array.isArray(el.props.children) ? el.props.children : [el.props.children]).join('');
}

// toLocaleString('fr-FR') insère un espace fine insécable (U+202F) comme séparateur de
// milliers, pas une espace normale — un littéral "10 000" dans le test ne correspondrait
// jamais au texte réellement rendu. On dérive l'attendu de la même fonction que l'écran.
function fmt(amount: number) {
    return `${amount.toLocaleString('fr-FR')} FCFA`;
}

jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockBack = jest.fn();
jest.mock('expo-router', () => {
    const react = require('react');
    return {
        useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: mockBack }),
        useFocusEffect: (cb: any) => react.useEffect(() => { cb(); }, []),
    };
});

const mockApiGetTransactions = jest.fn();
jest.mock('../../services/api', () => ({
    apiGetTransactions: (...args: any[]) => mockApiGetTransactions(...args),
}));

import InsightsScreen from '../insights';

// "Maintenant" fixé au 15/01/2026 pour que le filtrage par mois calendaire soit déterministe.
const NOW = new Date('2026-01-15T12:00:00.000Z');

const tx = (overrides: Partial<any>) => ({
    id: 'tx', type: 'outgoing', amount: 1000, currency: 'FCFA', status: 'COMPLETED',
    reference: 'REF', counterpart: 'X', counterpartPhone: '077000000', createdAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
});

describe('InsightsScreen (Aperçu des dépenses)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("affiche l'état vide quand il n'y a aucune dépense ce mois-ci", async () => {
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<InsightsScreen />);

        expect(await screen.findByText('Aucune dépense ce mois-ci pour l\'instant.')).toBeTruthy();
        expect(mockApiGetTransactions).toHaveBeenCalledWith(100);
    });

    it('regroupe les dépenses par catégorie et calcule les totaux du mois en cours', async () => {
        mockApiGetTransactions.mockResolvedValue([
            tx({ id: 't1', reference: 'REF1', amount: 5000 }), // Transferts
            tx({ id: 't2', reference: 'VAULT_DEP_x', amount: 2000 }), // Caisse Commune
            tx({ id: 't3', reference: 'TONT_DBT_x', amount: 3000 }), // Tontine
            tx({ id: 't4', type: 'incoming', amount: 777 }), // Reçu, exclu de la répartition
        ]);

        await render(<InsightsScreen />);
        await screen.findByText('Transferts');

        expect(textOf(screen.getByTestId('total-spent-value'))).toBe(fmt(10000)); // 5000+2000+3000
        expect(textOf(screen.getByTestId('total-received-value'))).toBe(fmt(777));
        expect(screen.getByText('Caisse Commune')).toBeTruthy();
        expect(screen.getByText('Tontine')).toBeTruthy();
    });

    it('exclut les transactions en dehors du mois calendaire courant', async () => {
        mockApiGetTransactions.mockResolvedValue([
            tx({ id: 'old', createdAt: '2025-12-20T10:00:00.000Z', amount: 9999 }),
            tx({ id: 'current', amount: 1234 }),
        ]);

        await render(<InsightsScreen />);
        await screen.findByText('Transferts');

        expect(textOf(screen.getByTestId('total-spent-value'))).toBe(fmt(1234));
    });

    it('exclut les transactions non COMPLETED (ex : dépôt Mobile Money encore PENDING)', async () => {
        mockApiGetTransactions.mockResolvedValue([
            tx({ id: 'pending', status: 'PENDING', amount: 8888 }),
            tx({ id: 'done', amount: 555 }),
        ]);

        await render(<InsightsScreen />);
        await screen.findByText('Transferts');

        expect(textOf(screen.getByTestId('total-spent-value'))).toBe(fmt(555));
    });
});
