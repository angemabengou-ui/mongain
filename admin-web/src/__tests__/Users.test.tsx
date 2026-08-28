import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsersManagement from '../Users';

const token = 'test-token';

const customersPage = {
    customers: [
        {
            id: 'u1', name: 'Jean Dupont', phone: '077000001', accountNumber: 'ACC001',
            kycStatus: 'APPROVED', accountStatus: 'ACTIVE', role: 'USER',
            wallet: { updatedAt: '2026-01-01T00:00:00Z' }, _count: { riskFlags: 0 },
        },
        {
            id: 'u2', name: 'Awa Koné', phone: '077000002', accountNumber: 'ACC002',
            kycStatus: 'PENDING', accountStatus: 'SUSPENDED', role: 'USER',
            wallet: null, _count: { riskFlags: 2 },
        },
    ],
    total: 2,
};

function buildFetchMock(overrides: { customersOk?: boolean; customersError?: string } = {}) {
    return vi.fn((url: string, opts?: any) => {
        const method = opts?.method;
        if (url.includes('/api/admin/customers')) {
            if (overrides.customersOk === false) {
                return Promise.resolve({ ok: false, json: async () => ({ error: overrides.customersError || 'Accès refusé.' }) });
            }
            return Promise.resolve({ ok: true, json: async () => customersPage });
        }
        if (url.includes('/api/admin/users/create-pro') && method === 'POST') {
            return Promise.resolve({ ok: true, json: async () => ({ id: 'new-1' }) });
        }
        if (url.includes('/api/admin/branches')) {
            return Promise.resolve({ ok: true, json: async () => ({ branches: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
}

describe('UsersManagement', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('charge et affiche la liste des clients', async () => {
        fetchMock = buildFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        render(<UsersManagement token={token} staffRole="SUPER_ADMIN" hasPerm={() => true} />);

        expect(screen.getByText('Recherche dans la base de données...')).toBeInTheDocument();

        await screen.findByText('Jean Dupont');
        expect(screen.getByText('Awa Koné')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('role=USER'), expect.anything());
    });

    it("affiche un message d'erreur en cas d'échec de la requête", async () => {
        fetchMock = buildFetchMock({ customersOk: false, customersError: 'Accès à la liste des comptes refusé.' });
        vi.stubGlobal('fetch', fetchMock);

        render(<UsersManagement token={token} staffRole="SUPPORT_MAKER" hasPerm={() => true} />);

        await screen.findByText(/Accès à la liste des comptes refusé/);
    });

    it('recherche un client par mot-clé', async () => {
        fetchMock = buildFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();

        render(<UsersManagement token={token} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Jean Dupont');

        const input = screen.getByPlaceholderText(/Recherche : Nom, Tel/);
        await user.type(input, 'Jean');
        await user.click(screen.getByRole('button', { name: /Rechercher/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('q=Jean'), expect.anything()));
    });

    it('change de segment vers Marchands', async () => {
        fetchMock = buildFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();

        render(<UsersManagement token={token} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Jean Dupont');

        await user.click(screen.getByRole('button', { name: 'Marchands' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('role=MERCHANT'), expect.anything()));
    });

    it('crée un compte marchand via le formulaire de création', async () => {
        fetchMock = buildFetchMock();
        vi.stubGlobal('fetch', fetchMock);
        const user = userEvent.setup();

        render(<UsersManagement token={token} staffRole="SUPER_ADMIN" hasPerm={() => true} />);
        await screen.findByText('Jean Dupont');

        await user.click(screen.getByRole('button', { name: /Créer Compte Marchand/i }));

        const modalHeading = await screen.findByText('Nouveau Compte Marchand');
        const modalCard = modalHeading.closest('div') as HTMLElement;
        const inputs = Array.from(modalCard.querySelectorAll('input')) as HTMLInputElement[];
        const [phoneInput, nameInput, pinInput] = inputs;

        await user.type(phoneInput, '+24107000000');
        await user.type(nameInput, 'Boutique X');
        await user.type(pinInput, '1234');

        await user.click(within(modalCard).getByRole('button', { name: 'Créer Compte' }));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('créé avec succès')));
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/admin/users/create-pro'),
            expect.objectContaining({ method: 'POST' })
        );
    });

    it("affiche la vue Agents (lockedRole) et charge les agences pour le rattachement", async () => {
        fetchMock = buildFetchMock();
        vi.stubGlobal('fetch', fetchMock);

        render(<UsersManagement token={token} staffRole="SUPER_ADMIN" hasPerm={() => true} lockedRole="AGENT" />);

        expect(screen.getByText(/Agents Mongain \(réseau historique\)/)).toBeInTheDocument();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/admin/branches'), expect.anything()));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('role=AGENT'), expect.anything()));
    });
});
