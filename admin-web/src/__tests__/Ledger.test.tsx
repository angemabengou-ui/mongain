import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Ledger from '../Ledger';

const tx1 = {
    id: 'tx1', createdAt: '2026-08-20T10:00:00Z', amount: 5000, reference: 'TX-001', status: 'COMPLETED',
    senderWallet: { user: { id: 'u1', name: 'Alice Sender', phone: '077111111' } },
    receiverWallet: { user: { id: 'u2', name: 'Bob Receiver', phone: '077222222' } },
};
const tx2 = {
    id: 'tx2', createdAt: '2026-08-21T10:00:00Z', amount: 1200, reference: 'FEE-002', status: 'COMPLETED',
    senderWallet: { user: { id: 'u3', name: 'Carla Fee', phone: '077333333' } },
    receiverWallet: { user: { id: 'u4', name: 'System', phone: '000' } },
};

describe('Ledger', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
    });

    it('affiche les transactions du grand livre', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([tx1, tx2]) }));
        render(<Ledger token="tok" />);
        expect(await screen.findByText('Alice Sender')).toBeInTheDocument();
        expect(screen.getByText('Bob Receiver')).toBeInTheDocument();
        expect(screen.getByText('Grand Livre (Ledger AML)')).toBeInTheDocument();
    });

    it("affiche un message quand l'accès est refusé (403)", async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Accès au grand livre refusé.' }) }));
        render(<Ledger token="tok" />);
        expect(await screen.findByText(/Accès au grand livre refusé\./)).toBeInTheDocument();
    });

    it('affiche un message en cas de panne réseau', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
        render(<Ledger token="tok" />);
        expect(await screen.findByText(/Impossible de contacter le serveur\./)).toBeInTheDocument();
    });

    it('filtre les transactions via la barre de recherche', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([tx1, tx2]) }));
        render(<Ledger token="tok" />);
        await screen.findByText('Alice Sender');

        fireEvent.change(screen.getByPlaceholderText(/Rechercher par Numéro/), { target: { value: 'Carla' } });

        expect(screen.getByText('Carla Fee')).toBeInTheDocument();
        expect(screen.queryByText('Alice Sender')).not.toBeInTheDocument();
    });

    it('affiche les boutons d\'export CSV et PDF', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([tx1]) }));
        render(<Ledger token="tok" />);
        await screen.findByText('Alice Sender');
        expect(screen.getByRole('button', { name: /CSV/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Télécharger PDF/i })).toBeInTheDocument();
    });
});
