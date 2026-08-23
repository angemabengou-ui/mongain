import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Accounts from '../Accounts';

// Isole Accounts.tsx : chaque onglet réutilise un écran spécialisé existant tel quel
// (Users, AgencyCenter, StaffAssignBranch...) — on ne teste ici que le routage par
// onglet propre au hub, pas le comportement interne de chaque écran (déjà couvert par
// leurs propres suites).
vi.mock('../Users', () => ({
    default: ({ lockedRole }: any) => <div>Users Mock{lockedRole ? ` (lockedRole=${lockedRole})` : ''}</div>,
}));
vi.mock('../AgencyCenter', () => ({ default: () => <div>AgencyCenter Mock</div> }));
vi.mock('../SystemAccounts', () => ({
    default: ({ onAdjust }: any) => <button onClick={() => onAdjust?.('w_gateway', 'PASSERELLE EXTERNE')}>SystemAccounts Mock</button>,
}));
vi.mock('../StaffAssignBranch', () => ({ default: () => <div>StaffAssignBranch Mock</div> }));
vi.mock('../StaffCreate', () => ({ default: () => <div>StaffCreate Mock</div> }));
vi.mock('../StaffAccessRights', () => ({ default: () => <div>StaffAccessRights Mock</div> }));

describe('Accounts (hub)', () => {
    it('affiche les Clients & Marchands par défaut', () => {
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        expect(screen.getByText('Gestion des Comptes')).toBeInTheDocument();
        expect(screen.getByText('Users Mock')).toBeInTheDocument();
    });

    it('bascule sur Agents (ancien système) avec lockedRole=AGENT', async () => {
        const user = userEvent.setup();
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        await user.click(screen.getByRole('button', { name: /Agents \(ancien système\)/i }));

        expect(screen.getByText('Users Mock (lockedRole=AGENT)')).toBeInTheDocument();
    });

    it('bascule sur Agences', async () => {
        const user = userEvent.setup();
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        await user.click(screen.getByRole('button', { name: /^Agences$/i }));

        expect(screen.getByText('AgencyCenter Mock')).toBeInTheDocument();
    });

    it('bascule sur Comptes Système et relaie onAdjustSystemAccount', async () => {
        const user = userEvent.setup();
        const onAdjustSystemAccount = vi.fn();
        render(<Accounts token="tok" role="SUPER_ADMIN" onAdjustSystemAccount={onAdjustSystemAccount} />);

        await user.click(screen.getByRole('button', { name: /Comptes Système/i }));
        await user.click(screen.getByRole('button', { name: 'SystemAccounts Mock' }));

        expect(onAdjustSystemAccount).toHaveBeenCalledWith('w_gateway', 'PASSERELLE EXTERNE');
    });

    it('bascule sur Personnel et affiche le roster par défaut, avec sous-onglets Créer/Droits', async () => {
        const user = userEvent.setup();
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        await user.click(screen.getByRole('button', { name: /^Personnel$/i }));
        expect(screen.getByText('StaffAssignBranch Mock')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Créer un Utilisateur/i }));
        expect(screen.getByText('StaffCreate Mock')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Droits d'Accès/i }));
        expect(screen.getByText('StaffAccessRights Mock')).toBeInTheDocument();
    });
});
