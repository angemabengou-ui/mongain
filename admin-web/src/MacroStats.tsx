import { ArrowDownRight, ArrowUpRight, Banknote, DollarSign, PieChart as PieIcon, TrendingUp, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
    Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';

const COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';

export default function MacroStats({ token }: { token: string }) {
    const [stats, setStats] = useState<any>(null);
    const [ledger, setLedger] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const [resStats, resLedger] = await Promise.all([
                    fetch(API_URL + '/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }),
                    fetch(API_URL + '/api/admin/ledger', { headers: { Authorization: `Bearer ${token}` } })
                ]);
                if (resStats.ok) setStats(await resStats.json());
                if (resLedger.ok) setLedger(await resLedger.json());
            } catch (e) { console.error(e); }
            setLoading(false);
        };
        load();
    }, [token]);

    if (loading) return <div className="loading-spinner">Chargement de l'Analytique Globale...</div>;
    if (!stats) return <div className="loading-spinner">Erreur de connexion au serveur.</div>;

    // ── Derived Analytics ──────────────────────────────────────
    const completedTx = ledger.filter((t: any) => t.status === 'COMPLETED');
    const failedTx = ledger.filter((t: any) => t.status === 'FAILED');
    const pendingTx = ledger.filter((t: any) => t.status === 'PENDING');

    // Transaction types breakdown
    const typeMap = new Map<string, number>();
    completedTx.forEach((t: any) => {
        const type = t.type || 'UNKNOWN';
        typeMap.set(type, (typeMap.get(type) || 0) + 1);
    });
    const pieData = Array.from(typeMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    // Volume by type
    const volumeMap = new Map<string, number>();
    completedTx.forEach((t: any) => {
        const type = t.type || 'UNKNOWN';
        volumeMap.set(type, (volumeMap.get(type) || 0) + (t.amount || 0));
    });
    const barData = Array.from(volumeMap.entries())
        .map(([name, volume]) => ({ name: name.replace('_', ' '), volume }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 8);

    // Revenue by day (last 14 days)
    const daysMap = new Map<string, { revenue: number, volume: number, count: number }>();
    for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        daysMap.set(d.toISOString().split('T')[0], { revenue: 0, volume: 0, count: 0 });
    }
    completedTx.forEach((t: any) => {
        const dateStr = new Date(t.createdAt).toISOString().split('T')[0];
        if (daysMap.has(dateStr)) {
            const entry = daysMap.get(dateStr)!;
            entry.volume += t.amount || 0;
            entry.count += 1;
            if (t.reference?.startsWith('FEE')) entry.revenue += t.amount || 0;
        }
    });
    const trendData = Array.from(daysMap.entries()).map(([date, d]) => ({
        name: new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        revenus: d.revenue,
        volume: d.volume,
        opérations: d.count
    }));

    // Today vs Yesterday
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const todayData = daysMap.get(today) || { revenue: 0, volume: 0, count: 0 };
    const yesterdayData = daysMap.get(yesterday) || { revenue: 0, volume: 0, count: 0 };
    const revDelta = yesterdayData.revenue > 0 ? ((todayData.revenue - yesterdayData.revenue) / yesterdayData.revenue * 100) : 0;
    const volDelta = yesterdayData.volume > 0 ? ((todayData.volume - yesterdayData.volume) / yesterdayData.volume * 100) : 0;

    // Status breakdown for donut
    const statusData = [
        { name: 'Complétées', value: completedTx.length, color: 'var(--success)' },
        { name: 'En attente', value: pendingTx.length, color: 'var(--warning)' },
        { name: 'Échouées', value: failedTx.length, color: 'var(--danger)' }
    ].filter(s => s.value > 0);

    const totalTx = ledger.length;
    const successRate = totalTx > 0 ? (completedTx.length / totalTx * 100).toFixed(1) : '0';

    const cardStyle: React.CSSProperties = {
        background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 32,
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)'
    };
    const miniLabel: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 };
    const bigNumber: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--text-primary)', marginTop: 8 };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <PageHeader title="Analytique Globale" subtitle="Vue macro consolidée — Transactions, Revenus, Réseau & Tendances" />

            {/* ── ROW 1: 6 KPI Cards ─────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {/* Revenue */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Chiffre d'Affaires (Commissions)</div>
                            <div style={bigNumber}>{fmt(stats.revenue || 0)}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: 'var(--success-bg)' }}>
                            <DollarSign size={22} color="var(--success)" />
                        </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {revDelta >= 0
                            ? <><ArrowUpRight size={14} color="var(--success)" /><span style={{ color: 'var(--success)', fontWeight: 700 }}>+{revDelta.toFixed(1)}%</span></>
                            : <><ArrowDownRight size={14} color="var(--danger)" /><span style={{ color: 'var(--danger)', fontWeight: 700 }}>{revDelta.toFixed(1)}%</span></>
                        }
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>vs hier</span>
                    </div>
                </div>

                {/* Volume */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Volume Total Transigé</div>
                            <div style={bigNumber}>{fmt(stats.totalVolume || 0)}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: 'var(--accent-bg)' }}>
                            <TrendingUp size={22} color="var(--accent)" />
                        </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {volDelta >= 0
                            ? <><ArrowUpRight size={14} color="var(--success)" /><span style={{ color: 'var(--success)', fontWeight: 700 }}>+{volDelta.toFixed(1)}%</span></>
                            : <><ArrowDownRight size={14} color="var(--danger)" /><span style={{ color: 'var(--danger)', fontWeight: 700 }}>{volDelta.toFixed(1)}%</span></>
                        }
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>vs hier</span>
                    </div>
                </div>

                {/* Taux de succès */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Taux de Succès</div>
                            <div style={bigNumber}>{successRate}%</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: 'var(--warning-bg)' }}>
                            <PieIcon size={22} color="var(--warning)" />
                        </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                        {completedTx.length} / {totalTx} opérations réussies
                    </div>
                </div>

                {/* Clients */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Clients Inscrits</div>
                            <div style={bigNumber}>{(stats.totalUsers || 0).toLocaleString('fr-FR')}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: 'color-mix(in srgb, #8b5cf6 15%, transparent)' }}>
                            <Users size={22} color="#8b5cf6" />
                        </div>
                    </div>
                </div>

                {/* Agents */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Agents Actifs</div>
                            <div style={bigNumber}>{stats.agentsCount || 0}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: 'var(--success-bg)' }}>
                            <Wallet size={22} color="#16a34a" />
                        </div>
                    </div>
                </div>

                {/* Marchands */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div style={miniLabel}>Marchands</div>
                            <div style={bigNumber}>{stats.merchantsCount || 0}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 12, background: '#fce7f3' }}>
                            <Banknote size={22} color="#ec4899" />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── ROW 2: Revenue Trend + Transaction Status ────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                {/* Revenue Trend (14 days) */}
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📈 Tendance des Revenus & Volume (14 jours)</h3>
                    <div style={{ width: '100%', height: 320 }}>
                        <ResponsiveContainer>
                            <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gVolume" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2} />
                                        <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                                <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-md)' }} />
                                <Legend />
                                <Area type="monotone" dataKey="revenus" name="Commissions" stroke="var(--accent)" strokeWidth={2.5} fillOpacity={1} fill="url(#gRevenue)" />
                                <Area type="monotone" dataKey="volume" name="Volume" stroke="var(--success)" strokeWidth={2} fillOpacity={1} fill="url(#gVolume)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Status Donut */}
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🔄 Statut des Opérations</h3>
                    <div style={{ width: '100%', height: 220, display: 'flex', justifyContent: 'center' }}>
                        <ResponsiveContainer>
                            <PieChart>
                                <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={4} dataKey="value">
                                    {statusData.map((entry, i) => (
                                        <Cell key={i} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {statusData.map(s => (
                            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{s.name}</span>
                                <span style={{ fontWeight: 700 }}>{s.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── ROW 3: Tx Type Pie + Volume Bar ────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Pie: Tx by type */}
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>🧩 Répartition par Type de Transaction</h3>
                    <div style={{ width: '100%', height: 300, display: 'flex', justifyContent: 'center' }}>
                        <ResponsiveContainer>
                            <PieChart>
                                <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`} labelLine={false}>
                                    {pieData.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip contentStyle={{ borderRadius: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Bar: Volume by type */}
                <div style={cardStyle}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>💰 Volume par Catégorie (Top 8)</h3>
                    <div style={{ width: '100%', height: 300 }}>
                        <ResponsiveContainer>
                            <BarChart data={barData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" />
                                <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)} />
                                <Tooltip contentStyle={{ borderRadius: 12, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }} formatter={(v: any) => fmt(v)} />
                                <Bar dataKey="volume" name="Volume FCFA" radius={[6, 6, 0, 0]}>
                                    {barData.map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* ── ROW 4: Ops count trend ─────────────────────────── */}
            <div style={cardStyle}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>📊 Nombre d'Opérations par Jour (14 jours)</h3>
                <div style={{ width: '100%', height: 250 }}>
                    <ResponsiveContainer>
                        <BarChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                            <XAxis dataKey="name" stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <YAxis stroke="var(--text-secondary)" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ borderRadius: 12, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }} />
                            <Bar dataKey="opérations" name="Opérations" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
