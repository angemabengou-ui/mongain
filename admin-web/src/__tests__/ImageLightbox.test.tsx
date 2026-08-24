import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImageLightbox from '../components/ImageLightbox';

describe('ImageLightbox', () => {
    it("affiche l'image en grand avec sa légende", () => {
        render(<ImageLightbox src="https://cdn/photo.jpg" alt="CNI Recto — Jean" onClose={vi.fn()} />);

        const img = screen.getByAltText('CNI Recto — Jean');
        expect(img).toHaveAttribute('src', 'https://cdn/photo.jpg');
    });

    it('se ferme au clic sur le fond', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="https://cdn/photo.jpg" alt="CNI Recto" onClose={onClose} />);

        // Le fond est le premier ancêtre position:fixed du texte d'instruction.
        fireEvent.click(screen.getByText(/Échap ou cliquez à l'extérieur/).parentElement!);

        expect(onClose).toHaveBeenCalled();
    });

    it("ne se ferme PAS au clic sur l'image elle-même (propagation stoppée)", () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="https://cdn/photo.jpg" alt="CNI Recto" onClose={onClose} />);

        fireEvent.click(screen.getByAltText('CNI Recto'));

        expect(onClose).not.toHaveBeenCalled();
    });

    it('se ferme sur la touche Échap', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="https://cdn/photo.jpg" alt="CNI Recto" onClose={onClose} />);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    it('se ferme au clic sur le bouton fermer', () => {
        const onClose = vi.fn();
        render(<ImageLightbox src="https://cdn/photo.jpg" alt="CNI Recto" onClose={onClose} />);

        fireEvent.click(screen.getByLabelText('Fermer'));

        expect(onClose).toHaveBeenCalled();
    });
});
