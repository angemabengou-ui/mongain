import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePassword from '../ChangePassword';

describe('ChangePassword', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    const fillAndSubmit = async (current: string, next: string, confirm: string, container: HTMLElement) => {
        const user = userEvent.setup();
        // Les <label> ne sont pas liés aux <input type="password"> via htmlFor/id dans ce
        // composant, donc getByLabelText ne les trouve pas — on les récupère par ordre.
        const [currentField, newField, confirmField] = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
        if (current) await user.type(currentField, current);
        if (next) await user.type(newField, next);
        if (confirm) await user.type(confirmField, confirm);
        await user.click(screen.getByRole('button', { name: /Valider le nouveau mot de passe/i }));
        return user;
    };

    it('affiche le formulaire de changement de mot de passe', () => {
        render(<ChangePassword token="tok" onLogout={vi.fn()} />);
        expect(screen.getByText('Changement de mot de passe requis')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Valider le nouveau mot de passe/i })).toBeInTheDocument();
    });

    it('refuse un nouveau mot de passe trop court sans appeler le serveur', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { container } = render(<ChangePassword token="tok" onLogout={vi.fn()} />);
        await fillAndSubmit('temp123', 'short', 'short', container);
        expect(await screen.findByText(/au moins 8 caractères/)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuse si la confirmation ne correspond pas', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const { container } = render(<ChangePassword token="tok" onLogout={vi.fn()} />);
        await fillAndSubmit('temp123', 'newpassword1', 'differentpassword', container);
        expect(await screen.findByText(/ne correspond pas/)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('soumet le formulaire et déconnecte en cas de succès', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
        const onLogout = vi.fn();
        const { container } = render(<ChangePassword token="tok" onLogout={onLogout} />);
        await fillAndSubmit('temp123', 'newpassword1', 'newpassword1', container);
        await waitFor(() => expect(onLogout).toHaveBeenCalled());
        expect(window.alert).toHaveBeenCalled();
    });

    it("affiche l'erreur renvoyée par le serveur en cas d'échec", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Mot de passe temporaire invalide.' }) }));
        const onLogout = vi.fn();
        const { container } = render(<ChangePassword token="tok" onLogout={onLogout} />);
        await fillAndSubmit('wrongtemp', 'newpassword1', 'newpassword1', container);
        expect(await screen.findByText(/Mot de passe temporaire invalide\./)).toBeInTheDocument();
        expect(onLogout).not.toHaveBeenCalled();
    });

    it('appelle onLogout au clic sur "Se déconnecter"', async () => {
        const user = userEvent.setup();
        const onLogout = vi.fn();
        render(<ChangePassword token="tok" onLogout={onLogout} />);
        await user.click(screen.getByRole('button', { name: 'Se déconnecter' }));
        expect(onLogout).toHaveBeenCalled();
    });
});
