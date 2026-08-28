import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformConfig from '../Settings';

const settings = {
    platformName: 'Mongain V6', currency: 'XAF', supportEmail: 'support@mongain.com', supportPhone: '+24101010101',
    taxCashIn: 0.01, taxWithdraw: 0.02, agencyWithdrawThreshold: 500000, agencyTaxWithdraw: 0.015,
    rewardMerchant: 0.005, taxP2P: 0.005, circuitBreaker: false,
    dailyLimitTier0: 100000, perTxLimitTier0: 50000, dailyLimitTier1: 1000000, perTxLimitTier1: 500000,
};

const requests = [
    { id: 'req-1', status: 'PENDING', action: 'UPDATE_FEES', reason: 'Ajustement des frais', maker: { name: 'Alice', role: 'FINANCE_MAKER' } },
];

const history = [
    { id: 'hist-1', createdAt: '2026-01-01T00:00:00Z', parameter: 'taxCashIn', oldValue: '0.01', newValue: '0.02', author: { name: 'Bob' }, checker: { name: 'Carla' }, reason: 'Alignement marché' },
];

function jsonResponse(body: any, ok = true, status = 200) {
    return { ok, status, json: async () => body } as Response;
}

function setupFetch() {
    (global.fetch as any) = vi.fn(async (url: string) => {
        if (url.includes('/api/settings/my-ip')) return jsonResponse({ ip: '203.0.113.5' });
        if (url.includes('/api/settings/requests')) return jsonResponse(requests);
        if (url.includes('/api/settings/history')) return jsonResponse(history);
        if (url.includes('/api/settings')) return jsonResponse(settings);
        return jsonResponse({});
    });
}

