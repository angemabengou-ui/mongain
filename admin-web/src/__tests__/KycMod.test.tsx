import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import KycMod from '../KycMod';

const pendingDossier = { id: 'u1', name: 'Marie Client', phone: '077111111', createdAt: '2026-08-20T10:00:00Z', idCardFront: null, idCardBack: null, selfie: null };
const dossierWithPhotos = { ...pendingDossier, idCardFront: 'https://cdn/front.jpg', idCardBack: 'https://cdn/back.jpg', selfie: 'https://cdn/selfie.jpg' };

describe('KycMod', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    it('affiche les dossiers KYC en attente', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([pendingDossier]) }));
        render(<KycMod token="tok" />);
        expect(await screen.findByText('Marie Client')).toBeInTheDocument();
        expect(screen.getByText('Base KYC & Identité')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Approuver/i })).toBeInTheDocument();
    });

    it("affiche un message quand aucun dossier n'est en attente", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }));
        render(<KycMod token="tok" />);
        expect(await screen.findByText(/Aucun dossier KYC en attente/)).toBeInTheDocument();
    });

    it("affiche une erreur si le chargement échoue", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<KycMod token="tok" />);
        expect(await screen.findByText('Erreur lors du chargement des KYC')).toBeInTheDocument();
    });

    it('bascule vers les identités certifiées au clic sur l\'onglet correspondant', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
        vi.stubGlobal('fetch', fetchMock);
        render(<KycMod token="tok" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Identités Certifiées' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][0]).toContain('status=APPROVED');
    });

    it('approuve un dossier après confirmation et rafraîchit la liste', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([pendingDossier]) }) // fetch initial
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }) // PUT approve
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) }); // refresh
        vi.stubGlobal('fetch', fetchMock);

        render(<KycMod token="tok" />);
        await screen.findByText('Marie Client');

        fireEvent.click(screen.getByRole('button', { name: /Approuver/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('approuvé'));
        const [, options] = fetchMock.mock.calls[1];
        expect(options.method).toBe('PUT');
        expect(JSON.parse(options.body).status).toBe('APPROVED');
    });

    it("n'appelle pas l'API si l'utilisateur annule la confirmation", async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([pendingDossier]) });
        vi.stubGlobal('fetch', fetchMock);

        render(<KycMod token="tok" />);
        await screen.findByText('Marie Client');
        fireEvent.click(screen.getByRole('button', { name: /Approuver/i }));

        await waitFor(() => expect(window.confirm).toHaveBeenCalled());
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("ouvre la photo en plein écran au clic, pour pouvoir vérifier la pièce d'identité", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([dossierWithPhotos]) }));
        render(<KycMod token="tok" />);

        const thumbnail = await screen.findByAltText('CNI Recto — Marie Client');
        // Une seule image tant que le zoom n'est pas ouvert : juste la vignette.
        expect(screen.getAllByAltText('CNI Recto — Marie Client')).toHaveLength(1);

        fireEvent.click(thumbnail);
        // Le zoom plein écran ajoute une seconde image (la vignette reste affichée dessous).
        expect(screen.getAllByAltText('CNI Recto — Marie Client')).toHaveLength(2);

        fireEvent.click(screen.getByLabelText('Fermer'));
        expect(screen.getAllByAltText('CNI Recto — Marie Client')).toHaveLength(1);
    });
});
