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

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
jest.mock('expo-secure-store', () => ({
    getItemAsync: (...args: any[]) => mockGetItemAsync(...args),
    setItemAsync: (...args: any[]) => mockSetItemAsync(...args),
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();
jest.mock('../../../context/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

const mockApiGetBalance = jest.fn();
const mockApiGetDailyLimits = jest.fn();
jest.mock('../../../services/api', () => ({
    apiGetBalance: (...args: any[]) => mockApiGetBalance(...args),
    apiGetDailyLimits: (...args: any[]) => mockApiGetDailyLimits(...args),
}));

import ProfileScreen from '../profile';

const baseUser = { id: 'u1', name: 'Jean Dupont', phone: '077000000', role: 'USER', wallet: { id: 'w1', balance: 1000, currency: 'FCFA' } };

describe('(tabs)/profile (ProfileScreen)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: baseUser, logout: mockLogout });
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetDailyLimits.mockResolvedValue({ skip: true });
        mockGetItemAsync.mockResolvedValue(null);
    });

    it('renders the user name, phone and wallet balance', async () => {
        await render(<ProfileScreen />);

        expect(await screen.findByText('Jean Dupont')).toBeTruthy();
        expect(screen.getByText('077000000')).toBeTruthy();
        expect(mockApiGetBalance).toHaveBeenCalled();
    });

    it('shows the daily limits progress bar when limits are returned (non-skip)', async () => {
        mockApiGetDailyLimits.mockResolvedValue({ skip: false, dailySpend: 4000, dailyLimit: 10000, kycLevel: 0 });

        await render(<ProfileScreen />);

        expect(await screen.findByText('Plafond Journalier')).toBeTruthy();
        expect(screen.getByText(/Débloquer la limite/)).toBeTruthy();
    });

    it('does not fetch daily limits for non-USER roles', async () => {
        mockUseAuth.mockReturnValue({ user: { ...baseUser, role: 'MERCHANT' }, logout: mockLogout });

        await render(<ProfileScreen />);
        await screen.findByText('Jean Dupont');

        expect(mockApiGetDailyLimits).not.toHaveBeenCalled();
    });

    it('calls logout when "Se déconnecter" is pressed', async () => {
        await render(<ProfileScreen />);
        await screen.findByText('Jean Dupont');

        fireEvent.press(screen.getByText('Se déconnecter'));

        expect(mockLogout).toHaveBeenCalled();
    });

    it('toggles the AppLock switch and persists the preference', async () => {
        await render(<ProfileScreen />);
        await screen.findByText('Jean Dupont');

        const toggle = screen.getByRole('switch');
        fireEvent(toggle, 'valueChange', true);

        expect(await screen.findByText('Verrou Biométrique')).toBeTruthy();
        expect(mockSetItemAsync).toHaveBeenCalledWith('appLockEnabled', 'true');
    });
});
