import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import WithdrawScreen from '../withdraw';
import { apiGenerateWithdrawCode, apiGetBalance } from '../../services/api';

// @expo/vector-icons pulls in expo-font -> expo-asset, which isn't resolvable in this
// environment's node_modules layout (hoisting issue unrelated to these screens). Icons
// render as plain host stubs — irrelevant to the logic under test.
jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Cold Babel transform of these screens on the first render in a suite can blow past the
// default 5s per-test timeout even though nothing is actually hanging.
jest.setTimeout(20000);

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: any) => { require('react').useEffect(cb, []); },
    Link: ({ children }: any) => children,
    Stack: { Screen: () => null },
}));

const mockUser = {
    id: 'u1',
    name: 'Test User',
    phone: '+24177000000',
    wallet: { id: 'w1', balance: 5000, currency: 'FCFA' },
};

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ user: mockUser, token: 'tok', settings: {} }),
}));

jest.mock('../../services/api', () => ({
    apiGetBalance: jest.fn(),
    apiGenerateWithdrawCode: jest.fn(),
}));

describe('WithdrawScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        (apiGetBalance as jest.Mock).mockResolvedValue({ balance: 5000, currency: 'FCFA' });
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it('renders the main screen with balance', async () => {
        const { getByText } = await render(<WithdrawScreen />);
        await waitFor(() => {
            expect(getByText('Retrait')).toBeTruthy();
        });
        await waitFor(() => {
            expect(getByText(/5[\s ]000 FCFA/)).toBeTruthy();
        });
    });

    it('navigates to withdraw-form when selecting Airtel', async () => {
        const { getByText } = await render(<WithdrawScreen />);
        await waitFor(() => expect(getByText('Vers Airtel Money')).toBeTruthy());
        await fireEvent.press(getByText('Vers Airtel Money'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/withdraw-form', params: { method: 'AIRTEL' } });
    });

    it('shows an alert for invalid amount when generating a secret code', async () => {
        const { getByText } = await render(<WithdrawScreen />);
        await waitFor(() => expect(getByText('Générer un Code (Guichet)')).toBeTruthy());
        await fireEvent.press(getByText('Générer un Code (Guichet)'));

        await waitFor(() => expect(getByText('Générer le code')).toBeTruthy());
        // Leave amount empty (0) and try to submit
        await fireEvent.press(getByText('Générer le code'));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith('Montant invalide', expect.any(String));
        });
        expect(apiGenerateWithdrawCode).not.toHaveBeenCalled();
    });

    it('generates a withdraw code successfully and shows it', async () => {
        (apiGenerateWithdrawCode as jest.Mock).mockResolvedValue({
            code: '123456',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });

        const { getByText, getByPlaceholderText } = await render(<WithdrawScreen />);
        await waitFor(() => expect(getByText('Générer un Code (Guichet)')).toBeTruthy());
        await fireEvent.press(getByText('Générer un Code (Guichet)'));

        await waitFor(() => expect(getByPlaceholderText('0')).toBeTruthy());
        await fireEvent.changeText(getByPlaceholderText('0'), '1000');
        await fireEvent.press(getByText('Générer le code'));

        await waitFor(() => {
            expect(apiGenerateWithdrawCode).toHaveBeenCalledWith(1000);
        });
        await waitFor(() => {
            expect(getByText('123 456')).toBeTruthy();
        });
    });

    it('shows an error alert when code generation fails', async () => {
        (apiGenerateWithdrawCode as jest.Mock).mockRejectedValue(new Error('Erreur serveur'));

        const { getByText, getByPlaceholderText } = await render(<WithdrawScreen />);
        await waitFor(() => expect(getByText('Générer un Code (Guichet)')).toBeTruthy());
        await fireEvent.press(getByText('Générer un Code (Guichet)'));

        await waitFor(() => expect(getByPlaceholderText('0')).toBeTruthy());
        await fireEvent.changeText(getByPlaceholderText('0'), '1000');
        await fireEvent.press(getByText('Générer le code'));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith('Échec', 'Erreur serveur');
        });
    });
});
