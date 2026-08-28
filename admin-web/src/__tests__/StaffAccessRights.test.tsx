import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffAccessRights from '../StaffAccessRights';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

const pendingStaff = { id: 's1', name: 'Karim Nouveau', email: 'karim@mongain.com', role: 'TELLER', branch: { name: 'Agence Centrale' } };
const activeStaff = { id: 's2', name: 'Fatou Checker', email: 'fatou@mongain.com', role: 'COMPLIANCE_CHECKER', status: 'ACTIVE', isActive: true, branch: { name: 'Direction Corporate' } };

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

    it("affiche perm_treasury_approve dans la matrice de droits (rendue depuis le catalogue backend, pas une copie codée en dur qui l'omettait)", async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ staff: [activeStaff], total: 1 })
            .mockResolvedValueOnce({
                effectivePermissions: ['perm_treasury_approve'],
                permissionsCustomized: false,
                groups: [{ label: 'Trésorerie & Système', perms: ['perm_treasury_approve'] }],
            });

        render(<StaffAccessRights token="tok" />);
        fireEvent.click(await screen.findByText('Droits'));

        expect(await screen.findByText('Approuver une demande de trésorerie (Checker)')).toBeInTheDocument();
    });
});
