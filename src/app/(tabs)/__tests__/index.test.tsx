import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockPush = jest.fn();
jest.mock('expo-router', () => {
    const react = require('react');
    return {
        useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
        useFocusEffect: (cb: any) => react.useEffect(() => { cb(); }, []),
    };
});

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(),
    hideAsync: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('../../../context/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

const mockApiGetBalance = jest.fn();
const mockApiGetTransactions = jest.fn();
jest.mock('../../../services/api', () => ({
    apiGetBalance: (...args: any[]) => mockApiGetBalance(...args),
    apiGetTransactions: (...args: any[]) => mockApiGetTransactions(...args),
}));

import DashboardScreen from '../index';

const baseUser = { id: 'u1', name: 'Jean Dupont', phone: '077000000', role: 'USER', wallet: { id: 'w1', balance: 1000, currency: 'FCFA' } };

describe('(tabs)/index (DashboardScreen)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: baseUser, logout: jest.fn(), settings: { seegEnabled: true, tontineEnabled: true } });
    });

    it('renders the empty state when there are no transactions', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);

        expect(await screen.findByText("Aucune transaction.")).toBeTruthy();
        expect(screen.getByText('Jean Dupont')).toBeTruthy();
    });

    it('renders populated transactions with status pills for pending/failed items', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 5000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([
            { id: 't1', type: 'incoming', amount: 2000, currency: 'FCFA', status: 'COMPLETED', counterpart: 'Alice', counterpartPhone: '077111111', createdAt: '2026-01-01T10:00:00.000Z' },
            { id: 't2', type: 'outgoing', amount: 500, currency: 'FCFA', status: 'PENDING', counterpart: 'Bob', counterpartPhone: '077222222', createdAt: '2026-01-02T10:00:00.000Z' },
            { id: 't3', type: 'outgoing', amount: 300, currency: 'FCFA', status: 'FAILED', counterpart: 'Carla', counterpartPhone: '077333333', createdAt: '2026-01-03T10:00:00.000Z' },
        ]);

        await render(<DashboardScreen />);

        expect(await screen.findByText('Alice')).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getByText('Carla')).toBeTruthy();
        expect(screen.getByText('En attente')).toBeTruthy();
        expect(screen.getByText('Échoué')).toBeTruthy();
    });

    // Le panneau "Caisse du Jour" (ventes/commission du jour) a été retiré de l'accueil et
    // déplacé vers merchant-hub.tsx (voir profile.tsx, menu "Espace Marchand" — jusque-là
    // orphelin, aucun écran ne le liait). L'accueil ne doit donc plus jamais rendre ni
    // récupérer ces stats, pour un compte MERCHANT comme pour un USER normal.
    it('renders the dashboard the same way for a MERCHANT account, without fetching merchant stats here anymore', async () => {
        mockUseAuth.mockReturnValue({
            user: { ...baseUser, role: 'MERCHANT' },
            logout: jest.fn(),
            settings: { seegEnabled: true, tontineEnabled: true },
        });
        mockApiGetBalance.mockResolvedValue({ balance: 5000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);

        expect(await screen.findByText("Aucune transaction.")).toBeTruthy();
        expect(screen.queryByText('Caisse du Jour')).toBeNull();
    });

    it('toggles balance visibility when the eye icon is pressed', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.queryByText('⬢⬢⬢⬢⬢⬢⬢⬢')).toBeNull();

        const eyeIcon = screen.getByText('eye-outline');
        fireEvent.press(eyeIcon);

        expect(await screen.findByText('⬢⬢⬢⬢⬢⬢⬢⬢')).toBeTruthy();
    });

    it('navigates to the transfer screen when "Envoyer" is pressed', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        fireEvent.press(screen.getByText('Envoyer'));
        expect(mockPush).toHaveBeenCalledWith('/transfer');
    });
});
