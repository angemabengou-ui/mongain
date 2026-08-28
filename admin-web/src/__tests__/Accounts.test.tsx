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
    it('affiche les Clients & Marchands par défaut, sans dupliquer de titre de page', () => {
        // Chaque onglet embarque déjà son propre PageHeader (ex: "Comptes Clients &
        // Marchands (C-360)" dans Users.tsx) — le hub n'en ajoute pas un second par-dessus.
        render(<Accounts token="tok" role="SUPER_ADMIN" />);

        expect(screen.queryByText('Gestion des Comptes')).not.toBeInTheDocument();
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

    // Régression : Agences/Comptes Système restaient visibles à n'importe quel rôle ayant
    // seulement de quoi ouvrir ce hub (perm_customer_view), sans vérifier perm_branch_manage/
    // perm_treasury_view — l'onglet cliqué dégradait alors en message d'erreur plutôt que de
    // ne jamais apparaître.
    it('masque Agences/Comptes Système/Personnel pour un rôle qui n\'a que perm_customer_view', () => {
        const hasPerm = (perms: string[]) => perms.includes('perm_customer_view');
        render(<Accounts token="tok" role="TELLER" hasPerm={hasPerm} />);

        expect(screen.queryByRole('button', { name: /^Agences$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Comptes Système/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Personnel$/i })).not.toBeInTheDocument();
        // Clients & Marchands / Agents restent visibles : pas de garde dédiée, ils dépendent
        // uniquement du contrôle déjà fait par App.tsx pour ouvrir ce hub.
        expect(screen.getByRole('button', { name: /Clients & Marchands/i })).toBeInTheDocument();
    });
});
