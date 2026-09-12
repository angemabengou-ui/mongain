import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BranchDashboard from '../BranchDashboard';

const token = 'test-token';

const branchData = {
    name: 'Agence Libreville',
    balance: 500,
    wallet: { balance: 300 },
    staff: [{ id: '1' }, { id: '2' }, { id: '3' }],
    sessions: [] as any[],
    targetTreasuryRequests: [] as any[],
};

describe('BranchDashboard', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("affiche un message de chargement puis les données de l'agence", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData });

        render(<BranchDashboard token={token} hasPerm={() => true} />);

        expect(screen.getByText(/Chargement sécurisé de l'agence/)).toBeInTheDocument();

        await screen.findByText(/Tableau de Bord Agence/);
        expect(screen.getByText(/Agence Libreville/)).toBeInTheDocument();
        expect(screen.getByText('500 FCFA')).toBeInTheDocument();
        expect(screen.getByText('300 FCFA')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it("affiche un message d'erreur si le chargement échoue", async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Accès refusé' }) });

        render(<BranchDashboard token={token} hasPerm={() => true} />);

        await screen.findByText(/Erreur critique/);
        expect(screen.getByText(/Accès refusé/)).toBeInTheDocument();
    });

    it("permet d'ouvrir une session de caisse", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData }); // fetch initial
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // POST open session
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData }); // refetch après ouverture

        const user = userEvent.setup();
        render(<BranchDashboard token={token} hasPerm={() => true} />);

        await screen.findByText(/Tableau de Bord Agence/);

        const input = screen.getByPlaceholderText('0 FCFA');
        await user.type(input, '1000');
        await user.click(screen.getByRole('button', { name: 'Ouvrir le Guichet' }));

        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/agency/sessions/open'),
            expect.objectContaining({ method: 'POST' })
        );
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Session ouverte'));
    });

    it("affiche ma session active même si elle est absente des 10 sessions récentes de l'agence (backend: myActiveSession)", async () => {
        // Régression : `myActiveSession` se déduisait auparavant en cherchant dans
        // `branchData.sessions` (limité aux 10 plus récentes DE TOUTE L'AGENCE côté serveur) —
        // dans une agence à forte activité, ma propre session pouvait en sortir. Le backend la
        // renvoie désormais séparément, sans cette limite.
        const dataWithMyOwnSessionExcluded = {
            ...branchData,
            sessions: Array.from({ length: 10 }, (_, i) => ({ id: `other_${i}`, status: 'OPEN', teller: { id: `other_teller_${i}` } })),
            myActiveSession: { id: 'my_sess', status: 'OPEN', openedAt: '2026-08-28T08:00:00Z', totalCashInValue: 5000, totalCashOutValue: 1000 },
        };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => dataWithMyOwnSessionExcluded });

        render(<BranchDashboard token={token} hasPerm={() => true} />);

        await screen.findByText(/Tableau de Bord Agence/);
        expect(screen.getByText(/Guichet/)).toBeInTheDocument();
        expect(screen.getByText(/OUVERT/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ouvrir le Guichet' })).not.toBeInTheDocument();
    });

    it("indique que le Siège fonctionne comme une agence normale depuis la séparation de la Trésorerie Centrale", async () => {
        // Depuis cette séparation, le wallet du Siège n'est plus la Réserve globale — un
        // gros solde ici serait juste son solde d'agence propre, pas un milliard fantôme.
        const hqData = { ...branchData, name: 'Siège Central', isHQ: true, wallet: { balance: 300000 } };
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => hqData });
        const onNavigateToTreasury = vi.fn();

        render(<BranchDashboard token={token} hasPerm={() => true} onNavigateToTreasury={onNavigateToTreasury} />);

        await screen.findByText(/Tableau de Bord Agence — Siège/);
        expect(screen.getByText(/fonctionne comme une agence normale/)).toBeInTheDocument();
        expect(screen.getByText('E-Liquidité (Réserves Trésorerie)')).toBeInTheDocument();
        expect(screen.getByText('300 000 FCFA')).toBeInTheDocument();

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /Voir la Trésorerie Centrale/ }));
        expect(onNavigateToTreasury).toHaveBeenCalled();
    });

    it("masque le formulaire de demande de financement pour un rôle sans perm_branch_manage (ex: TELLER)", async () => {
        // Régression : POST /api/agency/treasury-requests exige perm_branch_manage
        // (agency.ts) mais rien ici n'empêchait un TELLER de remplir tout le formulaire
        // avant de recevoir un 403 seulement à la soumission.
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData });

        render(<BranchDashboard token={token} hasPerm={() => false} />);

        await screen.findByText(/Tableau de Bord Agence/);
        expect(screen.getByText("Réservé au Manager d'agence (perm_branch_manage).")).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Envoyer au Trésorier HQ/i })).not.toBeInTheDocument();
    });

    it("masque le bouton de génération du rapport de réconciliation pour un rôle sans perm_branch_manage", async () => {
        // Régression : GET /api/agency/reconciliation exige perm_branch_manage
        // (agency.ts) — un TELLER cliquant recevait un 403 silencieux.
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => branchData });

        render(<BranchDashboard token={token} hasPerm={() => false} />);

        await screen.findByText(/Tableau de Bord Agence/);
        expect(screen.getByText('Accès restreint au Manager')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Générer le rapport consolidé/i })).not.toBeInTheDocument();
    });
});
