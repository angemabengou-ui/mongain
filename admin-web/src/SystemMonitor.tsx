import { useEffect, useState } from 'react';

export default function SystemMonitor({ token: _token }: { token: string }) {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Will fetch /api/v6/system/health later
        setTimeout(() => {
            setStats({
                redis: { status: 'mocked_online', operations: 15320, hitRate: '98.5%' },
                server: { uptime: '12d 4h', memory: '184 MB / 512 MB', cpu: '12%' },
                errors: [
                    { time: '10:42 AM', type: 'Database Timeout (Simulated)', count: 2 },
                    { time: '09:15 AM', type: 'Redis Disconnect (Simulated)', count: 1 }
                ]
            });
            setLoading(false);
        }, 1500);
    }, []);

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
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: '#10b981' }}></div>
                                <span style={{ fontSize: 18, color: 'var(--text-primary)' }}>Connecté (Mock)</span>
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Hit Rate: {stats.redis.hitRate} | Ops: {stats.redis.operations}</div>
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
                                        <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                                            <button style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 8, cursor: 'not-allowed' }}>Ignorer</button>
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
