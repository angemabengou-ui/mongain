import { Activity, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { API_URL } from './config';

export default function Dashboard({ token }: { token: string }) {
    const [stats, setStats] = useState<any>(null);
    const [chartData, setChartData] = useState<any[]>([]);
    const [error, setError] = useState('');

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                const resStats = await fetch(API_URL + '/api/admin/stats', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                const dataStats = await resStats.json();

                if (!resStats.ok) {
                    // Comparer le texte du message d'erreur est fragile (et cassé ici : les
                    // messages backend contiennent des caractères d'encodage corrompus, donc
                    // `.includes('Accès')` ne matchait jamais) — le code HTTP est fiable.
                    if (resStats.status === 401 || resStats.status === 403) {
                        localStorage.removeItem('admin_token');
                        window.location.reload();
                        return;
                    }
                    setError(dataStats.error || 'Erreur de chargement du tableau de bord.');
                    return;
                }
                setStats(dataStats);

                // Fetch ledger for real chart
                const resLedger = await fetch(API_URL + '/api/admin/ledger', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (resLedger.ok) {
                    const ledger = await resLedger.json();

                    // Group revenues (FEEs) by day for the last 7 days
                    const daysMap = new Map();
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date();
                        d.setDate(d.getDate() - i);
                        daysMap.set(d.toISOString().split('T')[0], 0);
                    }

                    ledger.forEach((tx: any) => {
                        if (tx.reference?.startsWith('FEE') && tx.status === 'COMPLETED') {
                            const dateStr = new Date(tx.createdAt).toISOString().split('T')[0];
                            if (daysMap.has(dateStr)) {
                                daysMap.set(dateStr, daysMap.get(dateStr) + tx.amount);
                            }
                        }
                    });

                    const realChart = Array.from(daysMap.entries()).map(([date, amount]) => {
                        const d = new Date(date);
                        const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
                        return { name: dayName.charAt(0).toUpperCase() + dayName.slice(1), revenus: amount };
                    });

                    setChartData(realChart);
                }
            } catch (err) {
                console.error(err);
                setError('Impossible de contacter le serveur.');
            }
        };

        fetchDashboardData();
    }, [token]);

    if (error) return <div className="loading-spinner" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>;
    if (!stats) return <div className="loading-spinner">Connexion au serveur...</div>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div>
                <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Tableau de Bord</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Vue d'ensemble en temps réel de la plateforme Mongain.</p>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon revenue">
                        <Wallet size={24} />
                    </div>
                    <div className="stat-value">{(stats.revenue || 0).toLocaleString('fr-FR')} FCFA</div>
                    <div className="stat-label">Chiffre d'Affaires Brut (Taxes 1%)</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon volume">
                        <Activity size={24} />
                    </div>
                    <div className="stat-value">{(stats.totalVolume || 0).toLocaleString('fr-FR')} FCFA</div>
                    <div className="stat-label">Volume de P2P Transféré (Global)</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon users">
                        <Users size={24} />
                    </div>
                    <div className="stat-value" style={{ fontSize: '18px' }}>
                        {stats.totalUsers || 0} <span style={{ fontSize: '11px', color: 'gray', marginRight: '8px' }}>Clients</span>
                        {stats.agentsCount || 0} <span style={{ fontSize: '11px', color: 'gray', marginRight: '8px' }}>Agts</span>
                        {stats.merchantsCount || 0} <span style={{ fontSize: '11px', color: 'gray' }}>Mchs</span>
                    </div>
                    <div className="stat-label">Réseau Dynamique</div>
                </div>
            </div>

            {/* Zone Graphique Analytique */}
            <div className="stat-card" style={{ padding: '32px', marginTop: '16px' }}>
                <h3 style={{ marginBottom: '24px', fontSize: '18px', fontWeight: '600' }}>Évolution des Revenus (7 derniers jours)</h3>
                <div style={{ width: '100%', height: 350 }}>
                    <ResponsiveContainer>
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorRevenus" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
                            <Tooltip
                                contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: 'var(--shadow-md)' }}
                                itemStyle={{ color: 'var(--text-primary)', fontWeight: 'bold' }}
                            />
                            <Area type="monotone" dataKey="revenus" stroke="var(--accent)" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenus)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
