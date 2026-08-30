import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Customer360 from '../Customer360';

const baseUser = {
    id: 'user-123456789', name: 'Sophie Ndong', phone: '+24101020304', username: 'sophie.n',
    email: 'sophie@example.com', role: 'CLIENT', accountStatus: 'ACTIVE', kycStatus: 'APPROVED', kycLevel: 1,
    createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-06-01T00:00:00Z', freezeReason: null,
    wallet: { id: 'wallet-1', balance: 250000, currency: 'XAF', dailySpent: 1000, monthlySpent: 5000 },
    riskFlags: [],
};

const mainData = {
    user: baseUser,
    recentTx: [{ id: 'tx-1', createdAt: '2026-01-01T10:00:00Z', type: 'TRANSFER', amount: 5000, fee: 50, status: 'COMPLETED' }],
    auditLogs: [{ id: 'log-1', action: 'ACCOUNT_VIEWED', createdAt: '2026-01-02T10:00:00Z', admin: { name: 'Admin One' } }],
    openRiskFlagsCount: 0,
    reclamationsCount: 1,
};

function jsonResponse(body: any, ok = true, status = 200) {
    return { ok, status, json: async () => body } as Response;
}

function setupFetch(overrides: Record<string, any> = {}) {
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
        if (url.includes('/360')) return jsonResponse(overrides.main ?? mainData);
        if (url.includes('/transactions')) return jsonResponse(overrides.transactions ?? { txs: [], total: 0, page: 1, pages: 1 });
        if (url.includes('/cash-ops')) return jsonResponse(overrides.cashOps ?? { cashIns: [], cashOuts: [] });
        if (url.includes('/security')) return jsonResponse(overrides.security ?? { failedPinAttempts: 0, isLocked: false, lockedUntil: null, accountStatus: 'ACTIVE', jwtVersion: 1, freezeReason: null, securityLogs: [] });
        if (url.includes('/limits-view')) return jsonResponse(overrides.limits ?? { globalLimit: 1000000, tierName: 'Tier 1', kycLimitDaily: 500000, kycLimitMonthly: 2000000, kycLimitPerTx: 200000, customDailyLimit: null, isCustomActive: false, customLimitExpiresAt: null, effectiveDaily: 500000, effectiveMonthly: 2000000, effectivePerTx: 200000 });
        if (url.includes('/reclamations')) return jsonResponse(overrides.reclamations ?? []);
        if (url.includes('/audit')) return jsonResponse(overrides.audit ?? { logs: [], total: 0, page: 1, pages: 1 });
        if (opts?.method === 'PUT' && url.includes('/kyc')) return jsonResponse(overrides.kycResult ?? {});
        if (opts?.method === 'POST' && url.includes('/freeze')) return jsonResponse(overrides.freezeResult ?? {});
        return jsonResponse({});
    });
    (global.fetch as any) = fetchMock;
    return fetchMock;
}

