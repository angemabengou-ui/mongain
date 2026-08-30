import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Accounts from '../Accounts';

// Isole Accounts.tsx : chaque onglet réutilise un écran spécialisé existant.
// Les Agences et Comptes Système ont désormais leurs propres entrées de menu sidebar —
// ce hub ne gère plus que Clients/Marchands + Personnel.
vi.mock('../Users', () => ({
    default: ({ lockedRole }: any) => <div>Users Mock{lockedRole ? ` (lockedRole=${lockedRole})` : ''}</div>,
}));
vi.mock('../StaffAssignBranch', () => ({ default: () => <div>StaffAssignBranch Mock</div> }));
vi.mock('../StaffCreate', () => ({ default: () => <div>StaffCreate Mock</div> }));
vi.mock('../StaffAccessRights', () => ({ default: () => <div>StaffAccessRights Mock</div> }));

describe('Accounts (hub)', () => {
    it('affiche les Clients & Marchands par défaut', () => {
        render(<Accounts token="tok" role="SUPER_ADMIN" />);
        expect(screen.getByText('Users Mock')).toBeInTheDocument();
    });

    it('bascule sur Personnel et affiche le roster par défaut, avec sous-onglets Créer/Droits', async () => {
        const user = userEvent.setup();
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        await user.click(screen.getByRole('button', { name: /Personnel/i }));
        expect(screen.getByText('StaffAssignBranch Mock')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Créer un Utilisateur/i }));
        expect(screen.getByText('StaffCreate Mock')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Droits d'Accès/i }));
        expect(screen.getByText('StaffAccessRights Mock')).toBeInTheDocument();
    });

    // Régression : Personnel ne doit pas être visible pour les rôles sans perm_staff_view
    it('masque Personnel pour un rôle qui n\'a que perm_customer_view', () => {
        const hasPerm = (perms: string[]) => perms.includes('perm_customer_view');
        render(<Accounts token="tok" role="TELLER" hasPerm={hasPerm} />);
        expect(screen.queryByRole('button', { name: /^Personnel/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clients & Marchands/i })).toBeInTheDocument();
    });
});
