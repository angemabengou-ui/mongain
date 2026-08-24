import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../Accounts', () => ({ default: () => <div>Accounts Mock</div> }));
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
vi.mock('../SystemAccounts', () => ({ default: () => <div>SystemAccounts Mock</div> }));
vi.mock('../TellerTerminal', () => ({ default: () => <div>TellerTerminal Mock</div> }));
vi.mock('../Tontines', () => ({ default: () => <div>Tontines Mock</div> }));
vi.mock('../Treasury', () => ({ default: () => <div>Treasury Mock</div> }));
vi.mock('../Users', () => ({ default: () => <div>Users Mock</div> }));
vi.mock('../Vaults', () => ({ default: () => <div>Vaults Mock</div> }));

function setupFetch(impl?: (url: string, opts?: any) => Promise<any>) {
    const fn = vi.fn(impl || ((url) => {
        const isTeller = localStorage.getItem('admin_role') === 'TELLER';
        const perms = isTeller ? ['perm_cash_session_open', 'perm_cash_in', 'perm_cash_out'] : ['perm_analytics_view', 'perm_staff_view', 'perm_branch_manage'];
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ mustChangePassword: false, permissions: perms }) });
    }));
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
});
