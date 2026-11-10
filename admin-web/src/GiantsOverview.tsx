import { useEffect, useMemo, useState } from 'react';
import { API_URL } from './config';

// Dashboard Président : recettes (argent qui entre) de tous les grands commerçants.
// Données : backend/src/routes/admin.giants.ts — volontairement sans sorties, frais, soldes ni
// détails techniques de transaction.

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Totals {
    giantCount: number;
    affiliateCount: number;
    lateCount: number;
    totalIn: number;
    inCount: number;
    taxIn: number;
    taxCount: number;
    otherIn: number;
}

interface GiantRow {
    id: string;
    name: string;
    phone: string;
    affiliateCount: number;
    lateCount: number;
    totalIn: number;
    inCount: number;
    taxIn: number;
    taxCount: number;
    otherIn: number;
}

interface Affiliate {
    affiliationId: string;
    name: string;
    phone: string;
    expectedFrequency: 'MONTHLY' | 'WEEKLY' | null;
    expectedAmount: number | null;
    taxPaid: number;
    lastPaymentAt: string | null;
    compliance: 'OK' | 'LATE' | null;
}

interface Unpaid {
    affiliationId: string;
    name: string;
    phone: string;
    expectedFrequency: 'MONTHLY' | 'WEEKLY' | null;
    expectedAmount: number | null;
    lastPaymentAt: string | null;
    giant: { id: string; name: string };
}

interface Payment {
    id: string;
    date: string;
    amount: number;
    isTax: boolean;
    payer: { name: string; phone: string } | null;
}

interface GiantDetail {
    giant: GiantRow & { affiliates: Affiliate[] };
    payments: Payment[];
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

const FREQ_LABEL: Record<string, string> = { MONTHLY: 'par mois', WEEKLY: 'par semaine' };
const longDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
const lastPaid = (iso: string | null) => iso ? longDate(iso) : 'Jamais payé';
const expected = (amount: number | null, freq: string | null) => amount ? `${fmt(amount)} ${freq ? FREQ_LABEL[freq] : ''}` : '—';

function ReadOnlyBadge() {
    return (
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Consultation seule
        </span>
    );
}

const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 };
const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '12px', whiteSpace: 'nowrap' };
const num: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const btn: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' };

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div style={{ ...card, padding: '18px 22px', flex: '1 1 200px', minWidth: 190 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: color || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            {sub && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{sub}</div>}
        </div>
    );
}

