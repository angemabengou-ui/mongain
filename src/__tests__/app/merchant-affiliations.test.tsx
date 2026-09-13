import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import MerchantAffiliationsScreen from '../../app/merchant-affiliations';
import { apiGetMerchantAffiliations, apiRespondMerchantAffiliation } from '../../services/api';

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

jest.mock('../../services/api', () => ({
    apiGetMerchantAffiliations: jest.fn(),
    apiRespondMerchantAffiliation: jest.fn(),
}));

const PENDING_AFFILIATION = {
    id: 'aff_1',
    status: 'PENDING' as const,
    createdAt: new Date('2026-01-01T10:00:00.000Z').toISOString(),
    giant: { id: 'giant_1', name: 'Mairie de Libreville' },
};

const ACCEPTED_AFFILIATION = {
    id: 'aff_2',
    status: 'ACCEPTED' as const,
    createdAt: new Date('2025-06-01T10:00:00.000Z').toISOString(),
    respondedAt: new Date('2025-06-02T10:00:00.000Z').toISOString(),
    giant: { id: 'giant_2', name: 'Impôts Gabon' },
};

// Simule l'appui sur un bouton d'un Alert.alert à choix multiples (confirmation
// Accepter/Refuser) — la boîte de dialogue native n'existe pas dans cet environnement de
// test, voir handleRespond dans l'écran.
function pressAlertButton(text: string) {
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const buttons = call?.[2] as { text: string; onPress?: () => void }[] | undefined;
    buttons?.find(b => b.text === text)?.onPress?.();
}

describe('MerchantAffiliationsScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it('liste les demandes PENDING avec des boutons Accepter/Refuser une fois chargées', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([PENDING_AFFILIATION]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());
        expect(getByText('Accepter')).toBeTruthy();
        expect(getByText('Refuser')).toBeTruthy();
    });

    // Régression à ne pas réintroduire (voir family-detail.test.tsx, même correctif appliqué
    // plus tôt cette session) : un .catch(() => []) silencieux rendrait ici EXACTEMENT le même
    // écran "Aucune demande en attente" qu'un vrai succès à liste vide — un marchand qui vient
    // consulter précisément pour savoir s'il a une demande en attente ne pourrait alors pas
    // distinguer "rien à signaler" d'un chargement qui a réellement échoué.
    it("affiche un message d'erreur distinct (pas une liste vide) si le chargement échoue, avec un bouton Réessayer", async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockRejectedValue(new Error('Erreur serveur'));

        const { getByText, queryByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Erreur serveur')).toBeTruthy());
        expect(queryByText('Aucune demande en attente.')).toBeNull();
        expect(getByText('Réessayer')).toBeTruthy();
    });

    it('affiche "Aucune demande en attente" quand la liste charge avec succès mais est vide', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Aucune demande en attente.')).toBeTruthy());
        expect(getByText("Aucune affiliation traitée pour l'instant.")).toBeTruthy();
    });

    it('appelle apiRespondMerchantAffiliation(id, true) puis recharge la liste quand "Accepter" est confirmé', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([PENDING_AFFILIATION]);
        (apiRespondMerchantAffiliation as jest.Mock).mockResolvedValue({ ...PENDING_AFFILIATION, status: 'ACCEPTED' });

        const { getByText } = await render(<MerchantAffiliationsScreen />);
        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());

        fireEvent.press(getByText('Accepter'));
        pressAlertButton('Accepter');

        await waitFor(() => expect(apiRespondMerchantAffiliation).toHaveBeenCalledWith('aff_1', true));
        await waitFor(() => expect(apiGetMerchantAffiliations).toHaveBeenCalledTimes(2));
    });

    it('appelle apiRespondMerchantAffiliation(id, false) quand "Refuser" est confirmé', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([PENDING_AFFILIATION]);
        (apiRespondMerchantAffiliation as jest.Mock).mockResolvedValue({ ...PENDING_AFFILIATION, status: 'REJECTED' });

        const { getByText } = await render(<MerchantAffiliationsScreen />);
        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());

        fireEvent.press(getByText('Refuser'));
        pressAlertButton('Refuser');

        await waitFor(() => expect(apiRespondMerchantAffiliation).toHaveBeenCalledWith('aff_1', false));
    });

    it('ajoute la fréquence de versement attendue (mensuelle) dans la confirmation quand expectedFrequency=MONTHLY', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([{ ...PENDING_AFFILIATION, expectedFrequency: 'MONTHLY' }]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);
        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());

        fireEvent.press(getByText('Accepter'));

        const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
        expect(call?.[1]).toContain('Fréquence de versement attendue : mensuelle');
    });

    it('ajoute la fréquence de versement attendue (hebdomadaire) dans la confirmation quand expectedFrequency=WEEKLY', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([{ ...PENDING_AFFILIATION, expectedFrequency: 'WEEKLY' }]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);
        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());

        fireEvent.press(getByText('Accepter'));

        const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
        expect(call?.[1]).toContain('Fréquence de versement attendue : hebdomadaire');
    });

    it("n'ajoute aucune mention de fréquence quand expectedFrequency est absent", async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([PENDING_AFFILIATION]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);
        await waitFor(() => expect(getByText('Mairie de Libreville')).toBeTruthy());

        fireEvent.press(getByText('Accepter'));

        const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
        expect(call?.[1]).not.toContain('Fréquence de versement attendue');
    });

    it('affiche un badge "À jour" pour une affiliation ACCEPTED avec complianceStatus=OK', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([{ ...ACCEPTED_AFFILIATION, complianceStatus: 'OK' }]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Impôts Gabon')).toBeTruthy());
        expect(getByText('À jour')).toBeTruthy();
    });

    it('affiche un badge "En retard" pour une affiliation ACCEPTED avec complianceStatus=LATE', async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([{ ...ACCEPTED_AFFILIATION, complianceStatus: 'LATE' }]);

        const { getByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Impôts Gabon')).toBeTruthy());
        expect(getByText('En retard')).toBeTruthy();
    });

    it("n'affiche aucun badge de conformité quand complianceStatus est absent", async () => {
        (apiGetMerchantAffiliations as jest.Mock).mockResolvedValue([ACCEPTED_AFFILIATION]);

        const { getByText, queryByText } = await render(<MerchantAffiliationsScreen />);

        await waitFor(() => expect(getByText('Impôts Gabon')).toBeTruthy());
        expect(queryByText('À jour')).toBeNull();
        expect(queryByText('En retard')).toBeNull();
    });
});
