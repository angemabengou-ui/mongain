import { render, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import WithdrawFormScreen from '../withdraw-form';
import { apiPushWithdrawal } from '../../services/api';

jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.setTimeout(20000);

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: any = { method: 'AIRTEL' };

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
    useLocalSearchParams: () => mockParams,
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
    apiPushWithdrawal: jest.fn(),
}));

describe('WithdrawFormScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockParams = { method: 'AIRTEL' };
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it('renders with the provider name in the header', async () => {
        const { getByText } = await render(<WithdrawFormScreen />);
        await waitFor(() => {
            expect(getByText('Envoyer à Airtel Money')).toBeTruthy();
        });
    });

    it('shows an alert when amount is below the minimum', async () => {
        const { getByText, getByPlaceholderText } = await render(<WithdrawFormScreen />);
        await waitFor(() => expect(getByText('Valider le Retrait')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Ex: 077... ou 066...'), '77000000');
        await fireEvent.changeText(getByPlaceholderText('0'), '100');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234');
        await fireEvent.press(getByText('Valider le Retrait'));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith('Erreur', 'Le montant minimum de retrait est de 500 FCFA.');
        });
        expect(apiPushWithdrawal).not.toHaveBeenCalled();
    });

    it('shows an alert when PIN is not 4 digits', async () => {
        const { getByText, getByPlaceholderText } = await render(<WithdrawFormScreen />);
        await waitFor(() => expect(getByText('Valider le Retrait')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Ex: 077... ou 066...'), '77000000');
        await fireEvent.changeText(getByPlaceholderText('0'), '1000');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '12');
        await fireEvent.press(getByText('Valider le Retrait'));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith('Erreur', 'Veuillez entrer votre code PIN Mongain à 4 chiffres.');
        });
        expect(apiPushWithdrawal).not.toHaveBeenCalled();
    });

    it('submits a successful withdrawal and shows the success screen', async () => {
        (apiPushWithdrawal as jest.Mock).mockResolvedValue({ message: 'ok', reference: 'ref', network: 'AIRTEL' });

        const { getByText, getByPlaceholderText } = await render(<WithdrawFormScreen />);
        await waitFor(() => expect(getByText('Valider le Retrait')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Ex: 077... ou 066...'), '77000000');
        await fireEvent.changeText(getByPlaceholderText('0'), '1000');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234');
        await fireEvent.press(getByText('Valider le Retrait'));

        await waitFor(() => {
            expect(apiPushWithdrawal).toHaveBeenCalledWith('+24177000000', 1000, 'AIRTEL', '1234');
        });
        await waitFor(() => {
            expect(getByText('Retrait Effectué !')).toBeTruthy();
        });
    });

    it('shows an error alert when the withdrawal fails (e.g. insufficient funds)', async () => {
        (apiPushWithdrawal as jest.Mock).mockRejectedValue(new Error('Solde insuffisant'));

        const { getByText, getByPlaceholderText } = await render(<WithdrawFormScreen />);
        await waitFor(() => expect(getByText('Valider le Retrait')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Ex: 077... ou 066...'), '77000000');
        await fireEvent.changeText(getByPlaceholderText('0'), '1000');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234');
        await fireEvent.press(getByText('Valider le Retrait'));

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith('Erreur de transaction', 'Solde insuffisant');
        });
    });
});
