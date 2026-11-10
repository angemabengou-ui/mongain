import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import MerchantApiKeysScreen from '../../app/merchant-api-keys';
import {
    apiGenerateGatewayKey,
    apiGetGatewayKeys,
    apiRotateGatewayKey,
    apiUpdateGatewayKey,
} from '../../services/api';

// @expo/vector-icons pulls in expo-font -> expo-asset, qui n'est pas résolvable dans cet
// environnement (voir withdraw.test.tsx/family-detail.test.tsx, même correctif) — sans
// rapport avec la logique testée ici.
jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({ back: mockBack }),
    useFocusEffect: (cb: any) => { require('react').useEffect(cb, []); },
}));

const mockSetStringAsync = jest.fn();
jest.mock('expo-clipboard', () => ({
    setStringAsync: (...args: any[]) => mockSetStringAsync(...args),
}));

jest.mock('../../services/api', () => ({
    apiGenerateGatewayKey: jest.fn(),
    apiGetGatewayKeys: jest.fn(),
    apiRotateGatewayKey: jest.fn(),
    apiUpdateGatewayKey: jest.fn(),
}));

const INTEGRATION = {
    id: 'int_1',
    appName: 'Mon site web',
    environment: 'LIVE',
    publicKey: 'pk_live_abc',
    webhookUrl: 'https://monsite.com/webhooks/mongain',
    isActive: true,
    createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    rotatedAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
};

// Simule l'appui sur un bouton d'un Alert.alert à choix multiples (confirmation de
// régénération) — la boîte de dialogue native n'existe pas dans cet environnement de test,
// voir handleRotate dans l'écran (même pattern que merchant-affiliations.test.tsx).
function pressAlertButton(text: string) {
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const buttons = call?.[2] as { text: string; onPress?: () => void }[] | undefined;
    buttons?.find(b => b.text === text)?.onPress?.();
}

describe('MerchantApiKeysScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it("affiche l'explication non-technique et la liste des intégrations une fois chargée", async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([INTEGRATION]);

        const { getByText } = await render(<MerchantApiKeysScreen />);

        await waitFor(() => expect(getByText('Mon site web')).toBeTruthy());
        expect(getByText('Permet à votre site web de recevoir automatiquement une confirmation quand un client vous paie.')).toBeTruthy();
        expect(getByText('https://monsite.com/webhooks/mongain')).toBeTruthy();
        expect(getByText('Actif')).toBeTruthy();
    });

    it('affiche "Aucune intégration" quand la liste charge avec succès mais est vide', async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([]);

        const { getByText } = await render(<MerchantApiKeysScreen />);

        await waitFor(() => expect(getByText('Aucune intégration pour l\'instant.')).toBeTruthy());
    });

    it("affiche un message d'erreur distinct (pas une liste vide) si le chargement échoue, avec un bouton Réessayer", async () => {
        (apiGetGatewayKeys as jest.Mock).mockRejectedValue(new Error('Erreur serveur'));

        const { getByText, queryByText } = await render(<MerchantApiKeysScreen />);

        await waitFor(() => expect(getByText('Erreur serveur')).toBeTruthy());
        expect(queryByText('Aucune intégration pour l\'instant.')).toBeNull();
        expect(getByText('Réessayer')).toBeTruthy();
    });

    it("révèle le secret et le secret de signature webhook UNE FOIS après la création, avec l'avertissement", async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([]);
        (apiGenerateGatewayKey as jest.Mock).mockResolvedValue({
            publicKey: 'pk_live_new',
            secret: 'sk_live_SECRET',
            webhookSigningSecret: 'whsec_SIGNING',
        });

        const { getByText, getByPlaceholderText, getByLabelText, queryByText } = await render(<MerchantApiKeysScreen />);
        await waitFor(() => expect(getByText('Aucune intégration pour l\'instant.')).toBeTruthy());

        // Le titre "Nouvelle intégration" (SectionHeading) n'est pas pressable lui-même — seule
        // l'icône chevron l'est (voir accessibilityLabel=title, SectionHeading.tsx).
        await fireEvent.press(getByLabelText('Nouvelle intégration'));
        await waitFor(() => expect(getByPlaceholderText('ex : Mon site web')).toBeTruthy());
        await fireEvent.changeText(getByPlaceholderText('ex : Mon site web'), 'Ma boutique');
        await fireEvent.press(getByText("Créer l'intégration"));

        await waitFor(() => expect(apiGenerateGatewayKey).toHaveBeenCalledWith('Ma boutique', undefined));
        await waitFor(() => expect(getByText('sk_live_SECRET')).toBeTruthy());
        expect(getByText('whsec_SIGNING')).toBeTruthy();
        expect(getByText('À copier maintenant : ne sera plus jamais affiché')).toBeTruthy();

        await fireEvent.press(getByText("J'ai copié mes clés"));
        await waitFor(() => expect(queryByText('sk_live_SECRET')).toBeNull());
    });

    it('copie la clé secrète révélée dans le presse-papiers', async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([]);
        (apiGenerateGatewayKey as jest.Mock).mockResolvedValue({
            publicKey: 'pk_live_new',
            secret: 'sk_live_SECRET',
            webhookSigningSecret: 'whsec_SIGNING',
        });

        const { getByText, getByPlaceholderText, getByLabelText } = await render(<MerchantApiKeysScreen />);
        await waitFor(() => expect(getByText('Aucune intégration pour l\'instant.')).toBeTruthy());

        await fireEvent.press(getByLabelText('Nouvelle intégration'));
        await waitFor(() => expect(getByPlaceholderText('ex : Mon site web')).toBeTruthy());
        await fireEvent.changeText(getByPlaceholderText('ex : Mon site web'), 'Ma boutique');
        await fireEvent.press(getByText("Créer l'intégration"));
        await waitFor(() => expect(getByText('sk_live_SECRET')).toBeTruthy());

        await fireEvent.press(getByLabelText('Copier la clé secrète'));
        expect(mockSetStringAsync).toHaveBeenCalledWith('sk_live_SECRET');
    });

    it("régénère les clés après confirmation et affiche à nouveau l'avertissement one-shot", async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([INTEGRATION]);
        (apiRotateGatewayKey as jest.Mock).mockResolvedValue({
            secret: 'sk_live_ROTATED',
            webhookSigningSecret: 'whsec_ROTATED',
        });

        const { getByText } = await render(<MerchantApiKeysScreen />);
        await waitFor(() => expect(getByText('Mon site web')).toBeTruthy());

        await fireEvent.press(getByText('Régénérer'));
        pressAlertButton('Régénérer');

        await waitFor(() => expect(apiRotateGatewayKey).toHaveBeenCalledWith('int_1'));
        await waitFor(() => expect(getByText('sk_live_ROTATED')).toBeTruthy());
    });

    it('bascule le statut actif/inactif via apiUpdateGatewayKey', async () => {
        (apiGetGatewayKeys as jest.Mock).mockResolvedValue([INTEGRATION]);
        (apiUpdateGatewayKey as jest.Mock).mockResolvedValue({ ...INTEGRATION, isActive: false });

        const { getByText } = await render(<MerchantApiKeysScreen />);
        await waitFor(() => expect(getByText('Mon site web')).toBeTruthy());

        await fireEvent.press(getByText('Désactiver'));

        await waitFor(() => expect(apiUpdateGatewayKey).toHaveBeenCalledWith('int_1', { isActive: false }));
    });
});
