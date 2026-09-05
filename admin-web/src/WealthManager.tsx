import axios from 'axios';
import { CheckCircle, Landmark, RefreshCw, ShieldAlert, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

const fmt = (n: number) => n.toLocaleString('fr-GA');

export default function WealthManager({ token }: { token: string }) {
    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({
        totalAum: 0,
        activeStakers: 0,
        averageApy: 0
    });

    const fetchVaults = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/api/admin/wealth/vaults`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setVaults(res.data.vaults || []);
            setStats(res.data.stats || { totalAum: 0, activeStakers: 0, averageApy: 0 });
        } catch (error) {
            console.error("Wealth error", error);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchVaults();
    }, [token]);

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                <div>
                    <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'var(--success-bg)', color: 'var(--success)', padding: 12, borderRadius: 12 }}><Landmark size={28} /></div>
                        Mongain Wealth Management
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Plateforme Trésorerie : Surveillance de l'AUM (Assets Under Management)</p>
                </div>
                <button
                    onClick={fetchVaults}
                    disabled={loading}
                    className="btn-primary"
                    style={{ background: 'var(--success-bg)', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', boxShadow: 'none' }}
                >
                    <RefreshCw size={20} className={loading ? "spin" : ""} />
                    <span>Actualiser DeFi</span>
                </button>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header">
                        <div className="stat-icon" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                            <Landmark size={24} />
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">AUM (Fonds Verouillés)</div>
                        <div className="stat-value">{fmt(stats.totalAum)} FCFA</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-header">
                        <div className="stat-icon" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                            <Users size={24} />
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">Stakers Actifs</div>
                        <div className="stat-value">{stats.activeStakers}</div>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-header">
                        <div className="stat-icon" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                            <TrendingUp size={24} />
                        </div>
                    </div>
                    <div>
                        <div className="stat-label">APY Moyen Global</div>
                        <div className="stat-value">{stats.averageApy}%</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
                    <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Contrats Smart-Coffre Actifs</h2>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th>Référence</th>
                            <th>Investisseur</th>
                            <th>Capital Locked</th>
                            <th>Rendement (APY)</th>
                            <th>Date de Maturité</th>
                            <th style={{ textAlign: 'right' }}>Statut</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vaults.map(v => (
                            <tr key={v.id}>
                                <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{v.id}</td>
                                <td style={{ fontWeight: 700 }}>{v.user.name}</td>
                                <td style={{ fontWeight: 800, color: 'var(--success)' }}>{fmt(v.amount)} FCFA</td>
                                <td>
                                    <span className="status-pill" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                                        {v.apy * 100}%
                                    </span>
                                </td>
                                <td>{new Date(v.lockedUntil).toLocaleDateString('fr-GA')}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <span className={`status-pill ${v.status === 'ACTIVE' ? 'success' : 'neutral'}`}>
                                        {v.status === 'ACTIVE' && <CheckCircle size={14} style={{ marginRight: 4 }} />}
                                        {v.status}
                                    </span>
                                </td>
                            </tr>
                        ))}
                        {vaults.length === 0 && !loading && (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                                    <ShieldAlert size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                                    Aucun contrat d'investissement actif.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
