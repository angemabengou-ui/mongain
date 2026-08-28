import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../Login';
import { apiFetch } from '../utils/apiFetch';

vi.mock('../utils/apiFetch', () => ({ apiFetch: vi.fn() }));
const mockedApiFetch = vi.mocked(apiFetch);

describe('Login', () => {
    beforeEach(() => {
        mockedApiFetch.mockReset();
    });

    it('affiche le formulaire de connexion', () => {
        render(<Login setToken={vi.fn()} />);
        expect(screen.getByText('Mongain Corporate')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('prenom.nom@mongain.com')).toBeInTheDocument();
    });

    it('désactive le bouton de connexion tant que les champs sont vides', () => {
        render(<Login setToken={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Accéder au Portail/i })).toBeDisabled();
    });

    it("passe à l'étape du code de sécurité après un mot de passe valide (2FA), sans jamais recevoir le token à cette étape", async () => {
        mockedApiFetch.mockResolvedValue({ requireOtp: true, message: 'Un code de sécurité a été envoyé par SMS.' });
        const setToken = vi.fn();

        render(<Login setToken={setToken} />);
        fireEvent.change(screen.getByPlaceholderText('prenom.nom@mongain.com'), { target: { value: 'checker@mongain.com' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'motdepasse123' } });
        fireEvent.click(screen.getByRole('button', { name: /Accéder au Portail/i }));

        expect(await screen.findByText(/Code de Sécurité/i)).toBeInTheDocument();
        expect(setToken).not.toHaveBeenCalled();
    });

    it('délivre la session après un code OTP valide', async () => {
        mockedApiFetch
            .mockResolvedValueOnce({ requireOtp: true })
            .mockResolvedValueOnce({ token: 'tok-123', user: { id: 's1', role: 'SUPER_ADMIN', name: 'Fatou', email: 'checker@mongain.com', mustChangePassword: false } });
        const setToken = vi.fn();

        render(<Login setToken={setToken} />);
        fireEvent.change(screen.getByPlaceholderText('prenom.nom@mongain.com'), { target: { value: 'checker@mongain.com' } });
        fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'motdepasse123' } });
        fireEvent.click(screen.getByRole('button', { name: /Accéder au Portail/i }));

        const otpInput = await screen.findByPlaceholderText('0000');
        fireEvent.change(otpInput, { target: { value: '1234' } });
        fireEvent.click(screen.getByRole('button', { name: /Confirmer/i }));

        await vi.waitFor(() => expect(setToken).toHaveBeenCalledWith('tok-123', 'SUPER_ADMIN', 'Fatou', 'checker@mongain.com', false));
    });
});
