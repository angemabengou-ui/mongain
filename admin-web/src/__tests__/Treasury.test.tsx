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

function jsonOk(body: unknown) {
    return Promise.resolve({ ok: true, json: async () => body });
}

function buildFetchMock() {
    return vi.fn((url: string, opts?: any) => {
        const method = opts?.method;
        if (url.endsWith('/api/treasury/overview')) {
            return jsonOk(overviewData);
        }
        if (url.includes('/api/admin/branches')) {
            return jsonOk(branchesData);
        }
        if (url.endsWith('/api/treasury/agencies-liquidity')) {
            return jsonOk(agenciesData);
        }
        if (url.endsWith('/api/treasury/reconciliation')) {
            return jsonOk(reconciliationData);
        }
        if (url.endsWith('/api/treasury/requests') && method === 'POST') {
            return jsonOk({ id: 'new' });
        }
        if (url.endsWith('/api/treasury/requests') && !method) {
            return jsonOk(requestsData);
        }
        if (/\/api\/treasury\/requests\/.+\/approve/.test(url)) {
            return jsonOk({});
        }
        if (/\/api\/treasury\/requests\/.+\/reject/.test(url)) {
            return jsonOk({});
        }
        if (/\/api\/treasury\/reconciliation\/.+\/resolve/.test(url)) {
            return jsonOk({});
        }
        return jsonOk({});
    });
}

describe('Treasury', () => {
    beforeEach(() => {
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('charge et affiche le tableau de bord (KPIs)', async () => {
        vi.stubGlobal('fetch', buildFetchMock());

        render(<Treasury token={token} hasPerm={() => true} />);

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

        render(<Treasury token={token} hasPerm={() => true} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Liquidité Agences/i }));

        await screen.findByText('Agence LBV');
        expect(screen.getByText('200 FCFA')).toBeInTheDocument();
    });

    // Résolution/approbation/création : migrées de window.prompt()/window.confirm()/window.alert()
    // vers ConfirmDialog (motif saisi dans une vraie modale) + useToast (message affiché dans un
    // toast, pas une alerte native) — ces 3 tests dataient de l'ancienne mécanique.
    it('résout un cas de rapprochement', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<Treasury token={token} hasPerm={() => true} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Rapprochements/i }));
        await screen.findByText('REC-001');

        await user.click(screen.getByRole('button', { name: 'Résoudre' }));
        await screen.findByText(/Résolution du cas/);
        await user.type(screen.getByPlaceholderText(/Motif et actions/i), 'Erreur de comptage corrigée');
        // Deux boutons "Résoudre" coexistent dans le DOM : celui de la ligne (masqué derrière la
        // modale, pas retiré) et le bouton de confirmation de la modale — ce dernier est le
        // dernier ajouté à l'arbre (ConfirmDialog rendu après le contenu principal).
        const resolveButtons = screen.getAllByRole('button', { name: 'Résoudre' });
        await user.click(resolveButtons[resolveButtons.length - 1]);

        await waitFor(() => expect(screen.getByText('Écart résolu avec succès.')).toBeInTheDocument());
    });

    it('approuve une demande en attente', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<Treasury token={token} hasPerm={() => true} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Opérations & Approbations/i }));
        await screen.findByText('REQ-001');

        await user.click(screen.getByRole('button', { name: 'Valider' }));
        await screen.findByText(/Approuver l'opération/);
        await user.click(screen.getByRole('button', { name: 'Approuver et Exécuter' }));

        await waitFor(() => expect(screen.getByText(/exécutée avec succès/)).toBeInTheDocument());
    });

    it('crée une nouvelle requête de trésorerie', async () => {
        vi.stubGlobal('fetch', buildFetchMock());
        const user = userEvent.setup();

        render(<Treasury token={token} hasPerm={() => true} />);
        await screen.findByText('Trésorerie Centrale');

        await user.click(screen.getByRole('button', { name: /Lancer Opération/i }));
        await screen.findByPlaceholderText('Ex: 5000000');

        await user.type(screen.getByPlaceholderText('Ex: 5000000'), '1000');
        await user.type(screen.getByPlaceholderText(/Renflouement journalier/), 'Réapprovisionnement test');
        await user.click(screen.getByRole('button', { name: /Envoyer pour Validation \(Maker\)/i }));

        await screen.findByRole('button', { name: 'Soumettre' });
        await user.click(screen.getByRole('button', { name: 'Soumettre' }));

        await waitFor(() => expect(screen.getByText(/Demande créée avec succès/)).toBeInTheDocument());
    });

    it('ouvre directement le formulaire Ajustement pré-rempli quand prefillAdjustTarget est fourni', async () => {
        vi.stubGlobal('fetch', buildFetchMock());

        render(<Treasury token={token} hasPerm={() => true} prefillAdjustTarget={{ walletId: 'w_gateway', name: 'PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)' }} />);

        expect(await screen.findByText('Compte Système Ciblé')).toBeInTheDocument();
        expect(screen.getByText('PASSERELLE EXTERNE (AIRTEL/MOOV/BANK)')).toBeInTheDocument();
        // Le formulaire ne doit pas aussi montrer le sélecteur d'agence tant qu'un compte
        // système est ciblé — les deux cibles sont mutuellement exclusives.
        expect(screen.queryByText('Agence Ciblée')).not.toBeInTheDocument();
    });
});
