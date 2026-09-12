import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import FamilyDetailScreen from '../../app/family-detail';
import { apiGetChildDetail, apiGetChildTransactions, apiSetChildLimit, apiTransfer } from '../../services/api';

// @expo/vector-icons pulls in expo-font -> expo-asset, qui n'est pas résolvable dans cet
// environnement (voir withdraw.test.tsx, même correctif) — sans rapport avec la logique testée.
jest.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.setTimeout(20000);

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
    useRouter: () => ({ back: mockBack }),
    useLocalSearchParams: () => ({ id: 'child_1' }),
    useFocusEffect: (cb: any) => { require('react').useEffect(cb, []); },
}));

jest.mock('../../services/api', () => ({
    apiGetChildDetail: jest.fn(),
    apiGetChildTransactions: jest.fn(),
    apiSetChildLimit: jest.fn(),
    apiTransfer: jest.fn(),
}));

const CHILD = {
    id: 'child_1',
    name: 'Junior Dupont',
    phone: '+24177000000',
    gender: 'MALE' as const,
    childSpendLimitAmount: null,
    childSpendLimitPeriod: null,
    createdAt: new Date().toISOString(),
    wallet: { id: 'w_child', balance: 10000, currency: 'FCFA' },
};

describe('FamilyDetailScreen (Comptes Enfant)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        (apiGetChildDetail as jest.Mock).mockResolvedValue(CHILD);
        (apiGetChildTransactions as jest.Mock).mockResolvedValue([]);
    });

    afterEach(() => {
        (Alert.alert as jest.Mock).mockRestore();
    });

    it("affiche le solde et le nom de l'enfant une fois chargé", async () => {
        const { getByText } = await render(<FamilyDetailScreen />);
        // Le nom apparaît deux fois (en-tête + ligne d'identité) : le téléphone, lui, est unique.
        await waitFor(() => expect(getByText('+24177000000')).toBeTruthy());
        expect(getByText(/10[\s ]000 FCFA/)).toBeTruthy();
    });

    // Régression : un échec de GET /family/children/:id/transactions était jusqu'ici absorbé
    // silencieusement (.catch(() => [])) et rendait EXACTEMENT le même message que "vraiment
    // aucune transaction" — un parent qui ouvre cet écran précisément pour la supervision ne
    // pouvait donc pas distinguer "rien à signaler" d'un chargement qui a réellement échoué.
    it("affiche un message d'échec distinct (pas 'Aucune transaction') si l'historique ne charge pas", async () => {
        (apiGetChildTransactions as jest.Mock).mockRejectedValue(new Error('Erreur serveur'));

        const { getByText, queryByText } = await render(<FamilyDetailScreen />);

        await waitFor(() => expect(getByText("Impossible de charger l'historique des transactions.")).toBeTruthy());
        expect(queryByText("Aucune transaction pour l'instant.")).toBeNull();
        expect(getByText('Réessayer')).toBeTruthy();
    });

    it("affiche bien 'Aucune transaction pour l'instant' quand l'historique charge avec succès mais est vide", async () => {
        const { getByText } = await render(<FamilyDetailScreen />);
        await waitFor(() => expect(getByText("Aucune transaction pour l'instant.")).toBeTruthy());
    });

    // Régression : apiTransfer (recharge du solde de l'enfant) n'est pas idempotent côté mobile
    // (aucune idempotencyKey envoyée) — sans garde anti double-tap synchrone, deux appuis rapides
    // sur "Confirmer" du PinPromptModal pouvaient tous deux passer avant que `actionLoading` ne
    // soit commité par React, déclenchant deux recharges pour une seule intention du parent.
    //
    // Chaque transition disabled→enabled (bouton "Recharger", puis "Confirmer" du modal PIN) est
    // enveloppée dans son propre `act()` : sans ça, `fireEvent.press` de ce projet (React 19 +
    // react-test-renderer) relit un `disabled` périmé issu du rendu précédent et n'invoque jamais
    // le onPress — indépendant du correctif testé ici, reproduit à l'identique sur un composant
    // TouchableOpacity minimal isolé pendant l'investigation de ce test.
    it("ne recharge l'enfant qu'une seule fois même si le PIN est confirmé deux fois rapidement", async () => {
        (apiTransfer as jest.Mock).mockResolvedValue({ message: 'ok', data: {} });

        const { getByText, getByPlaceholderText } = await render(<FamilyDetailScreen />);
        // Attend que les DEUX appels du Promise.all() de `load()` (détail + transactions) soient
        // pleinement retombés avant d'entamer les act() manuels ci-dessous — sinon leur portée
        // chevauche celle, encore active, du chargement initial déclenché par useFocusEffect.
        await waitFor(() => expect(getByText("Aucune transaction pour l'instant.")).toBeTruthy());

        await act(async () => { fireEvent.changeText(getByPlaceholderText('Montant en FCFA'), '5000'); });
        await act(async () => { fireEvent.press(getByText('Recharger')); });

        // Texte propre au PinPromptModal (message d'invite du PIN) — "Recharger le solde" est
        // ambigu, ce texte est aussi le titre de la section au-dessus, toujours présent.
        await waitFor(() => expect(getByText('Saisissez VOTRE code PIN (parent) pour confirmer.')).toBeTruthy());

        await act(async () => { fireEvent.changeText(getByPlaceholderText('⬢⬢⬢⬢'), '1234'); });

        const confirmBtn = getByText('Confirmer');
        // Les deux appuis DOIVENT rester dans le même act() synchrone : c'est ce qui simule un
        // vrai double-tap (le 2e appui s'exécute avant que le premier n'ait eu la moindre chance
        // de résoudre sa promesse apiTransfer et de réinitialiser submittingRef dans le `finally`).
        await act(async () => {
            fireEvent.press(confirmBtn);
            fireEvent.press(confirmBtn);
        });

        await waitFor(() => expect(apiTransfer).toHaveBeenCalledTimes(1));
    });
});
