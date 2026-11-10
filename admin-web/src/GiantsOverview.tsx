import { useEffect, useMemo, useState } from 'react';
import { API_URL } from './config';

// Supervision Président : entrées / sorties / taxes de tous les grands commerçants.
// Données : backend/src/routes/admin.giants.ts (GET /api/admin/giants/overview et /:id).

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Totals {
    giantCount: number;
    affiliateCount: number;
    taxIn: number;
    taxCount: number;
    otherIn: number;
    totalIn: number;
    totalOut: number;
    feesOut: number;
    net: number;
    balance: number;
    lateCount: number;
    complianceRate: number | null;
}

interface GiantRow {
    id: string;
    name: string;
    phone: string;
    accountStatus: string;
    balance: number;
    affiliateCount: number;
    lateCount: number;
    taxIn: number;
    taxCount: number;
    otherIn: number;
    totalIn: number;
    inCount: number;
    totalOut: number;
    feesOut: number;
    outCount: number;
    net: number;
}

interface Affiliate {
    affiliationId: string;
    name: string;
    phone: string;
    accountStatus: string;
    expectedFrequency: 'MONTHLY' | 'WEEKLY' | null;
    expectedAmount: number | null;
    autoPayEnabled: boolean;
    taxPaid: number;
    taxCount: number;
    compliance: 'OK' | 'LATE' | null;
}

interface Movement {
    id: string;
    date: string;
    direction: 'IN' | 'OUT';
    category: 'TAX' | 'IN' | 'OUT';
    type: string;
    amount: number;
    fee: number;
    reference: string;
    counterparty: { name: string; phone: string } | null;
}

interface GiantDetail {
    giant: GiantRow & { affiliates: Affiliate[] };
    movements: Movement[];
    truncated: boolean;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const dayStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => dayStr(new Date());

const PRESETS: Array<{ label: string; from: () => string }> = [
    { label: 'Ce mois', from: () => { const d = new Date(); return dayStr(new Date(d.getFullYear(), d.getMonth(), 1)); } },
    { label: '7 jours', from: () => dayStr(new Date(Date.now() - 6 * 86400000)) },
    { label: '30 jours', from: () => dayStr(new Date(Date.now() - 29 * 86400000)) },
    { label: 'Cette année', from: () => dayStr(new Date(new Date().getFullYear(), 0, 1)) },
];

const CATEGORY_LABEL: Record<Movement['category'], string> = { TAX: 'Taxe', IN: 'Entrée', OUT: 'Sortie' };
const FREQ_LABEL: Record<string, string> = { MONTHLY: 'Mensuelle', WEEKLY: 'Hebdomadaire' };

function downloadCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(esc).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 };
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const btn: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' };

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ ...card, padding: '18px 22px', flex: '1 1 180px', minWidth: 170 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

