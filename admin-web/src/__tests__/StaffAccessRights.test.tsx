import { render, screen } from '@testing-library/react';
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
        vi.spyOn(window, 'alert').mockImplementation(() => { });
    });

    it("charge et affiche la liste du personnel", async () => {
        mockedApiFetch.mockResolvedValue({ staff: [pendingStaff], total: 1 });
        render(<StaffAccessRights token="tok" />);
        expect(await screen.findByText('Karim Nouveau')).toBeInTheDocument();
    });

    it("affiche une erreur en cas d'échec du chargement", async () => {
        mockedApiFetch.mockRejectedValue(new Error('Erreur serveur (500).'));
        render(<StaffAccessRights token="tok" />);
        expect(await screen.findByText('Erreur serveur (500).')).toBeInTheDocument();
    });
});
