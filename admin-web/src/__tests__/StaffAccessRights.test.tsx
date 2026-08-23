import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffAccessRights from '../StaffAccessRights';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const pendingStaff = { id: 's1', name: 'Karim Nouveau', email: 'karim@mongain.com', role: 'TELLER', branch: { name: 'Agence Centrale' } };

describe('StaffAccessRights', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    it("affiche la file d'attente d'activation", async () => {
        mockedApiFetch.mockResolvedValue({ staff: [pendingStaff], total: 1 });
        render(<StaffAccessRights token="tok" />);
        expect(await screen.findByText('Karim Nouveau')).toBeInTheDocument();
        expect(screen.getByText("3. Droits d'Accès & Activation")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Activer/i })).toBeInTheDocument();
    });

    it("affiche un message quand la file d'attente est vide", async () => {
        mockedApiFetch.mockResolvedValue({ staff: [], total: 0 });
        render(<StaffAccessRights token="tok" />);
        expect(await screen.findByText("Aucun compte en attente d'activation.")).toBeInTheDocument();
    });

    it("affiche une erreur en cas d'échec du chargement", async () => {
        mockedApiFetch.mockRejectedValue(new Error('Erreur serveur (500).'));
        render(<StaffAccessRights token="tok" />);
        expect(await screen.findByText('Erreur serveur (500).')).toBeInTheDocument();
    });

    it('active un compte en attente après confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockedApiFetch.mockImplementation((url: string, options?: any) => {
            if (options?.method === 'PUT' && url.includes('/approve')) return Promise.resolve({});
            if (options?.method === 'PUT') return Promise.resolve({}); // setRole
            return Promise.resolve({ staff: [pendingStaff], total: 1 });
        });
        render(<StaffAccessRights token="tok" />);
        await screen.findByText('Karim Nouveau');

        fireEvent.click(screen.getByRole('button', { name: /Activer/i }));

        await waitFor(() => {
            const approveCall = mockedApiFetch.mock.calls.find(c => (c[0] as string).includes('/approve'));
            expect(approveCall).toBeTruthy();
        });
    });

    it('affiche les résultats de recherche après saisie', async () => {
        const activeStaff = { id: 's2', name: 'Sylvie Active', email: 'sylvie@mongain.com', role: 'TELLER', branch: { name: 'Siège' }, isActive: true };
        mockedApiFetch.mockImplementation((url: string) => {
            if (url.includes('status=PENDING')) return Promise.resolve({ staff: [], total: 0 });
            if (url.includes('q=Sylvie')) return Promise.resolve({ staff: [activeStaff], total: 1 });
            return Promise.resolve({ staff: [], total: 0 });
        });
        render(<StaffAccessRights token="tok" />);
        await screen.findByText("Aucun compte en attente d'activation.");

        fireEvent.change(screen.getByPlaceholderText('Nom, email ou matricule...'), { target: { value: 'Sylvie' } });

        expect(await screen.findByText('Sylvie Active')).toBeInTheDocument();
        expect(screen.getByText('ACTIF')).toBeInTheDocument();
    }, 10000);
});