function PaidBadge({ value }: { value: Affiliate['compliance'] }) {
    if (value === null) return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
    const ok = value === 'OK';
    return (
        <span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: ok ? 'var(--success-bg)' : 'var(--danger-bg)', color: ok ? 'var(--success)' : 'var(--danger)' }}>
            {ok ? 'A payé' : 'Pas encore payé'}
        </span>
    );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function GiantsOverview({ token }: { token: string | null; hasPerm?: (p?: string[]) => boolean }) {
    const [from, setFrom] = useState(PRESETS[0].from());
    const [to, setTo] = useState(today());
    const [totals, setTotals] = useState<Totals | null>(null);
    const [giants, setGiants] = useState<GiantRow[]>([]);
    const [unpaid, setUnpaid] = useState<Unpaid[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<GiantDetail | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

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
                setUnpaid(d.unpaid || []);
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
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={btn} aria-label="Du" />
            <span style={{ color: 'var(--text-secondary)' }}>au</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={btn} aria-label="Au" />
        </div>
    );

    // ── RECETTES D'UN GRAND COMMERÇANT ───────────────────────────────────────
    if (selectedId) {
        const g = detail?.giant;
        return (
            <div style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                    <button style={btn} onClick={() => setSelectedId(null)}>← Tous les grands commerçants</button>
                    {periodBar}
                </div>
                {error && <div style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}
                {loadingDetail && !g ? <div style={{ color: 'var(--text-secondary)' }}>Chargement…</div> : g && (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 20px' }}>
                            <h2 style={{ margin: 0 }}>{g.name}</h2>
                            <span style={{ color: 'var(--text-secondary)' }}>{g.phone}</span>
                            <ReadOnlyBadge />
                        </div>

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
                            <StatCard label="Recettes de la période" value={fmt(g.totalIn)} sub={`${g.inCount} paiement(s) reçu(s)`} color="var(--success)" />
                            <StatCard label="Dont taxes des affiliés" value={fmt(g.taxIn)} sub={`${g.taxCount} versement(s)`} />
                            <StatCard label="Autres encaissements" value={fmt(g.otherIn)} />
                        </div>

                        <div style={{ ...card, marginBottom: 24 }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                                Marchands affiliés ({g.affiliates.length}){g.lateCount > 0 && <span style={{ color: 'var(--danger)', fontWeight: 500 }}> — {g.lateCount} n'ont pas encore payé</span>}
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                        <th style={th}>Marchand</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Versé sur la période</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Montant attendu</th>
                                        <th style={th}>Dernier paiement</th>
                                        <th style={th}>Ce mois / cette semaine</th>
                                    </tr></thead>
                                    <tbody>
                                        {g.affiliates.length === 0 ? (
                                            <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun marchand affilié</td></tr>
                                        ) : [...g.affiliates].sort((x, y) => Number(y.compliance === 'LATE') - Number(x.compliance === 'LATE')).map(a => (
                                            <tr key={a.affiliationId} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={td}><div style={{ fontWeight: 600 }}>{a.name}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{a.phone}</div></td>
                                                <td style={{ ...num, fontWeight: 600 }}>{fmt(a.taxPaid)}</td>
                                                <td style={num}>{expected(a.expectedAmount, a.expectedFrequency)}</td>
                                                <td style={td}>{lastPaid(a.lastPaymentAt)}</td>
                                                <td style={td}><PaidBadge value={a.compliance} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={card}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                                Paiements reçus ({detail!.payments.length}{detail!.truncated ? ' plus récents' : ''})
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                                        <th style={th}>Date</th><th style={th}>Payé par</th><th style={th}>Nature</th><th style={{ ...th, textAlign: 'right' }}>Montant</th>
                                    </tr></thead>
                                    <tbody>
                                        {detail!.payments.length === 0 ? (
                                            <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun paiement reçu sur la période</td></tr>
                                        ) : detail!.payments.map(p => (
                                            <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                                                <td style={td}>{longDate(p.date)}</td>
                                                <td style={td}>{p.payer ? `${p.payer.name} · ${p.payer.phone}` : '—'}</td>
                                                <td style={td}>{p.isTax ? 'Taxe d\'un affilié' : 'Encaissement'}</td>
                                                <td style={{ ...num, fontWeight: 600, color: 'var(--success)' }}>{fmt(p.amount)}</td>
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

    // ── RECETTES DE TOUS LES GRANDS COMMERÇANTS ──────────────────────────────
    return (
        <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                <div>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>Recettes des grands commerçants <ReadOnlyBadge /></h2>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>L'argent encaissé par chaque grand commerçant sur la période choisie.</div>
                </div>
                {periodBar}
            </div>
            {error && <div style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</div>}

            {totals && (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 24, opacity: loading ? 0.5 : 1 }}>
                    <StatCard label="Recettes totales" value={fmt(totals.totalIn)} sub={`${totals.inCount} paiement(s) reçu(s)`} color="var(--success)" />
                    <StatCard label="Dont taxes des affiliés" value={fmt(totals.taxIn)} sub={`${totals.taxCount} versement(s)`} />
                    <StatCard label="Autres encaissements" value={fmt(totals.otherIn)} />
                    <StatCard label="Affiliés pas encore payés" value={`${totals.lateCount} / ${totals.affiliateCount}`}
                        sub={`${totals.giantCount} grand(s) commerçant(s)`} color={totals.lateCount > 0 ? 'var(--danger)' : undefined} />
                </div>
            )}

            <div style={{ ...card, marginBottom: 24, borderColor: unpaid.length > 0 ? 'var(--danger)' : 'var(--border)' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, color: unpaid.length > 0 ? 'var(--danger)' : undefined }}>Commerçants qui n'ont pas payé ({unpaid.length})</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Affiliés qui n'ont rien versé sur leur mois ou leur semaine en cours.</div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={th}>Commerçant</th>
                            <th style={th}>Doit payer à</th>
                            <th style={{ ...th, textAlign: 'right' }}>Montant attendu</th>
                            <th style={th}>Dernier paiement</th>
                        </tr></thead>
                        <tbody>
                            {unpaid.length === 0 ? (
                                <tr><td colSpan={4} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>{loading ? 'Chargement…' : 'Tous les commerçants affiliés sont à jour'}</td></tr>
                            ) : unpaid.map(u => (
                                <tr key={u.affiliationId} onClick={() => setSelectedId(u.giant.id)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                                    <td style={td}><div style={{ fontWeight: 600 }}>{u.name}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.phone}</div></td>
                                    <td style={td}>{u.giant.name}</td>
                                    <td style={num}>{expected(u.expectedAmount, u.expectedFrequency)}</td>
                                    <td style={{ ...td, color: u.lastPaymentAt ? undefined : 'var(--danger)' }}>{lastPaid(u.lastPaymentAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div style={card}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, marginRight: 'auto' }}>Grands commerçants ({visibleGiants.length})</span>
                    <input placeholder="Rechercher un nom ou un numéro" value={search} onChange={e => setSearch(e.target.value)} style={{ ...btn, minWidth: 240, cursor: 'text' }} />
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={th}>Grand commerçant</th>
                            <th style={{ ...th, textAlign: 'right' }}>Recettes</th>
                            <th style={{ ...th, textAlign: 'right' }}>Dont taxes</th>
                            <th style={{ ...th, textAlign: 'right' }}>Autres encaissements</th>
                            <th style={{ ...th, textAlign: 'right' }}>Affiliés</th>
                            <th style={th}></th>
                        </tr></thead>
                        <tbody>
                            {loading && giants.length === 0 ? (
                                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement…</td></tr>
                            ) : visibleGiants.length === 0 ? (
                                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun grand commerçant</td></tr>
                            ) : visibleGiants.map(g => (
                                <tr key={g.id} onClick={() => setSelectedId(g.id)} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                                    <td style={td}><div style={{ fontWeight: 600 }}>{g.name}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{g.phone}</div></td>
                                    <td style={{ ...num, fontWeight: 700, color: 'var(--success)' }}>{fmt(g.totalIn)}</td>
                                    <td style={num}>{fmt(g.taxIn)}</td>
                                    <td style={num}>{fmt(g.otherIn)}</td>
                                    <td style={num}>{g.affiliateCount}{g.lateCount > 0 && <span style={{ color: 'var(--danger)' }}> ({g.lateCount} pas payé)</span>}</td>
                                    <td style={{ ...td, textAlign: 'right' }}><button style={{ ...btn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>Consulter →</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
