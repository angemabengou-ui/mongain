import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffAssignBranch from '../StaffAssignBranch';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const branches = [{ id: 'b1', name: 'Agence Centrale', isHQ: false }];
const staffUnassigned = { id: 's1', name: 'Amina Staff', email: 'amina@mongain.com', matricule: 'M-1', branchId: null, branch: null };

// La page fait: 1 fetch des agences au montage, puis 1 fetch (débounce 300ms) du
// personnel à chaque changement de filtre/page/recherche/tri.
function mockApiFetchByCall(staffResponse: any) {
    mockedApiFetch.mockImplementation((url: string) => {
        if (url.includes('/api/admin/branches')) return Promise.resolve(branches);
        return Promise.resolve(staffResponse);
    });
}

describe('StaffAssignBranch', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockedApiFetch.mockReset();
    });

    it('affiche la liste du personnel avec son affectation', async () => {
        mockApiFetchByCall({ staff: [staffUnassigned], total: 1 });
        render(<StaffAssignBranch token="tok" />);
        expect(await screen.findByText('Amina Staff')).toBeInTheDocument();
        expect(screen.getByText('NON AFFECTÉ')).toBeInTheDocument();
        expect(screen.getByText('2. Affecter à une Agence')).toBeInTheDocument();
    }, 10000);

    it("affiche un message quand aucun utilisateur ne correspond", async () => {
        mockApiFetchByCall({ staff: [], total: 0 });
        render(<StaffAssignBranch token="tok" />);
        expect(await screen.findByText('Aucun utilisateur ne correspond à ces filtres.')).toBeInTheDocument();
    }, 10000);

    it("affiche une erreur en cas d'échec du chargement du personnel", async () => {
        mockedApiFetch.mockImplementation((url: string) => {
            if (url.includes('/api/admin/branches')) return Promise.resolve(branches);
            return Promise.reject(new Error('Accès refusé.'));
        });
        render(<StaffAssignBranch token="tok" />);
        expect(await screen.findByText('Accès refusé.')).toBeInTheDocument();
    }, 10000);

    it('affecte un utilisateur à une agence après confirmation', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockedApiFetch.mockImplementation((url: string, options?: any) => {
            if (url.includes('/api/admin/branches')) return Promise.resolve(branches);
            if (options?.method === 'PUT') return Promise.resolve({});
            return Promise.resolve({ staff: [staffUnassigned], total: 1 });
        });
        render(<StaffAssignBranch token="tok" />);
        await screen.findByText('Amina Staff');

        const select = screen.getByDisplayValue('— Non affecté —');
        fireEvent.change(select, { target: { value: 'b1' } });

        const saveButton = screen.getByRole('button', { name: /Affecter/i });
        await waitFor(() => expect(saveButton).not.toBeDisabled());
        fireEvent.click(saveButton);

        await waitFor(() => {
            const putCall = mockedApiFetch.mock.calls.find(c => (c[1] as any)?.method === 'PUT');
            expect(putCall).toBeTruthy();
        });
        const putCall = mockedApiFetch.mock.calls.find(c => (c[1] as any)?.method === 'PUT')!;
        expect(putCall[0]).toContain('/api/admin/staff/s1');
        expect(JSON.parse((putCall[1] as any).body)).toEqual({ branchId: 'b1' });
    }, 10000);
});
