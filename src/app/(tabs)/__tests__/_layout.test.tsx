import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockScreenCalls: any[] = [];
jest.mock('expo-router', () => {
    const TabsMock: any = ({ children }: any) => children;
    TabsMock.Screen = (props: any) => {
        mockScreenCalls.push(props);
        return null;
    };
    return { Tabs: TabsMock };
});

import TabLayout from '../_layout';

describe('(tabs)/_layout', () => {
    beforeEach(() => {
        mockScreenCalls.length = 0;
    });

    it('renders the nine tab screens with the expected titles', async () => {
        await render(<TabLayout />);

        // L'app a grandi de 3 à 9 onglets (cards, crypto, assistant, pay, credit, market
        // ajoutés depuis) sans que ce test soit mis à jour — il échouait systématiquement
        // dès le premier rendu, avant même d'atteindre ses propres assertions.
        expect(mockScreenCalls).toHaveLength(9);
        const byName = Object.fromEntries(mockScreenCalls.map((c) => [c.name, c.options]));

        expect(byName.index.title).toBe('Accueil');
        expect(byName.history.title).toBe('Historique');
        expect(byName.profile.title).toBe('Profil');
        expect(byName.cards.title).toBe('Cartes');
        expect(byName.crypto.title).toBe('Crypto V8');
        expect(byName.assistant.title).toBe('Assistant IA');
        expect(byName.pay.title).toBe('Payer');
        expect(byName.credit.title).toBe('Crédit Mongain');
        expect(byName.credit.href).toBeNull();
        expect(byName.market.title).toBe('Market');
    });
});
