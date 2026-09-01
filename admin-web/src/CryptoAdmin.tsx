import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function CryptoAdmin({ token: _token }: { token: string }) {
    const [data, setData] = useState<{ market: any[], usersExposure: any }>({ market: [], usersExposure: {} });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // En vrai, il faudrait une route /api/admin/crypto/stats
        // Pour V8 on mock les stats de liquidité basées sur le marché global
        apiFetch(API_URL + '/api/crypto/market', {
            headers: { 'Authorization': `Bearer ${_token}` }
        })
            .then(res => {
                setData({ market: res.market || [], usersExposure: { BTC: 4.5, ETH: 120, USDT: 45000 } });
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [_token]);

    return (
        <div style={{ padding: 40, animation: 'fadeIn 0.5s ease-out' }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8, background: 'linear-gradient(90deg, #A855F7, #F472B6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Mongain Crypto Desk
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Supervision de la liquidité et de l'exposition globale de la plateforme aux crypto-actifs.</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20, marginBottom: 40 }}>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 24, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>Volume d'achat (24h)</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#10B981' }}>+48,500,000 XAF</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: 24, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>Revenus (Commissions Spread)</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#F59E0B' }}>≈ 727,500 XAF</div>
                </div>
            </div>

            <h2 style={{ fontSize: 20, color: '#fff', marginBottom: 20 }}>Réserve et Exposition</h2>
            {loading ? <div style={{ color: '#fff' }}>Chargement...</div> : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                                <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)' }}>ACTIF</th>
                                <th style={{ padding: '16px 20px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>COURS (XAF)</th>
                                <th style={{ padding: '16px 20px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>DÉTENU PAR LES UTILISATEURS</th>
                                <th style={{ padding: '16px 20px', textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)' }}>VALEUR FIAT EXPOSÉE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.market.map((m, idx) => {
                                const exposure = data.usersExposure[m.asset] || 0;
                                const fiatValue = (exposure * m.priceXAF).toLocaleString();
                                return (
                                    <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '16px 20px', fontWeight: 700, color: '#fff' }}>{m.asset}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'right', fontWeight: 600, color: '#10B981' }}>{m.priceXAF.toLocaleString()} XAF</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'right', color: 'var(--text-secondary)' }}>{exposure.toFixed(4)} {m.asset}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'right', fontWeight: 700, color: '#F472B6' }}>{fiatValue} XAF</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