describe('Customer360', () => {
    let alertSpy: ReturnType<typeof vi.spyOn>;
    const onBack = vi.fn();

    beforeEach(() => {
        onBack.mockReset();
        alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        window.confirm = vi.fn(() => true) as any;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('affiche un état de chargement puis la fiche client', async () => {
        setupFetch();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);

        expect(screen.getByText('Chargement Customer 360…')).toBeInTheDocument();
        expect(await screen.findByText('Sophie Ndong')).toBeInTheDocument();
        expect(screen.getByText('+24101020304')).toBeInTheDocument();
    });

    it("affiche l'onglet Aperçu avec transactions et logs récents", async () => {
        setupFetch();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        expect(screen.getByText('TRANSFER')).toBeInTheDocument();
        expect(screen.getByText('ACCOUNT_VIEWED')).toBeInTheDocument();
    });

    it('affiche le score de fiabilité tontine quand le backend le fournit (perm_tontine_view)', async () => {
        setupFetch({ main: { ...mainData, tontineReliability: { totalCycles: 10, paidCycles: 7, partialOrMissedCycles: 3, penaltiesCount: 2, scorePercent: 70 } } });
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        expect(screen.getByText('Fiabilité Tontine')).toBeInTheDocument();
        expect(screen.getByText('70% (7/10 tours, 2 pénalité(s))')).toBeInTheDocument();
        expect(screen.getByText('Usage interne uniquement — jamais un score de crédit.')).toBeInTheDocument();
    });

    it("n'affiche pas la carte de fiabilité tontine quand le backend ne la fournit pas (rôle sans perm_tontine_view)", async () => {
        setupFetch();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="TELLER" hasPerm={() => false} />);
        await screen.findByText('Sophie Ndong');

        expect(screen.queryByText('Fiabilité Tontine')).not.toBeInTheDocument();
    });

    it('appelle onBack et alerte en cas d\'échec du chargement principal', async () => {
        (global.fetch as any) = vi.fn(async () => jsonResponse({ error: 'Client introuvable.' }, false, 404));
        render(<Customer360 token="tok" userId="unknown-user" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);

        await waitFor(() => expect(onBack).toHaveBeenCalled());
        expect(alertSpy).toHaveBeenCalledWith('Client introuvable.');
    });

    it('charge les transactions au clic sur l\'onglet Transactions', async () => {
        setupFetch({ transactions: { txs: [{ id: 'tx-2', createdAt: '2026-01-03T10:00:00Z', reference: 'REF0000000000123456', type: 'CASH_IN', amount: 20000, fee: 0, status: 'COMPLETED', senderWallet: { user: { id: 'other-user' } }, receiverWallet: { user: { id: 'user-123456789', name: 'Sophie Ndong' } } }], total: 1, page: 1, pages: 1 } });
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Transactions/i }));

        expect(await screen.findByText('CASH_IN')).toBeInTheDocument();
        expect(screen.getByText('1 transaction(s) — Page 1/1')).toBeInTheDocument();
    });

    it('masque le solde du portefeuille pour un rôle non sensible', async () => {
        setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="AGENCY_STAFF" hasPerm={() => false} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Wallet/i }));

        expect(await screen.findByText('Accès aux données financières restreint à votre rôle.')).toBeInTheDocument();
        expect(screen.queryByText('250 000 FCFA')).not.toBeInTheDocument();
    });

    it('affiche le solde du portefeuille pour un rôle sensible (SUPER_ADMIN)', async () => {
        setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Wallet/i }));

        expect(await screen.findByText('Wallet ID')).toBeInTheDocument();
        expect(screen.getByText('250 000 FCFA')).toBeInTheDocument();
    });

    it('approuve un dossier KYC en attente (succès)', async () => {
        const fetchMock = setupFetch({ main: { ...mainData, user: { ...baseUser, kycStatus: 'PENDING' } } });
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /^KYC/i }));
        await user.click(screen.getByRole('button', { name: /Approuver/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`/api/admin/users/user-123456789/kyc`),
                expect.objectContaining({ method: 'PUT', body: JSON.stringify({ status: 'APPROVED', reason: '' }) })
            );
        });
        expect(alertSpy).toHaveBeenCalledWith('KYC mis à jour.');
    });

    it('affiche une alerte d\'erreur si le rejet KYC échoue côté serveur', async () => {
        (global.fetch as any) = vi.fn(async (url: string, opts?: any) => {
            if (url.includes('/360')) return jsonResponse({ ...mainData, user: { ...baseUser, kycStatus: 'PENDING' } });
            if (opts?.method === 'PUT' && url.includes('/kyc')) return jsonResponse({ error: 'Motif de rejet invalide.' }, false, 400);
            return jsonResponse({});
        });
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /^KYC/i }));
        const rejectInput = screen.getByPlaceholderText('Ex: Document illisible');
        await user.type(rejectInput, 'Document flou');
        await user.click(screen.getByRole('button', { name: /Rejeter/i }));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Erreur: Motif de rejet invalide.');
        });
    });

    it('gèle le compte via l\'onglet Risque (succès)', async () => {
        const fetchMock = setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Risque/i }));
        await user.click(screen.getByRole('button', { name: /Geler le compte$/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining(`/api/admin/users/user-123456789/freeze`),
                expect.objectContaining({ method: 'POST' })
            );
        });
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Compte gelé'));
    });

    it("masque la création de flag et le gel de compte pour un rôle non sensible", async () => {
        setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="AGENCY_STAFF" hasPerm={() => false} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Risque/i }));

        expect(screen.queryByText('Créer un Flag')).not.toBeInTheDocument();
        expect(screen.queryByText('Gestion du Statut du Compte')).not.toBeInTheDocument();
    });

    it("masque « + Nouveau ticket » pour un rôle exclu de hasSupportAccess côté serveur (ex: TELLER)", async () => {
        // POST /users/:id/reclamation (admin.ts) vérifie un rôle codé en dur (hasSupportAccess),
        // pas une permission — TELLER en est exclu et se heurterait à un refus serveur.
        setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="TELLER" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Réclamations/i }));

        expect(screen.queryByText('+ Nouveau ticket')).not.toBeInTheDocument();
    });

    it("affiche « + Nouveau ticket » pour un rôle autorisé (ex: SUPPORT_MAKER)", async () => {
        setupFetch();
        const user = userEvent.setup();
        render(<Customer360 token="tok" userId="user-123456789" onBack={onBack} staffRole="SUPPORT_MAKER" hasPerm={() => true} />);
        await screen.findByText('Sophie Ndong');

        await user.click(screen.getByRole('button', { name: /Réclamations/i }));

        expect(screen.getByText('+ Nouveau ticket')).toBeInTheDocument();
    });
});
