import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function SystemMonitor({ token: _token }: { token: string }) {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiFetch(API_URL + '/api/admin/v6/health', {
            headers: { 'Authorization': `Bearer ${_token}` }
        })
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setStats({
                    redis: { status: 'offline', operations: 0, hitRate: '0%' },
                    server: { uptime: 'Erreur', memory: 'Erreur', cpu: 'N/A' },
                    errors: [{ time: new Date().toLocaleTimeString(), type: 'Erreur Connexion API Backend', count: 1 }]
                });
                setLoading(false);
            });
    }, [_token]);

    return (
        <div style={{ padding: 40, animation: 'fadeIn 0.5s ease-out' }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, background: 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Santé Système & Infrastructures (V6 Phase 1)
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Monitoring Redis, Serveur et Journalisation en temps réel.</p>

            {loading ? <div style={{ color: 'var(--text-secondary)' }}>Mise en place de la télémétrie...</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
                        <div className="card" style={{ padding: 24 }}>
                            <h3 style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', marginBottom: 12 }}>Serveur (Node.js)</h3>
                            <div style={{ fontSize: 18, color: 'var(--text-primary)', marginBottom: 4 }}>Uptime: {stats.server.uptime}</div>
                            <div style={{ fontSize: 13, color: '#06b6d4' }}>RAM: {stats.server.memory}</div>
                        </div>

                        <div className="card" style={{ padding: 24, background: 'var(--bg-secondary)', border: '1px solid rgba(6,182,212,0.3)' }}>
                            <h3 style={{ color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', marginBottom: 12 }}>Redis Cache</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: stats.redis.status === 'online' ? '#10b981' : '#ef4444' }}></div>
                                <span style={{ fontSize: 18, color: 'var(--text-primary)' }}>{stats.redis.status === 'online' ? 'Connecté & Actif' : 'Hors-Ligne (Désactivé)'}</span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Hit Rate: {stats.redis.hitRate} | Requêtes Totales: {stats.redis.operations}</div>
                        </div>
                    </div>

                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'rgba(0,0,0,0.3)' }}>
                                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)' }}>HEURE</th>
                                    <th style={{ padding: '16px 20px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)' }}>TYPE D'INCIDENT</th>
                                    <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>OCCURRENCES</th>
                                    <th style={{ padding: '16px 20px', textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.errors.map((e: any, idx: number) => (
                                    <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                                        <td style={{ padding: '16px 20px', color: 'var(--text-primary)', fontSize: 14 }}>{e.time}</td>
                                        <td style={{ padding: '16px 20px', color: '#ef4444', fontSize: 14, fontWeight: 500 }}>{e.type}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', color: 'var(--text-primary)' }}>{e.count}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                                            {/* Flux d'incidents réel (Sentry ou équivalent) pas encore branché côté serveur — le
                                                bouton "Ignorer" simulait une action qu'aucune route ne pouvait exécuter. */}
                                            —
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
