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
const mockApiGetLoyaltyBalance = jest.fn();
const mockApiConvertLoyaltyPoints = jest.fn();
jest.mock('../../../services/api', () => ({
    apiGetBalance: (...args: any[]) => mockApiGetBalance(...args),
    apiGetDailyLimits: (...args: any[]) => mockApiGetDailyLimits(...args),
    apiGetLoyaltyBalance: (...args: any[]) => mockApiGetLoyaltyBalance(...args),
    apiConvertLoyaltyPoints: (...args: any[]) => mockApiConvertLoyaltyPoints(...args),
}));

import { Alert } from 'react-native';
import ProfileScreen from '../profile';

const baseUser = { id: 'u1', name: 'Jean Dupont', phone: '077000000', email: 'jean.dupont@mongain.com', role: 'USER', wallet: { id: 'w1', balance: 1000, currency: 'FCFA' } };

describe('(tabs)/profile (ProfileScreen)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: baseUser, logout: mockLogout });
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetDailyLimits.mockResolvedValue({ skip: true });
        mockApiGetLoyaltyBalance.mockResolvedValue({ points: 0 });
        mockGetItemAsync.mockResolvedValue(null);
    });

    it('renders the user name, email and wallet balance', async () => {
        await render(<ProfileScreen />);

        // Le sous-titre affiché sous le nom est désormais l'email (userData?.email), pas le
        // téléphone — celui-ci n'apparaît plus du tout sur cet écran. L'ancienne assertion sur
        // '077000000' cherchait un texte que le composant ne rend plus.
        expect(await screen.findByText('Jean Dupont')).toBeTruthy();
        expect(screen.getByText('jean.dupont@mongain.com')).toBeTruthy();
        expect(mockApiGetBalance).toHaveBeenCalled();
    });

    it('shows the daily limits progress bar when limits are returned (non-skip)', async () => {
        mockApiGetDailyLimits.mockResolvedValue({ skip: false, dailySpend: 4000, dailyLimit: 10000, kycLevel: 0 });

        await render(<ProfileScreen />);

        // La carte de plafond journalier est désormais purement informative (barre de
        // progression + montant dépensé) — il n'existe plus de bouton "Débloquer la limite"
        // dans cet écran ; l'ancienne assertion visait un texte qui n'existe plus.
        expect(await screen.findByText('Plafond Journalier')).toBeTruthy();
        expect(screen.getByText(/4\s000/)).toBeTruthy();
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

    it('shows the loyalty points balance from the real backend endpoint (not the old dead /api/users/profile call)', async () => {
        mockApiGetLoyaltyBalance.mockResolvedValue({ points: 5000 });

        await render(<ProfileScreen />);

        expect(await screen.findByText('5 000 MP')).toBeTruthy();
        expect(screen.getByText(/500 FCFA à convertir/)).toBeTruthy();
    });

    it('converts loyalty points to FCFA and refreshes both balances on confirmation', async () => {
        mockApiGetLoyaltyBalance.mockResolvedValueOnce({ points: 5000 }).mockResolvedValueOnce({ points: 0 });
        mockApiConvertLoyaltyPoints.mockResolvedValue({ message: 'Conversion réussie !' });
        jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
            const confirm = buttons?.find(b => b.text === 'Convertir');
            confirm?.onPress?.();
        });

        await render(<ProfileScreen />);
        await screen.findByText('5 000 MP');

        fireEvent.press(screen.getByText('Convertir en FCFA'));

        await screen.findByText('0 MP');
        expect(mockApiConvertLoyaltyPoints).toHaveBeenCalledWith(5000);
    });
});