function ComplianceBadge({ value }: { value: Affiliate['compliance'] }) {
    if (value === null) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
    const ok = value === 'OK';
    return (
        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: ok ? 'var(--success-bg)' : 'var(--danger-bg)', color: ok ? 'var(--success)' : 'var(--danger)' }}>
            {ok ? 'À jour' : 'En retard'}
        </span>
    );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function GiantsOverview({ token, hasPerm }: { token: string | null; hasPerm: (p?: string[]) => boolean }) {
    const [from, setFrom] = useState(PRESETS[0].from());
    const [to, setTo] = useState(today());
    const [totals, setTotals] = useState<Totals | null>(null);
    const [giants, setGiants] = useState<GiantRow[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<GiantDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [mvFilter, setMvFilter] = useState<'ALL' | Movement['category']>('ALL');

    const canViewDetail = hasPerm(['perm_merchant_view']);
    const query = `from=${from}&to=${to}`;

    useEffect(() => {
        if (!from || !to) return;
        setLoading(true);
        setError(null);
        fetch(`${API_URL}/api/admin/giants/overview?${query}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(async r => {
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Erreur de chargement.');
                setTotals(d.totals);
                setGiants(d.giants);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [token, query]);

    useEffect(() => {
        if (!selectedId) { setDetail(null); return; }
        setLoadingDetail(true);
        setError(null);
        fetch(`${API_URL}/api/admin/giants/${selectedId}?${query}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(async r => {
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Erreur de chargement.');
                setDetail(d);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoadingDetail(false));
    }, [token, selectedId, query]);

    const visibleGiants = useMemo(() => {
        const q = search.trim().toLowerCase();
        return giants
            .filter(g => !q || g.name.toLowerCase().includes(q) || g.phone.includes(q))
            .sort((a, b) => b.totalIn - a.totalIn);
    }, [giants, search]);

    const periodBar = (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
                <button key={p.label} style={{ ...btn, ...(from === p.from() && to === today() ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
                    onClick={() => { setFrom(p.from()); setTo(today()); }}>
                    {p.label}
                </button>
            ))}
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={btn} />
            <span style={{ color: 'var(--text-secondary)' }}>→</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={btn} />
        </div>
    );

    // ── VUE DÉTAIL D'UN GRAND COMMERÇANT ─────────────────────────────────────
    if (selectedId) {
        const g = detail?.giant;
        const movements = (detail?.movements || []).filter(m => mvFilter === 'ALL' || m.category === mvFilter);
        return (
            <div style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                    <button style={btn} onClick={() => { setSelectedId(null); setMvFilter('ALL'); }}>← Tous les grands commerçants</button>
                    {periodBar}
                </div>
                {error && <div style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}
                {loadingDetail && !g ? <div style={{ color: 'var(--text-secondary)' }}>Chargement…</div> : g && (
                    <>
                        <div style={{ marginBottom: 20 }}>
                            <h2 style={{ margin: 0 }}>{g.name}</h2>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{g.phone} · Grand commerçant · {g.accountStatus}</div>
                        </div>

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                            <StatCard label="Taxes perçues" value={fmt(g.taxIn)} sub={`${g.taxCount} paiement(s)`} color="var(--success)" />
                            <StatCard label="Autres entrées" value={fmt(g.otherIn)} />
                            <StatCard label="Sorties" value={fmt(g.totalOut)} sub={`${g.outCount} opération(s) · frais ${fmt(g.feesOut)}`} color="var(--danger)" />
                            <StatCard label="Solde net période" value={fmt(g.net)} color={g.net >= 0 ? 'var(--success)' : 'var(--danger)'} />
                            <StatCard label="Solde wallet actuel" value={fmt(g.balance)} />
                        </div>

                        <div style={{ ...card, marginBottom: 24 }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                                Affiliés ({g.affiliates.length}) — {g.lateCount} en retard sur leur période en cours
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                        <th style={th}>Marchand</th><th style={th}>Téléphone</th><th style={{ ...th, textAlign: 'right' }}>Taxe payée (période)</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Montant attendu</th><th style={th}>Fréquence</th><th style={th}>Prélèvement auto</th><th style={th}>Conformité</th>
                                    </tr></thead>
                                    <tbody>
                                        {g.affiliates.length === 0 ? (
                                            <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun affilié actif</td></tr>
                                        ) : g.affiliates.map(a => (
                                            <tr key={a.affiliationId} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={{ ...td, fontWeight: 600 }}>{a.name}</td>
                                                <td style={{ ...td, color: 'var(--text-secondary)' }}>{a.phone}</td>
                                                <td style={num}>{fmt(a.taxPaid)}</td>
                                                <td style={num}>{a.expectedAmount ? fmt(a.expectedAmount) : '—'}</td>
                                                <td style={td}>{a.expectedFrequency ? FREQ_LABEL[a.expectedFrequency] : '—'}</td>
                                                <td style={td}>{a.autoPayEnabled ? 'Oui' : 'Non'}</td>
                                                <td style={td}><ComplianceBadge value={a.compliance} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={card}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, marginRight: 'auto' }}>Mouvements du wallet ({detail!.movements.length}{detail!.truncated ? '+, liste tronquée' : ''})</span>
                                {(['ALL', 'TAX', 'IN', 'OUT'] as const).map(f => (
                                    <button key={f} style={{ ...btn, ...(mvFilter === f ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }} onClick={() => setMvFilter(f)}>
                                        {f === 'ALL' ? 'Tout' : f === 'TAX' ? 'Taxes' : f === 'IN' ? 'Autres entrées' : 'Sorties'}
                                    </button>
                                ))}
                                <button style={btn} onClick={() => downloadCsv(`mouvements_${g.name}_${from}_${to}.csv`,
                                    ['Date', 'Catégorie', 'Type', 'Contrepartie', 'Téléphone', 'Montant', 'Frais', 'Référence'],
                                    movements.map(m => [new Date(m.date).toLocaleString('fr-FR'), CATEGORY_LABEL[m.category], m.type, m.counterparty?.name || '', m.counterparty?.phone || '', m.direction === 'IN' ? m.amount : -m.amount, m.fee, m.reference]))}>
                                    Export CSV
                                </button>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                        <th style={th}>Date</th><th style={th}>Catégorie</th><th style={th}>Contrepartie</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Montant</th><th style={{ ...th, textAlign: 'right' }}>Frais</th><th style={th}>Référence</th>
                                    </tr></thead>
                                    <tbody>
                                        {movements.length === 0 ? (
                                            <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun mouvement sur la période</td></tr>
                                        ) : movements.map(m => (
                                            <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={td}>{new Date(m.date).toLocaleString('fr-FR')}</td>
                                                <td style={td}>{CATEGORY_LABEL[m.category]}</td>
                                                <td style={td}>{m.counterparty ? `${m.counterparty.name} · ${m.counterparty.phone}` : '—'}</td>
                                                <td style={{ ...num, fontWeight: 600, color: m.direction === 'IN' ? 'var(--success)' : 'var(--danger)' }}>
                                                    {m.direction === 'IN' ? '+' : '−'}{fmt(m.amount)}
                                                </td>
                                                <td style={num}>{m.fee ? fmt(m.fee) : '—'}</td>
                                                <td style={{ ...td, color: 'var(--text-secondary)', fontSize: 12 }}>{m.reference}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        );
    }

    // ── VUE D'ENSEMBLE : TOUS LES GRANDS COMMERÇANTS ─────────────────────────
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: 0 }}>Supervision Président — Grands commerçants</h2>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Entrées, sorties et taxes perçues par chaque grand commerçant sur la période.</div>
                </div>
                {periodBar}
            </div>
            {error && <div style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

            {totals && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24, opacity: loading ? 0.5 : 1 }}>
                    <StatCard label="Taxes perçues" value={fmt(totals.taxIn)} sub={`${totals.taxCount} paiement(s) d'affiliés`} color="var(--success)" />
                    <StatCard label="Entrées totales" value={fmt(totals.totalIn)} sub={`dont autres entrées ${fmt(totals.otherIn)}`} />
                    <StatCard label="Sorties totales" value={fmt(totals.totalOut)} sub={`frais ${fmt(totals.feesOut)}`} color="var(--danger)" />
                    <StatCard label="Solde net période" value={fmt(totals.net)} color={totals.net >= 0 ? 'var(--success)' : 'var(--danger)'} />
                    <StatCard label="Conformité affiliés" value={totals.complianceRate === null ? '—' : `${totals.complianceRate} %`}
                        sub={`${totals.lateCount} en retard / ${totals.affiliateCount} affiliés`} color={totals.lateCount > 0 ? 'var(--warning)' : undefined} />
                    <StatCard label="Solde cumulé des wallets" value={fmt(totals.balance)} sub={`${totals.giantCount} grand(s) commerçant(s)`} />
                </div>
            )}

            <div style={card}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, marginRight: 'auto' }}>Grands commerçants ({visibleGiants.length})</span>
                    <input placeholder="Rechercher nom ou téléphone" value={search} onChange={e => setSearch(e.target.value)} style={{ ...btn, minWidth: 220, cursor: 'text' }} />
                    <button style={btn} onClick={() => downloadCsv(`grands_commercants_${from}_${to}.csv`,
                        ['Nom', 'Téléphone', 'Statut', 'Affiliés', 'En retard', 'Taxes perçues', 'Autres entrées', 'Entrées totales', 'Sorties', 'Frais', 'Net', 'Solde wallet'],
                        visibleGiants.map(g => [g.name, g.phone, g.accountStatus, g.affiliateCount, g.lateCount, g.taxIn, g.otherIn, g.totalIn, g.totalOut, g.feesOut, g.net, g.balance]))}>
                        Export CSV
                    </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={th}>Grand commerçant</th><th style={th}>Statut</th><th style={{ ...th, textAlign: 'right' }}>Affiliés</th>
                            <th style={{ ...th, textAlign: 'right' }}>Taxes perçues</th><th style={{ ...th, textAlign: 'right' }}>Autres entrées</th>
                            <th style={{ ...th, textAlign: 'right' }}>Sorties</th><th style={{ ...th, textAlign: 'right' }}>Net</th><th style={{ ...th, textAlign: 'right' }}>Solde wallet</th>
                        </tr></thead>
                        <tbody>
                            {loading && giants.length === 0 ? (
                                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement…</td></tr>
                            ) : visibleGiants.length === 0 ? (
                                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun grand commerçant</td></tr>
                            ) : visibleGiants.map(g => (
                                <tr key={g.id} onClick={canViewDetail ? () => setSelectedId(g.id) : undefined}
                                    style={{ borderTop: '1px solid var(--border)', cursor: canViewDetail ? 'pointer' : 'default' }}>
                                    <td style={td}><div style={{ fontWeight: 600 }}>{g.name}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g.phone}</div></td>
                                    <td style={td}>{g.accountStatus}</td>
                                    <td style={num}>{g.affiliateCount}{g.lateCount > 0 && <span style={{ color: 'var(--danger)' }}> ({g.lateCount} en retard)</span>}</td>
                                    <td style={{ ...num, color: 'var(--success)', fontWeight: 600 }}>{fmt(g.taxIn)}</td>
                                    <td style={num}>{fmt(g.otherIn)}</td>
                                    <td style={{ ...num, color: 'var(--danger)' }}>{fmt(g.totalOut)}</td>
                                    <td style={{ ...num, fontWeight: 600 }}>{fmt(g.net)}</td>
                                    <td style={num}>{fmt(g.balance)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
