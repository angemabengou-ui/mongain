import { render } from '@testing-library/react-native';
import React from 'react';

const mockRedirect = jest.fn((_props: any) => null);
jest.mock('expo-router', () => ({
    Redirect: (props: any) => {
        mockRedirect(props);
        return null;
    },
}));

const mockUseAuth = jest.fn();
jest.mock('../../context/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

import Index from '../../app/index';

describe('app/index (entry redirect)', () => {
    beforeEach(() => {
        mockRedirect.mockClear();
    });

    it('redirects to the (tabs) group once a session is confirmed', async () => {
        mockUseAuth.mockReturnValue({ token: 'abc', isLoading: false });
        await render(<Index />);
        expect(mockRedirect).toHaveBeenCalledWith(expect.objectContaining({ href: '/(tabs)' }));
    });

    it("ne redirige nulle part tant que la session est en cours de restauration", async () => {
        // Bug réel corrigé : une redirection inconditionnelle ici se déclenchait avant même
        // que _layout.tsx (seule source de vérité pour /auth/login vs l'app) ait pu décider,
        // montant le Dashboard avec un token absent/périmé.
        mockUseAuth.mockReturnValue({ token: null, isLoading: true });
        await render(<Index />);
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it("ne redirige pas vers (tabs) une fois la session résolue sans token — laisse _layout.tsx gérer /auth/login", async () => {
        mockUseAuth.mockReturnValue({ token: null, isLoading: false });
        await render(<Index />);
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    // Régression : écran blanc au démarrage signalé par des utilisateurs. `isLoading` peut
    // repasser à false avant que `notReady` de _layout.tsx (qui attend EN PLUS les polices et
    // le montage du routeur) ne se résolve — le cas le plus fréquent étant justement un
    // démarrage à froid SANS session stockée, où restoreSession() se termine quasi
    // instantanément. Pendant cette fenêtre, cet écran est le seul monté ; un `return null`
    // ici laissait voir le fond blanc par défaut de React Native. Ce test ne vérifie pas
    // seulement l'ABSENCE de redirection prématurée (déjà couvert ci-dessus) mais que quelque
    // chose est réellement rendu (jamais un arbre vide) tant que le token n'est pas confirmé.
    it("affiche un indicateur de chargement (jamais un rendu vide) tant que le token n'est pas confirmé", async () => {
        mockUseAuth.mockReturnValue({ token: null, isLoading: false });
        const { toJSON } = await render(<Index />);
        expect(toJSON()).not.toBeNull();
    });

    it("affiche aussi un indicateur de chargement pendant la restauration de session", async () => {
        mockUseAuth.mockReturnValue({ token: null, isLoading: true });
        const { toJSON } = await render(<Index />);
        expect(toJSON()).not.toBeNull();
    });
});
