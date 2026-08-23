import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Login from '../Login';

describe('Login', () => {
    it('affiche le formulaire de connexion', () => {
        render(<Login setToken={vi.fn()} />);
        expect(screen.getByText('Mongain Corporate')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('prenom.nom@mongain.com')).toBeInTheDocument();
    });

    it('désactive le bouton de connexion tant que les champs sont vides', () => {
        render(<Login setToken={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Accéder au Portail/i })).toBeDisabled();
    });
});
