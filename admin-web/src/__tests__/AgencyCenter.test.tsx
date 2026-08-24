import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgencyCenter from '../AgencyCenter';

const branches = [
    {
        id: 'branch-1', name: 'Agence Centrale', code: 'AGC001', city: 'Libreville', region: 'Estuaire',
        isHQ: true, status: 'ACTIVE', manager: { name: 'Alice Manager' }, _count: { staff: 8 },
        wallet: { id: 'w1' }, balance: 2500000,
    },
    {
        id: 'branch-2', name: 'Agence Port-Gentil', code: 'AGC002', city: 'Port-Gentil', region: 'Ogooué-Maritime',
        isHQ: false, status: 'DRAFT', manager: null, _count: { staff: 2 }, wallet: null, balance: 0,
    },
];

const overview = {
    id: 'branch-1', name: 'Agence Centrale', code: 'AGC001', city: 'Libreville', region: 'Estuaire',
    address: '12 rue du Port', phone: '+24101010101', status: 'ACTIVE', isHQ: true, balance: 2500000,
    activatedAt: '2025-01-01T00:00:00Z', manager: { name: 'Alice Manager' },
    _count: { staff: 8, sessions: 40 },
    stats: { cashInToday: 100000, cashOutToday: 50000, volumeToday: 150000, activeSessions: 3, discrepancies: 0 },
};

function jsonResponse(body: any, ok = true, status = 200) {
    return { ok, status, json: async () => body } as Response;
}

function setupFetch() {
    (global.fetch as any) = vi.fn(async (url: string) => {
        if (url.includes('/api/admin/branches/branch-1') === false && url.includes('/api/admin/branches')) {
            return jsonResponse({ branches, total: branches.length });
        }
        if (url.includes('/api/admin/branches/branch-1')) {
            return jsonResponse(overview);
        }
        return jsonResponse({});
    });
}

describe('AgencyCenter', () => {
    beforeEach(() => {
        setupFetch();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("affiche la liste des agences chargée depuis l'API", async () => {
        render(<AgencyCenter token="tok" hasPerm={() => true} />);

        expect(await screen.findByText('Agence Centrale')).toBeInTheDocument();
        expect(screen.getByText('Agence Port-Gentil')).toBeInTheDocument();
        expect(screen.getByText('2 agences dans le réseau Mongain')).toBeInTheDocument();
    });

    it('affiche le bouton "Nouvelle Agence" pour un rôle admin', async () => {
        render(<AgencyCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('Agence Centrale');
        expect(screen.getByRole('button', { name: /Nouvelle Agence/i })).toBeInTheDocument();
    });

    it('masque le bouton "Nouvelle Agence" pour un rôle non-admin', async () => {
        render(<AgencyCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('Agence Centrale');
        expect(screen.queryByRole('button', { name: /Nouvelle Agence/i })).not.toBeInTheDocument();
    });

    it("ouvre la vue 360° d'une agence et affiche ses KPIs", async () => {
        const user = userEvent.setup();
        render(<AgencyCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('Agence Centrale');

        const rows = screen.getAllByRole('button', { name: /360°/i });
        await user.click(rows[0]);

        expect(await screen.findByText('Informations de l\'agence')).toBeInTheDocument();
        expect(screen.getByText('Alice Manager')).toBeInTheDocument();
    });

    it('affiche une erreur si le chargement des agences échoue', async () => {
        (global.fetch as any) = vi.fn(async () => jsonResponse({ error: 'Accès refusé.' }, false, 403));
        render(<AgencyCenter token="tok" hasPerm={() => true} />);

        expect(await screen.findByText('Accès refusé.')).toBeInTheDocument();
    });

    it('crée une nouvelle agence via le formulaire (succès)', async () => {
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.endsWith('/api/admin/branches')) {
                return jsonResponse({ id: 'new-branch' });
            }
            if (url.includes('/api/admin/branches')) return jsonResponse({ branches, total: branches.length });
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        const { container } = render(<AgencyCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('Agence Centrale');

        await user.click(screen.getByRole('button', { name: /Nouvelle Agence/i }));
        expect(screen.getByText('Créer une agence')).toBeInTheDocument();

        // Les champs du formulaire de création n'ont pas de <label htmlFor>, on les cible
        // donc par ordre d'apparition dans le <form> : Nom, Code, Ville, Région, Adresse, Téléphone.
        const formInputs = container.querySelectorAll('form input');
        await user.type(formInputs[0], 'Agence Test');
        await user.type(formInputs[1], 'AGCTEST');

        await user.click(screen.getByRole('button', { name: "Créer l'agence" }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('/api/admin/branches'),
                expect.objectContaining({ method: 'POST' })
            );
        });
        await waitFor(() => {
            expect(screen.queryByText('Créer une agence')).not.toBeInTheDocument();
        });
    });

    it("affiche une alerte si la création d'agence échoue", async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
        const fetchMock = vi.fn(async (url: string, opts?: any) => {
            if (opts?.method === 'POST' && url.endsWith('/api/admin/branches')) {
                return jsonResponse({ error: 'Code agence déjà utilisé.' }, false, 400);
            }
            if (url.includes('/api/admin/branches')) return jsonResponse({ branches, total: branches.length });
            return jsonResponse({});
        });
        (global.fetch as any) = fetchMock;

        const user = userEvent.setup();
        const { container } = render(<AgencyCenter token="tok" hasPerm={() => true} />);
        await screen.findByText('Agence Centrale');

        await user.click(screen.getByRole('button', { name: /Nouvelle Agence/i }));
        const formInputs = container.querySelectorAll('form input');
        await user.type(formInputs[0], 'Agence Test');
        await user.type(formInputs[1], 'AGCTEST');
        await user.click(screen.getByRole('button', { name: "Créer l'agence" }));

        await waitFor(() => {
            expect(alertSpy).toHaveBeenCalledWith('Code agence déjà utilisé.');
        });
    });
});
