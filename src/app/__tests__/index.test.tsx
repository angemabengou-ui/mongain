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

import Index from '../index';

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
});
