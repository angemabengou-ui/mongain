import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import TillCollectScreen from '../../app/till-collect';
import { apiTillCollect, deleteTillToken } from '../../services/api';

// @expo/vector-icons pulls in expo-font -> expo-asset, qui n'est pas résolvable dans cet
// environnement (voir withdraw.test.tsx/family-detail.test.tsx, même correctif) — sans
// rapport avec la logique testée ici.
jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('../../services/api', () => ({
    apiTillCollect: jest.fn(),
    deleteTillToken: jest.fn(),
}));

// Simule l'appui sur un bouton d'un Alert.alert à choix multiples (confirmation
// encaissement/déconnexion) — la boîte de dialogue native n'existe pas dans cet
// environnement de test, voir handleCollect/handleLogout dans l'écran (même pattern que
// merchant-affiliations.test.tsx).
function pressAlertButton(text: string) {
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const buttons = call?.[2] as { text: string; onPress?: () => void }[] | undefined;
    buttons?.find(b => b.text === text)?.onPress?.();
}

describe('TillCollectScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it("affiche le formulaire d'encaissement de base", async () => {
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);

        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());
        expect(getByPlaceholderText('Code / ID client')).toBeTruthy();
        expect(getByPlaceholderText('ex : 5000')).toBeTruthy();
        expect(getByText("Valider l'encaissement")).toBeTruthy();
    });

    it('affiche une erreur si le code client est manquant', async () => {
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('ex : 5000'), '5000');
        await fireEvent.press(getByText("Valider l'encaissement"));

        await waitFor(() => expect(getByText('Scannez ou saisissez le code du client.')).toBeTruthy());
        expect(apiTillCollect).not.toHaveBeenCalled();
    });

    it('affiche une erreur si le montant est invalide', async () => {
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Code / ID client'), 'user_123');
        await fireEvent.press(getByText("Valider l'encaissement"));

        await waitFor(() => expect(getByText('Montant invalide.')).toBeTruthy());
        expect(apiTillCollect).not.toHaveBeenCalled();
    });

    it('exige toujours le PIN client (4 chiffres)', async () => {
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Code / ID client'), 'user_123');
        await fireEvent.changeText(getByPlaceholderText('ex : 5000'), '5000');
        await fireEvent.press(getByText("Valider l'encaissement"));

        await waitFor(() => expect(getByText('Le client doit saisir son code PIN à 4 chiffres pour autoriser le paiement.')).toBeTruthy());
        expect(apiTillCollect).not.toHaveBeenCalled();
    });

    it('appelle apiTillCollect(scannedCode, amountXaf, pin) après confirmation', async () => {
        (apiTillCollect as jest.Mock).mockResolvedValue({ message: 'Encaissement QR réussi !', amount: 5000 });
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Code / ID client'), 'user_123');
        await fireEvent.changeText(getByPlaceholderText('ex : 5000'), '5000');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234');
        await fireEvent.press(getByText("Valider l'encaissement"));
        pressAlertButton('Confirmer');

        await waitFor(() => expect(apiTillCollect).toHaveBeenCalledWith('user_123', 5000, '1234'));
    });

    it("affiche l'erreur serveur si l'encaissement échoue", async () => {
        (apiTillCollect as jest.Mock).mockRejectedValue(new Error('Solde client insuffisant.'));
        const { getByText, getByPlaceholderText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.changeText(getByPlaceholderText('Code / ID client'), 'user_123');
        await fireEvent.changeText(getByPlaceholderText('ex : 5000'), '5000');
        await fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234');
        await fireEvent.press(getByText("Valider l'encaissement"));
        pressAlertButton('Confirmer');

        await waitFor(() => expect(getByText('Solde client insuffisant.')).toBeTruthy());
    });

    it('purge le token guichet puis renvoie vers /till-login quand la déconnexion est confirmée', async () => {
        (deleteTillToken as jest.Mock).mockResolvedValue(undefined);
        const { getByLabelText, getByText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.press(getByLabelText('Déconnexion du guichet'));
        pressAlertButton('Se déconnecter');

        await waitFor(() => expect(deleteTillToken).toHaveBeenCalled());
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/till-login'));
    });

    it('ne déclenche aucune action si la déconnexion est annulée', async () => {
        const { getByLabelText, getByText } = await render(<TillCollectScreen />);
        await waitFor(() => expect(getByText('Encaissement Guichet')).toBeTruthy());

        await fireEvent.press(getByLabelText('Déconnexion du guichet'));
        pressAlertButton('Annuler');

        expect(deleteTillToken).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
