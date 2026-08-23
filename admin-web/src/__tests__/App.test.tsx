import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

// Isole App.tsx : on remplace chaque page enfant par un stub minimal pour ne tester
// que la logique de routage/permissions/session propre à App (nav par rôle, logout,
// gate mustChangePassword) sans dépendre du comportement interne de chaque écran.
vi.mock('../AgencyCenter', () => ({ default: () => <div>AgencyCenter Mock</div> }));
vi.mock('../AuditLogs', () => ({ default: () => <div>AuditLogs Mock</div> }));
vi.mock('../BranchDashboard', () => ({ default: () => <div>BranchDashboard Mock</div> }));
vi.mock('../ChangePassword', () => ({ default: () => <div>ChangePassword Mock</div> }));
vi.mock('../Dashboard', () => ({ default: () => <div>Dashboard Mock</div> }));
vi.mock('../ErrorLogs', () => ({ default: () => <div>ErrorLogs Mock</div> }));
vi.mock('../KycMod', () => ({ default: () => <div>KycMod Mock</div> }));
vi.mock('../Ledger', () => ({ default: () => <div>Ledger Mock</div> }));
vi.mock('../Login', () => ({
    default: ({ setToken }: any) => (
        <div>
            <span>Login Mock</span>
            <button onClick={() => setToken('tok-123', 'SUPER_ADMIN', 'Test Admin', '+24100000000', false)}>
                Simuler Connexion
            </button>
        </div>
    ),
}));
vi.mock('../MacroStats', () => ({ default: () => <div>MacroStats Mock</div> }));
vi.mock('../Settings', () => ({ default: () => <div>Settings Mock</div> }));
vi.mock('../StaffAccessRights', () => ({ default: () => <div>StaffAccessRights Mock</div> }));
vi.mock('../StaffAssignBranch', () => ({ default: () => <div>StaffAssignBranch Mock</div> }));
vi.mock('../StaffCreate', () => ({ default: () => <div>StaffCreate Mock</div> }));
vi.mock('../SupportCenter', () => ({ default: () => <div>SupportCenter Mock</div> }));
vi.mock('../TellerTerminal', () => ({ default: () => <div>TellerTerminal Mock</div> }));
vi.mock('../Treasury', () => ({ default: () => <div>Treasury Mock</div> }));
vi.mock('../Users', () => ({ default: () => <div>Users Mock</div> }));
vi.mock('../Vaults', () => ({ default: () => <div>Vaults Mock</div> }));

function setupFetch(impl?: (url: string, opts?: any) => Promise<any>) {
    const fn = vi.fn(impl || (() => Promise.resolve({ ok: true, status: 200, json: async () => ({ mustChangePassword: false }) })));
    vi.stubGlobal('fetch', fn);
    return fn;
}

describe('App', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("affiche le formulaire de connexion si aucun token n'est présent", () => {
        setupFetch();

        render(<App />);

        expect(screen.getByText('Login Mock')).toBeInTheDocument();
        expect(screen.queryByText('Déconnexion')).not.toBeInTheDocument();
    });

    it('affiche le tableau de bord après une connexion réussie', async () => {
        setupFetch();
        const user = userEvent.setup();

        render(<App />);
        await user.click(screen.getByRole('button', { name: 'Simuler Connexion' }));

        await screen.findByText('Dashboard Mock');
        expect(sessionStorage.getItem('admin_token')).toBe('tok-123');
        expect(localStorage.getItem('admin_role')).toBe('SUPER_ADMIN');
    });

    it('affiche la navigation complète (groupes admin) pour un SUPER_ADMIN', async () => {
        sessionStorage.setItem('admin_token', 'tok-abc');
        localStorage.setItem('admin_role', 'SUPER_ADMIN');
        localStorage.setItem('admin_name', 'Alice Admin');
        setupFetch();

        render(<App />);

        await screen.findByText('Dashboard Mock');
        expect(screen.getByText('TABLEAU DE BORD')).toBeInTheDocument();
        expect(screen.getByText('TRÉSORERIE')).toBeInTheDocument();
        expect(screen.getByText('Déconnexion')).toBeInTheDocument();
    });

    it("réserve la navigation Guichet aux rôles d'agence (TELLER) et masque les groupes admin", async () => {
        sessionStorage.setItem('admin_token', 'tok-teller');
        localStorage.setItem('admin_role', 'TELLER');
        localStorage.setItem('admin_name', 'Marc Caissier');
        setupFetch();
        const user = userEvent.setup();

        render(<App />);

        await screen.findByText('BranchDashboard Mock');
        expect(screen.queryByText('TABLEAU DE BORD')).not.toBeInTheDocument();
        expect(screen.queryByText('TRÉSORERIE')).not.toBeInTheDocument();

        // le groupe Guichet & Agence est replié par défaut (seul "control-center" l'est) : il faut l'ouvrir
        await user.click(screen.getByText('GUICHET & AGENCE'));
        expect(screen.getByText('Opérations Guichet')).toBeInTheDocument();

        await user.click(screen.getByText('Opérations Guichet'));
        await screen.findByText('TellerTerminal Mock');
    });

    it('déconnecte un utilisateur et réinitialise le stockage de session', async () => {
        sessionStorage.setItem('admin_token', 'tok-xyz');
        localStorage.setItem('admin_role', 'ADMIN');
        localStorage.setItem('admin_name', 'Bob');
        setupFetch();
        const user = userEvent.setup();

        render(<App />);
        await screen.findByText('Dashboard Mock');

        await user.click(screen.getByText('Déconnexion'));

        await screen.findByText('Login Mock');
        expect(sessionStorage.getItem('admin_token')).toBeNull();
        expect(localStorage.getItem('admin_role')).toBeNull();
    });

    it('déconnecte automatiquement si le token est révoqué (401 sur /api/corp/me)', async () => {
        sessionStorage.setItem('admin_token', 'tok-expired');
        localStorage.setItem('admin_role', 'ADMIN');
        setupFetch(() => Promise.resolve({ status: 401, ok: false, json: async () => ({}) }));

        render(<App />);

        await screen.findByText('Login Mock');
        expect(sessionStorage.getItem('admin_token')).toBeNull();
    });

    it('affiche ChangePassword si un changement de mot de passe est requis', async () => {
        sessionStorage.setItem('admin_token', 'tok-mcp');
        localStorage.setItem('admin_role', 'ADMIN');
        localStorage.setItem('admin_must_change_pw', '1');
        setupFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ mustChangePassword: true }) }));

        render(<App />);

        await screen.findByText('ChangePassword Mock');
    });
});
