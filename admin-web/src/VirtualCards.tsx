import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function VirtualCardsAdmin({ token: _token }: { token: string }) {
    const [cards, setCards] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch(API_URL + '/api/admin/cards/all', {
            headers: { 'Authorization': `Bearer ${_token}` }
        })
            .then(data => {
                if (Array.isArray(data)) setCards(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, [_token]);

    return (
        <div style={{ padding: 40, animation: 'fadeIn 0.5s ease-out' }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, background: 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Portefeuille Cartes Virtuelles
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Supervision globale de l'émission et de l'usage des cartes bancaires digitales Mongain V7.</p>

            {loading ? <div style={{ color: 'var(--text-secondary)' }}>Chargement de la flotte de cartes...</div> : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                                <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)' }}>TITULAIRE</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>NUMÉRO DE CARTE</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>SOLDE ENCAissé</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>STATUT</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>RISQUE / ACTION</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cards.map((c, idx) => (
                                <tr key={c.id || idx} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '16px 20px' }}>
                                        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.user?.name || 'Inconnu'}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{c.user?.phone}</div>
                                    </td>
                                    <td style={{ padding: '16px 20px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        **** **** **** {c.cardNumber?.slice(-4) || 'XXXX'}
                                    </td>
                                    <td style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {c.balance?.toLocaleString()} XAF
                                    </td>
                                    <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                        {c.status === 'ACTIVE' ? (
                                            <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontWeight: 600 }}>ACTIVE</span>
                                        ) : (
                                            <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontWeight: 600 }}>FROZEN</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                        <button disabled style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'not-allowed' }}>
                                            Gel d'Urgence
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
