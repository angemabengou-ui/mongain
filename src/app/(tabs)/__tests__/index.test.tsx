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

jest.mock('expo-splash-screen', () => ({
    preventAutoHideAsync: jest.fn(),
    hideAsync: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('../../../context/AuthContext', () => ({
    useAuth: () => mockUseAuth(),
}));

const mockApiGetBalance = jest.fn();
const mockApiGetTransactions = jest.fn();
// apiGetUnreadCount manquait de ce mock : loadData() l'appelle dans le MÊME Promise.all()
// que apiGetBalance/apiGetTransactions, donc l'appeler alors qu'il valait `undefined` dans
// le module mocké levait un TypeError synchrone AVANT même que Promise.all ne s'exécute.
// Résultat : `transactions` restait bloqué sur son état initial ([]), et l'écran retombait
// sur les 3 transactions FICTIVES de démo (voir index.tsx, "Dummy data for preview") au lieu
// des vraies — "Alice"/"Bob"/"Carla" n'apparaissaient donc jamais (d'où le timeout de
// findByText). Bug de ce test, pas de l'écran réel.
const mockApiGetUnreadCount = jest.fn();
jest.mock('../../../services/api', () => ({
    apiGetBalance: (...args: any[]) => mockApiGetBalance(...args),
    apiGetTransactions: (...args: any[]) => mockApiGetTransactions(...args),
    apiGetUnreadCount: (...args: any[]) => mockApiGetUnreadCount(...args),
}));

import DashboardScreen from '../index';

const baseUser = { id: 'u1', name: 'Jean Dupont', phone: '077000000', role: 'USER', wallet: { id: 'w1', balance: 1000, currency: 'FCFA' } };

describe('(tabs)/index (DashboardScreen)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseAuth.mockReturnValue({ user: baseUser, logout: jest.fn(), settings: { seegEnabled: true, tontineEnabled: true } });
        mockApiGetUnreadCount.mockResolvedValue({ count: 0 });
    });

    it('renders the empty state when there are no transactions', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);

        expect(await screen.findByText("Aucune transaction.")).toBeTruthy();
        expect(screen.getByText('Jean Dupont')).toBeTruthy();
    });

    it('renders populated transactions with status pills for pending/failed items', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 5000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([
            { id: 't1', type: 'incoming', amount: 2000, currency: 'FCFA', status: 'COMPLETED', counterpart: 'Alice', counterpartPhone: '077111111', createdAt: '2026-01-01T10:00:00.000Z' },
            { id: 't2', type: 'outgoing', amount: 500, currency: 'FCFA', status: 'PENDING', counterpart: 'Bob', counterpartPhone: '077222222', createdAt: '2026-01-02T10:00:00.000Z' },
            { id: 't3', type: 'outgoing', amount: 300, currency: 'FCFA', status: 'FAILED', counterpart: 'Carla', counterpartPhone: '077333333', createdAt: '2026-01-03T10:00:00.000Z' },
        ]);

        await render(<DashboardScreen />);

        expect(await screen.findByText('Alice')).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();
        expect(screen.getByText('Carla')).toBeTruthy();
        expect(screen.getByText('En attente')).toBeTruthy();
        expect(screen.getByText('Échoué')).toBeTruthy();
    });

    // Le panneau "Caisse du Jour" (ventes/commission du jour) a été retiré de l'accueil et
    // déplacé vers merchant-hub.tsx (voir profile.tsx, menu "Espace Marchand" — jusque-là
    // orphelin, aucun écran ne le liait). L'accueil ne doit donc plus jamais rendre ni
    // récupérer ces stats, pour un compte MERCHANT comme pour un USER normal.
    it('renders the dashboard the same way for a MERCHANT account, without fetching merchant stats here anymore', async () => {
        mockUseAuth.mockReturnValue({
            user: { ...baseUser, role: 'MERCHANT' },
            logout: jest.fn(),
            settings: { seegEnabled: true, tontineEnabled: true },
        });
        mockApiGetBalance.mockResolvedValue({ balance: 5000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);

        expect(await screen.findByText("Aucune transaction.")).toBeTruthy();
        expect(screen.queryByText('Caisse du Jour')).toBeNull();
    });

    it('toggles balance visibility when the eye icon is pressed', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.queryByText('⬢⬢⬢⬢⬢⬢⬢⬢')).toBeNull();

        const eyeIcon = screen.getByText('eye-outline');
        fireEvent.press(eyeIcon);

        expect(await screen.findByText('⬢⬢⬢⬢⬢⬢⬢⬢')).toBeTruthy();
    });

    it('navigates to the transfer screen when "Envoyer" is pressed', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        fireEvent.press(screen.getByText('Envoyer'));
        expect(mockPush).toHaveBeenCalledWith('/transfer');
    });

    // Restriction de navigation "Comptes Enfant" : Cartes/Diviser (actions rapides) et
    // Internat. (services & factures) ne font pas partie de la liste approuvée par le
    // fondateur pour un compte CHILD — voir (tabs)/_layout.tsx pour l'onglet "Services"
    // masqué de la même façon, et cards.tsx/credit.tsx/crypto.tsx/bnpl.tsx/invest.tsx/remit.tsx
    // pour le filet de sécurité côté écrans eux-mêmes (lien profond direct).
    it('hides Cartes, Diviser and Internat. for a CHILD-role user, and shows the "Compte Enfant" badge', async () => {
        mockUseAuth.mockReturnValue({
            user: { ...baseUser, role: 'CHILD', gender: 'FEMALE' },
            logout: jest.fn(),
            settings: { seegEnabled: true, tontineEnabled: true },
        });
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.queryByText('Cartes')).toBeNull();
        expect(screen.queryByText('Diviser')).toBeNull();
        expect(screen.queryByText('Internat.')).toBeNull();
        expect(screen.getByText('Compte Enfant')).toBeTruthy();

        // Le reste des fonctionnalités approuvées (voir AGENTS/consignes du fondateur) reste
        // pleinement visible pour l'enfant.
        expect(screen.getByText('Envoyer')).toBeTruthy();
        expect(screen.getByText('Recharger')).toBeTruthy();
        expect(screen.getByText('Retirer')).toBeTruthy();
        expect(screen.getByText('Factures')).toBeTruthy();
        expect(screen.getByText('Recharge')).toBeTruthy();
        expect(screen.getByText('Eau')).toBeTruthy();
    });

    it('still shows Cartes, Diviser and Internat. for a non-CHILD (USER) account — no regression', async () => {
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.getByText('Cartes')).toBeTruthy();
        expect(screen.getByText('Diviser')).toBeTruthy();
        expect(screen.getByText('Internat.')).toBeTruthy();
        expect(screen.queryByText('Compte Enfant')).toBeNull();
    });

    // Marchand Géant (mairie, impôts, grandes entreprises) — palier consultation-seule sur
    // mobile (voir User.merchantTier, services/api.ts) : contrairement à un Compte Enfant,
    // TOUT mouvement d'argent est masqué ici, sans exception (voir merchant-hub.tsx pour le
    // reste du garde-fou côté hub marchand, et cards.tsx/remit.tsx pour le filet de sécurité
    // des écrans que Cartes/Internat. auraient sinon menés à).
    it('hides Envoyer, Recharger, Retirer, Cartes, Diviser and Internat. for a GIANT merchant account, and shows the read-only explainer', async () => {
        mockUseAuth.mockReturnValue({
            user: { ...baseUser, role: 'MERCHANT', merchantTier: 'GIANT' },
            logout: jest.fn(),
            settings: { seegEnabled: true, tontineEnabled: true },
        });
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.queryByText('Envoyer')).toBeNull();
        expect(screen.queryByText('Retirer')).toBeNull();
        expect(screen.queryByText('Cartes')).toBeNull();
        expect(screen.queryByText('Diviser')).toBeNull();
        expect(screen.queryByText('Internat.')).toBeNull();
        expect(screen.getByText(/réservées au portail web/)).toBeTruthy();

        // Recharger reste géré à part (auto-financement du propre solde, pas un transfert
        // vers un tiers) — non listé dans les points bloqués explicitement demandés.
        expect(screen.getByText('Recharger')).toBeTruthy();
        expect(screen.getByText('Factures')).toBeTruthy();
    });

    it('still shows Envoyer, Retirer, Cartes, Diviser and Internat. for a normal (non-GIANT) MERCHANT account — no regression', async () => {
        mockUseAuth.mockReturnValue({
            user: { ...baseUser, role: 'MERCHANT', merchantTier: null },
            logout: jest.fn(),
            settings: { seegEnabled: true, tontineEnabled: true },
        });
        mockApiGetBalance.mockResolvedValue({ balance: 1000, currency: 'FCFA' });
        mockApiGetTransactions.mockResolvedValue([]);

        await render(<DashboardScreen />);
        await screen.findByText("Aucune transaction.");

        expect(screen.getByText('Envoyer')).toBeTruthy();
        expect(screen.getByText('Retirer')).toBeTruthy();
        expect(screen.getByText('Cartes')).toBeTruthy();
        expect(screen.getByText('Diviser')).toBeTruthy();
        expect(screen.getByText('Internat.')).toBeTruthy();
    });
});
