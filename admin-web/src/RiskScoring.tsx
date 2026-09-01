import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function RiskScoring({ token: _token }: { token: string }) {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch(API_URL + '/api/admin/scoring', {
            headers: { 'Authorization': `Bearer ${_token}` }
        })
            .then(data => {
                if (Array.isArray(data)) setUsers(data);
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
                Scoring & Risques (V6 Phase 3)
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Classification IA des profils utilisateurs par taux de fiabilité.</p>

            {loading ? <div style={{ color: 'var(--text-secondary)' }}>Calcul algorithmique en cours...</div> : (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                                <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)' }}>UTILISATEUR</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>STATUT</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>SCORE IA</th>
                                <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>TIER</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u, idx) => {
                                let tierColor = '#f59e0b';
                                let tierBg = 'rgba(245, 158, 11, 0.1)';
                                if (u.tier === 'Trusted') {
                                    tierColor = '#10b981';
                                    tierBg = 'rgba(16, 185, 129, 0.1)';
                                } else if (u.tier === 'High Risk') {
                                    tierColor = '#ef4444';
                                    tierBg = 'rgba(239, 68, 68, 0.1)';
                                }

                                return (
                                    <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{u.name}</div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{u.phone}</div>
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                            <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.1)' }}>{u.status}</span>
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)' }}>
                                            {u.score}
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                            <span style={{ padding: '6px 12px', background: tierBg, color: tierColor, borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                                                {u.tier}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>

                    {users.length === 0 && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun utilisateur trouvé pour l'échantillonnage de scoring.</div>
                    )}
                </div>
            )}
        </div>
    );
}
