import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockPush = jest.fn();
const mockScreenCalls: any[] = [];
jest.mock('expo-router', () => {
    const TabsMock: any = ({ children }: any) => children;
    TabsMock.Screen = (props: any) => {
        mockScreenCalls.push(props);
        return null;
    };
    return { Tabs: TabsMock, useRouter: () => ({ push: mockPush }) };
});

const mockUseAuth = jest.fn();
jest.mock('../../../context/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

import TabLayout from '../_layout';

const baseUser = { id: 'u1', name: 'Jean Dupont', role: 'USER' };

describe('(tabs)/_layout', () => {
    beforeEach(() => {
        mockScreenCalls.length = 0;
        mockPush.mockClear();
        mockUseAuth.mockReturnValue({ user: baseUser });
    });

    // Refonte de la tab bar (5 onglets visibles + 4 masqués derrière href:null, un bouton
    // QR flottant au centre) — ce test datait de la version précédente (9 onglets tous
    // visibles, "pay" menant à un onglet classique) et échouait dès le premier rendu.
    it('renders the five visible tabs and four hidden screens with the expected titles', async () => {
        await render(<TabLayout />);

        expect(mockScreenCalls).toHaveLength(9);
        const byName = Object.fromEntries(mockScreenCalls.map((c) => [c.name, c.options]));

        expect(byName.index.title).toBe('Accueil');
        expect(byName.history.title).toBe('Historique');
        expect(byName.services.title).toBe('Services');
        expect(byName.profile.title).toBe('Profil');
        expect(byName.pay.title).toBe('');

        // Écrans du groupe (tabs) volontairement absents de la barre — atteignables
        // uniquement par navigation directe (voir index.tsx pour cards/assistant,
        // services.tsx pour crypto/credit, profile.tsx pour merchant-hub).
        expect(byName.cards.href).toBeNull();
        expect(byName.crypto.href).toBeNull();
        expect(byName.assistant.href).toBeNull();
        expect(byName.credit.href).toBeNull();
    });

    it('intercepts the "pay" tab press to redirect to the QR scanner instead of navigating to it', async () => {
        await render(<TabLayout />);

        const payCall = mockScreenCalls.find((c) => c.name === 'pay');
        expect(payCall.listeners).toBeTruthy();

        const preventDefault = jest.fn();
        payCall.listeners.tabPress({ preventDefault });

        expect(preventDefault).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith('/qr');
    });

    // Restriction de navigation "Comptes Enfant" : l'onglet "Services" (Micro-crédit / BNPL /
    // Crypto / Staking) n'est approuvé pour aucun compte CHILD — voir (tabs)/index.tsx pour
    // les mêmes restrictions appliquées au tableau de bord (Cartes/Diviser/Internat.).
    it('hides the "services" tab (href: null) for a CHILD-role user', async () => {
        mockUseAuth.mockReturnValue({ user: { ...baseUser, role: 'CHILD' } });

        await render(<TabLayout />);

        const byName = Object.fromEntries(mockScreenCalls.map((c) => [c.name, c.options]));
        expect(byName.services.href).toBeNull();
    });

    it('keeps the "services" tab normal (no href override) for a non-CHILD user — no regression', async () => {
        await render(<TabLayout />);

        const byName = Object.fromEntries(mockScreenCalls.map((c) => [c.name, c.options]));
        expect(byName.services.href).toBeUndefined();
    });
});