describe('PlatformConfig (Settings)', () => {
    beforeEach(() => {
        setupFetch();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("affiche l'onglet Général avec les paramètres chargés", async () => {
        render(<PlatformConfig token="tok" />);

        expect(await screen.findByDisplayValue('Mongain V6')).toBeInTheDocument();
        expect(screen.getByDisplayValue('support@mongain.com')).toBeInTheDocument();
    });

    it("affiche le badge de demandes en attente sur l'onglet Approbation", async () => {
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');

        expect(screen.getByRole('button', { name: /Approbation \(Checker\) \(1\)/i })).toBeInTheDocument();
    });

    it("navigue vers l'onglet Approbation et affiche la demande en attente", async () => {
        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');

        await user.click(screen.getByRole('button', { name: /Approbation \(Checker\)/i }));

        expect(await screen.findByText('UPDATE_FEES')).toBeInTheDocument();
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Ajustement des frais')).toBeInTheDocument();
    });

    it("navigue vers l'onglet Historique et affiche les changements appliqués", async () => {
        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');

        await user.click(screen.getByRole('button', { name: /Historique/i }));

        expect(await screen.findByText('taxCashIn')).toBeInTheDocument();
        expect(screen.getByText('Alignement marché')).toBeInTheDocument();
    });

    it('approuve une demande en attente après confirmation (succès)', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.includes('/api/settings/approve/req-1')) {
                return jsonResponse({ message: 'Modifications appliquées.' });
            }
            if (url.includes('/api/settings/requests')) return jsonResponse(requests);
            if (url.includes('/api/settings/history')) return jsonResponse(history);
            if (url.includes('/api/settings')) return jsonResponse(settings);
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Approbation \(Checker\)/i }));
        await screen.findByText('UPDATE_FEES');

        await user.click(screen.getByRole('button', { name: 'Valider' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/settings/approve/req-1'),
                expect.objectContaining({ method: 'POST' })
            );
        });
        expect(await screen.findByText('✓ Modifications appliquées.')).toBeInTheDocument();
        confirmSpy.mockRestore();
    });

    it("n'approuve pas la demande si la confirmation est annulée", async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes('/api/settings/requests')) return jsonResponse(requests);
            if (url.includes('/api/settings/history')) return jsonResponse(history);
            if (url.includes('/api/settings')) return jsonResponse(settings);
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Approbation \(Checker\)/i }));
        await screen.findByText('UPDATE_FEES');

        fetchMock.mockClear();
        await user.click(screen.getByRole('button', { name: 'Valider' }));

        expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/approve/'), expect.anything());
        confirmSpy.mockRestore();
    });

    it('affiche une erreur si l\'approbation échoue côté serveur', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.includes('/api/settings/approve/req-1')) {
                return jsonResponse({ error: 'Solde insuffisant pour appliquer ce changement.' }, false, 400);
            }
            if (url.includes('/api/settings/requests')) return jsonResponse(requests);
            if (url.includes('/api/settings/history')) return jsonResponse(history);
            if (url.includes('/api/settings')) return jsonResponse(settings);
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Approbation \(Checker\)/i }));
        await screen.findByText('UPDATE_FEES');

        await user.click(screen.getByRole('button', { name: 'Valider' }));

        expect(await screen.findByText('✕ Solde insuffisant pour appliquer ce changement.')).toBeInTheDocument();
        confirmSpy.mockRestore();
    });

    it('bascule le Circuit Breaker après confirmation et motif renseignés', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Incident critique en cours');
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.includes('/api/settings/request')) {
                return jsonResponse({ message: 'Requête soumise, en attente de validation.' });
            }
            if (url.includes('/api/settings/requests')) return jsonResponse(requests);
            if (url.includes('/api/settings/history')) return jsonResponse(history);
            if (url.includes('/api/settings')) return jsonResponse(settings);
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Circuit Breaker/i }));

        await screen.findByText('CIRCUIT BREAKER (Kill Switch)');
        await user.click(screen.getByRole('button', { name: /DÉCLENCHER LE CIRCUIT BREAKER/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/settings/request'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"circuitBreaker":true'),
                })
            );
        });
        confirmSpy.mockRestore();
        promptSpy.mockRestore();
    });

    it("calcule l'aperçu des frais simulés dans l'onglet Frais", async () => {
        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Politique de Frais/i }));

        await screen.findByText('FEE PREVIEW / Simulateur');
        // Retrait Agence par défaut : 100000 <= seuil (500000) => frais gratuits (0 FCFA)
        expect(screen.getByText('0 FCFA')).toBeInTheDocument();
    });

    it("onglet Sécurité Réseau : affiche l'IP détectée et refuse de déposer une activation avec une liste vide", async () => {
        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Sécurité Réseau/i }));

        expect(await screen.findByText('203.0.113.5')).toBeInTheDocument();

        // Activer sans jamais ajouter d'IP -> dépôt refusé côté client
        await user.click(screen.getByRole('button', { name: 'DÉSACTIVÉE' }));
        await user.click(screen.getByRole('button', { name: /Déposer Changement/i }));

        expect(await screen.findByText(/liste vide/i)).toBeInTheDocument();
    });

    it("onglet Sécurité Réseau : ajoute son IP via le bouton dédié puis dépose le changement", async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Mise en place VPN admin');
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.includes('/api/settings/request')) {
                return jsonResponse({ message: 'Requête soumise.' });
            }
            if (url.includes('/api/settings/my-ip')) return jsonResponse({ ip: '203.0.113.5' });
            if (url.includes('/api/settings/requests')) return jsonResponse(requests);
            if (url.includes('/api/settings/history')) return jsonResponse(history);
            if (url.includes('/api/settings')) return jsonResponse(settings);
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        render(<PlatformConfig token="tok" />);
        await screen.findByDisplayValue('Mongain V6');
        await user.click(screen.getByRole('button', { name: /Sécurité Réseau/i }));
        await screen.findByText('203.0.113.5');

        await user.click(screen.getByRole('button', { name: /\+ Ajouter mon IP/i }));
        await user.click(screen.getByRole('button', { name: 'DÉSACTIVÉE' }));
        await user.click(screen.getByRole('button', { name: /Déposer Changement/i }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/settings/request'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"adminIpAllowlistEnabled":true'),
                })
            );
        });
        confirmSpy.mockRestore();
        promptSpy.mockRestore();
    });
});
