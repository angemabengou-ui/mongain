import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Treasury from '../Treasury';

const token = 'test-token';

const overviewData = {
    // Composants cohérents avec moneySupply (400 + 150 + 275 + 75 = 900) : le rapprochement
    // comptable calcule désormais réellement l'écart au lieu d'afficher "0 FCFA" en dur, des
    // données de test qui ne sommaient pas produisaient un faux écart dans l'UI.
    // totalPhysicalVault (50) volontairement distinct de systemAccountsBalance (75) pour ne
    // pas rendre deux "X FCFA" identiques dans des cartes KPI différentes.
    moneySupply: 900,
    reserveBalance: 400,
    clientWalletsBalance: 275,
    totalAgencyElectronic: 150,
    totalPhysicalVault: 50,
    systemAccountsBalance: 75,
};

const requestsData = [
    {
        id: 'r1', reference: 'REQ-001', type: 'ISSUANCE', amount: 500,
        maker: { name: 'Alice', role: 'ADMIN' }, checker: null, status: 'PENDING',
        createdAt: '2026-08-20T10:00:00Z', targetBranch: null, targetWalletId: null, rejectionReason: null,
    },
];

const agenciesData = [
    { id: 'a1', name: 'Agence LBV', code: 'LBV01', electronicBalance: 200, physicalVault: 100, status: 'OK' },
];

const reconciliationData = [
    {
        id: 'rec1', reference: 'REC-001', branch: { name: 'Agence LBV' },
        expectedAmount: 500, reportedAmount: 480, difference: 20,
        createdAt: '2026-08-19T09:00:00Z', status: 'UNDER_REVIEW',
    },
];

const branchesData = { branches: [{ id: 'b1', name: 'Agence LBV', code: 'LBV01', isHQ: false, wallet: { balance: 200 } }] };

function buildFetchMock() {
    return vi.fn((url: string, opts?: any) => {
        const method = opts?.method;
        if (url.endsWith('/api/treasury/overview')) {
            return Promise.resolve({ ok: true, json: async () => overviewData });
        }
        if (url.includes('/api/admin/branches')) {
            return Promise.resolve({ ok: true, json: async () => branchesData });
        }
        if (url.endsWith('/api/treasury/agencies-liquidity')) {
            return Promise.resolve({ ok: true, json: async () => agenciesData });
        }
        if (url.endsWith('/api/treasury/reconciliation')) {
            return Promise.resolve({ ok: true, json: async () => reconciliationData });
        }
        if (url.endsWith('/api/treasury/requests') && method === 'POST') {
            return Promise.resolve({ ok: true, json: async () => ({ id: 'new' }) });
        }
        if (url.endsWith('/api/treasury/requests') && !method) {
            return Promise.resolve({ ok: true, json: async () => requestsData });
        }
        if (/\/api\/treasury\/requests\/.+\/approve/.test(url)) {
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (/\/api\/treasury\/requests\/.+\/reject/.test(url)) {
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (/\/api\/treasury\/reconciliation\/.+\/resolve/.test(url)) {
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
}

describe('Treasury', () => {
    beforeEach(() => {
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('charge et affiche le tableau de bord (KPIs)', async () => {
        vi.stubGlobal('fetch', buildFetchMock());

        render(<Treasury token={token} />);

        await screen.findByText('Masse Monétaire Totale');
        // moneySupply (900) est affiché à la fois dans la carte KPI et dans le rapprochement comptable
        await waitFor(() => expect(screen.getAllByText('900 FCFA')).toHaveLength(2));
        expect(screen.getByText('50 FCFA')).toBeInTheDocument(); // Liquidité Physique (Coffre)
        expect(screen.getByText('Comptes Système')).toBeInTheDocument();
        // systemAccountsBalance (75) apparaît dans la carte KPI et dans le rapprochement comptable
        await waitFor(() => expect(screen.getAllByText('75 FCFA')).toHaveLength(2));
    });

    it('affiche la liquidité des agences', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<Treasury token={token} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Liquidité Agences/i }));

        await screen.findByText('Agence LBV');
        expect(screen.getByText('200 FCFA')).toBeInTheDocument();
    });

    it('résout un cas de rapprochement', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        vi.spyOn(window, 'prompt').mockReturnValue('Erreur de comptage corrigée');
        const user = userEvent.setup();

        render(<Treasury token={token} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Rapprochements/i }));
        await screen.findByText('REC-001');

        await user.click(screen.getByRole('button', { name: 'Résoudre' }));

        await waitFor(() => expect(window.prompt).toHaveBeenCalled());
    });

    it('approuve une demande en attente', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const user = userEvent.setup();

        render(<Treasury token={token} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Opérations & Approbations/i }));
        await screen.findByText('REQ-001');

        await user.click(screen.getByRole('button', { name: 'Valider' }));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('exécutée avec succès')));
    });

    it('crée une nouvelle requête de trésorerie', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const user = userEvent.setup();

        render(<Treasury token={token} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Lancer Opération/i }));
        await screen.findByText('Nouvelle Requête de Trésorerie');

        await user.type(screen.getByPlaceholderText('Ex: 5000000'), '1000');
        await user.type(screen.getByPlaceholderText(/Renflouement journalier/), 'Réapprovisionnement test');
        await user.click(screen.getByRole('button', { name: /Soumettre au Validation Center/i }));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Demande créée avec succès.'));
    });

    it('ouvre directement le formulaire Ajustement pré-rempli quand prefillAdjustTarget est fourni', async () => {
        vi.stubGlobal('fetch', buildFetchMock());

        render(<Treasury token={token} prefillAdjustTarget={{ walletId: 'w_gateway', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)' }} />);

        await screen.findByText('Nouvelle Requête de Trésorerie');
        expect(screen.getByText('Compte Système Ciblé')).toBeInTheDocument();
        expect(screen.getByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)')).toBeInTheDocument();
        // Le formulaire ne doit pas aussi montrer le sélecteur d'agence tant qu'un compte
        // système est ciblé — les deux cibles sont mutuellement exclusives.
        expect(screen.queryByText('Agence Ciblée')).not.toBeInTheDocument();
    });
});
