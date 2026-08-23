import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StaffCreate from '../StaffCreate';

// Remplit les champs requis directement via fireEvent.change (plus rapide et fiable
// ici que userEvent.type sur un formulaire de 9 champs, dont un <input type="date">).
function fillRequiredFields(container: HTMLElement) {
    const byLabel = (label: string) => {
        const labelEl = Array.from(container.querySelectorAll('label')).find(l => l.textContent === label);
        return labelEl?.nextElementSibling as HTMLInputElement;
    };
    fireEvent.change(byLabel('Nom Complet'), { target: { value: 'Jean Dupont' } });
    fireEvent.change(byLabel('Email (Identifiant de Connexion)'), { target: { value: 'jean@mongain.com' } });
    fireEvent.change(byLabel('Date de Naissance'), { target: { value: '1990-01-01' } });
    fireEvent.change(byLabel('N° Téléphone Personnel'), { target: { value: '077000000' } });
    fireEvent.change(byLabel("Contact d'Urgence"), { target: { value: '066000000' } });
    fireEvent.change(byLabel('Adresse de Résidence'), { target: { value: 'Quartier X, Libreville' } });
    fireEvent.change(byLabel('Matricule RH Attribué'), { target: { value: 'MONG-1049' } });
    fireEvent.change(byLabel("N° Pièce d'Identité (CNI)"), { target: { value: 'GAB-00994' } });
    fireEvent.change(byLabel('Mot de Passe Provisoire'), { target: { value: 'temporary1' } });
}

describe('StaffCreate', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    it('affiche le formulaire de création', () => {
        render(<StaffCreate token="tok" />);
        expect(screen.getByText('1. Créer un Utilisateur')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Créer l'utilisateur/i })).toBeInTheDocument();
    });

    it('crée un utilisateur et affiche le message de confirmation en cas de succès', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
        const { container } = render(<StaffCreate token="tok" />);
        fillRequiredFields(container);
        fireEvent.click(screen.getByRole('button', { name: /Créer l'utilisateur/i }));

        expect(await screen.findByText(/a été créé\(e\)/)).toBeInTheDocument();
        expect(screen.getByText(/Jean Dupont/)).toBeInTheDocument();
    });

    it("affiche une alerte en cas d'échec de la création", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Email déjà utilisé.' }) }));
        const { container } = render(<StaffCreate token="tok" />);
        fillRequiredFields(container);
        fireEvent.click(screen.getByRole('button', { name: /Créer l'utilisateur/i }));

        await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Email déjà utilisé.'));
        expect(screen.queryByText(/a été créé\(e\)/)).not.toBeInTheDocument();
    });

    it('envoie les données saisies dans la requête POST', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.stubGlobal('fetch', fetchMock);
        const { container } = render(<StaffCreate token="tok" />);
        fillRequiredFields(container);
        fireEvent.click(screen.getByRole('button', { name: /Créer l'utilisateur/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        const [, options] = fetchMock.mock.calls[0];
        const body = JSON.parse(options.body);
        expect(body.name).toBe('Jean Dupont');
        expect(body.email).toBe('jean@mongain.com');
        expect(options.headers.Authorization).toBe('Bearer tok');
    });
});
