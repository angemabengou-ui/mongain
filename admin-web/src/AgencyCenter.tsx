import {
    Activity, AlertTriangle, ArrowDownCircle, ArrowUpCircle,
    BarChart3, Bell, BookOpen, Building2, CheckCircle,
    ChevronLeft, ChevronRight,
    Eye, Filter,
    MapPin,
    Plus, RefreshCw, Search, Shield,
    User, Users, Wallet
} from 'lucide-react';
import { useEffect, useState } from 'react';
import KpiCard from './components/KpiCard';
import PageHeader from './components/PageHeader';
import TabBar from './components/TabBar';
import { API_URL } from './config';

type AgencyTab360 = 'overview' | 'staff' | 'tellers' | 'vault' | 'cashops' | 'reconciliation' | 'alerts';

const fmt = (n: number) => n.toLocaleString('fr-GA') + ' FCFA';
const fmtDate = (d: string) => new Date(d).toLocaleString('fr-GA', { dateStyle: 'short', timeStyle: 'short' });

// ============================================================
// 1. STATUS BADGE
// ============================================================
function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        ACTIVE: { bg: 'var(--success-bg)', color: 'var(--success)', label: 'Active' },
        SUSPENDED: { bg: 'var(--danger-bg)', color: 'var(--danger)', label: 'Suspendue' },
        DRAFT: { bg: 'var(--warning-bg)', color: 'var(--warning)', label: 'Brouillon' },
        CONFIGURED: { bg: 'var(--accent-bg)', color: 'var(--accent)', label: 'Configurée' },
        CLOSED: { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: 'Fermée' },
        INACTIVE: { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: 'Inactive' },
    };
    const s = map[status] || { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: status };
    return <span style={{ padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.color, fontSize: 12, fontWeight: 700 }}>{s.label}</span>;
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function AgencyCenter({ token, hasPerm }: { token: string; hasPerm: (perms: string[]) => boolean }) {
    const [branches, setBranches] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Filters
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterCity, setFilterCity] = useState('');

    // Selected agency for 360 view
    const [selected, setSelected] = useState<any>(null);
    const [tab360, setTab360] = useState<AgencyTab360>('overview');

    // Agency 360 data
    const [overview, setOverview] = useState<any>(null);
    const [staffList, setStaffList] = useState<any[]>([]);
    const [tellers, setTellers] = useState<any[]>([]);
    const [vault, setVault] = useState<any>(null);
    const [cashOps, setCashOps] = useState<any[]>([]);
    const [cashOpsTotal, setCashOpsTotal] = useState(0);
    const [reconciliation, setReconciliation] = useState<any>(null);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [unassigned, setUnassigned] = useState<any[]>([]);

    // Create modal
    const [showCreate, setShowCreate] = useState(false);
    const [createForm, setCreateForm] = useState({ name: '', code: '', city: '', region: '', address: '', phone: '', status: 'DRAFT', isHQ: false });
    const [creating, setCreating] = useState(false);

    // Cash ops filters
    const [opType, setOpType] = useState('');
    const [opDateFrom, setOpDateFrom] = useState('');
    const [opDateTo, setOpDateTo] = useState('');
    const [opSearch, setOpSearch] = useState('');
    const [opPage, setOpPage] = useState(1);

    const isAdmin = hasPerm(['perm_branch_manage']);

    // ─── Fetch agency list ────────────────────────────────────
    const fetchBranches = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: '20' });
            if (search) params.set('search', search);
            if (filterStatus) params.set('status', filterStatus);
            if (filterCity) params.set('city', filterCity);
            const resp = await fetch(`${API_URL}/api/admin/branches?${params}`, { headers: { Authorization: `Bearer ${token}` } });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            // API returns paginated {branches, total} OR flat array for BM
            if (Array.isArray(data)) { setBranches(data); setTotal(data.length); }
            else { setBranches(data.branches || []); setTotal(data.total || 0); }
            // Sans ce reset, une erreur affichée une fois (ex: réseau) restait affichée
            // indéfiniment après un rechargement réussi ou un changement d'onglet/filtre.
            setError('');
        } catch (e: any) { setError(e.message); } finally { setLoading(false); }
    };

    useEffect(() => { fetchBranches(); }, [page, filterStatus, filterCity, search]);

    // ─── Open Agency 360 ─────────────────────────────────────
    const open360 = async (b: any) => {
        setSelected(b);
        setTab360('overview');
        // Sans ce reset, les données de l'agence précédente restent affichées sous le nom de
        // la nouvelle jusqu'à ce que son propre fetch aboutisse (le useEffect [tab360, selected,
        // ...] ne charge QUE l'onglet actif — les 6 autres restent avec leurs anciennes valeurs
        // si on y navigue ensuite sans repasser par "overview").
        setOverview(null);
        setStaffList([]);
        setTellers([]);
        setVault(null);
        setCashOps([]);
        setReconciliation(null);
        setAlerts([]);
        setUnassigned([]);
        setOpPage(1);
        loadOverview(b.id);
    };

    const loadOverview = async (id: string) => {
        const r = await fetch(`${API_URL}/api/admin/branches/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setOverview(await r.json());
    };

    const loadStaff = async (id: string) => {
        const [sr, ur] = await Promise.all([
            fetch(`${API_URL}/api/admin/branches/${id}/staff`, { headers: { Authorization: `Bearer ${token}` } }),
            isAdmin ? fetch(`${API_URL}/api/admin/staff/unassigned`, { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null)
        ]);
        if (sr.ok) setStaffList(await sr.json());
        if (ur && ur.ok) setUnassigned(await ur.json());
    };

    const loadTellers = async (id: string) => {
        const r = await fetch(`${API_URL}/api/admin/branches/${id}/tellers`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setTellers(await r.json());
    };

    const loadVault = async (id: string) => {
        const r = await fetch(`${API_URL}/api/admin/branches/${id}/vault`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setVault(await r.json());
    };

    const loadCashOps = async (id: string) => {
        const params = new URLSearchParams({ page: String(opPage), limit: '20' });
        if (opType) params.set('type', opType);
        if (opDateFrom) params.set('dateFrom', opDateFrom);
        if (opDateTo) params.set('dateTo', opDateTo);
        if (opSearch) params.set('search', opSearch);
        const r = await fetch(`${API_URL}/api/admin/branches/${id}/cash-operations?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) { const d = await r.json(); setCashOps(d.operations || []); setCashOpsTotal(d.total || 0); }
    };

    const loadReconciliation = async (id: string) => {
        const r = await fetch(`${API_URL}/api/admin/branches/${id}/reconciliation`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) setReconciliation(await r.json());
    };

    const loadAlerts = async (id: string) => {
        const r = await fetch(`${API_URL}/api/admin/branches/${id}/alerts`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) { const d = await r.json(); setAlerts(d.alerts || []); }
    };

    useEffect(() => {
        if (!selected) return;
        if (tab360 === 'overview') loadOverview(selected.id);
        if (tab360 === 'staff') loadStaff(selected.id);
        if (tab360 === 'tellers') loadTellers(selected.id);
        if (tab360 === 'vault') loadVault(selected.id);
        if (tab360 === 'cashops') loadCashOps(selected.id);
        if (tab360 === 'reconciliation') loadReconciliation(selected.id);
        if (tab360 === 'alerts') loadAlerts(selected.id);
    }, [tab360, selected, opPage, opType, opDateFrom, opDateTo]);

    // ─── Status change ───────────────────────────────────────
    const changeStatus = async (id: string, status: string) => {
        if (!window.confirm(`Confirmer: changer statut → ${status} ?`)) return;
        try {
            const r = await fetch(`${API_URL}/api/admin/branches/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ status })
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
            await fetchBranches();
            if (selected?.id === id) {
                // Le bandeau 360 (badge de statut + boutons Activer/Suspendre) lit `selected`,
                // pas `overview` : sans cette mise à jour, il restait figé sur l'ancien statut
                // (ex: "Brouillon" + bouton "Activer" encore affiché) alors que le bloc Aperçu
                // juste en dessous, lui, affichait déjà le nouveau statut via `loadOverview`.
                setSelected((prev: any) => prev && { ...prev, status });
                loadOverview(id);
            }
        } catch (e: any) { alert(e.message); }
    };

    // ─── Assign / Unassign staff ─────────────────────────────
    const assignStaff = async (staffId: string) => {
        try {
            const r = await fetch(`${API_URL}/api/admin/branches/${selected.id}/staff/${staffId}/assign`, {
                method: 'POST', headers: { Authorization: `Bearer ${token}` }
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
            loadStaff(selected.id);
        } catch (e: any) { alert(e.message); }
    };

    const unassignStaff = async (staffId: string) => {
        if (!window.confirm('Désassigner ce staff ?')) return;
        try {
            const r = await fetch(`${API_URL}/api/admin/branches/${selected.id}/staff/${staffId}/unassign`, {
                method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
            });
            if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
            loadStaff(selected.id);
        } catch (e: any) { alert(e.message); }
    };

    // ─── Create agency ────────────────────────────────────────
    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreating(true);
        try {
            const r = await fetch(`${API_URL}/api/admin/branches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(createForm)
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setShowCreate(false);
            setCreateForm({ name: '', code: '', city: '', region: '', address: '', phone: '', status: 'DRAFT', isHQ: false });
            fetchBranches();
        } catch (e: any) { alert(e.message); } finally { setCreating(false); }
    };

    // ────────────────────────────────────────────────────────
    // RENDER: Agency 360 Panel
    // ────────────────────────────────────────────────────────
    if (selected) {
        const tabs360 = [
            { id: 'overview' as const, icon: <BarChart3 size={15} />, label: 'Aperçu' },
            { id: 'staff' as const, icon: <Users size={15} />, label: 'Personnel' },
            { id: 'tellers' as const, icon: <User size={15} />, label: 'Caissiers' },
            { id: 'vault' as const, icon: <Wallet size={15} />, label: 'Coffre' },
            { id: 'cashops' as const, icon: <Activity size={15} />, label: 'Opérations' },
            { id: 'reconciliation' as const, icon: <BookOpen size={15} />, label: 'Rapprochement' },
            { id: 'alerts' as const, icon: <Bell size={15} />, label: 'Alertes' },
        ];

        return (
            <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 24 }}>
                    <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                        <ChevronLeft size={16} /> Réseau
                    </button>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{selected.name}</h2>
                            {selected.isHQ && <span style={{ background: '#7c3aed20', color: '#7c3aed', padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800 }}>SIÈGE</span>}
                            <StatusBadge status={selected.status} />
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>{selected.code} • {selected.city || '—'} {selected.region ? `(${selected.region})` : ''}</div>
                    </div>
                    {isAdmin && (
                        <div style={{ display: 'flex', gap: 8 }}>
                            {selected.status !== 'ACTIVE' && <button onClick={() => changeStatus(selected.id, 'ACTIVE')} style={{ padding: '7px 14px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-bg)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle size={14} /> Activer</button>}
                            {selected.status === 'ACTIVE' && <button onClick={() => changeStatus(selected.id, 'SUSPENDED')} style={{ padding: '7px 14px', background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}><Shield size={14} /> Suspendre</button>}
                        </div>
                    )}
                </div>

                <TabBar<AgencyTab360> tabs={tabs360} active={tab360} onChange={setTab360} />

                {/* OVERVIEW */}
                {tab360 === 'overview' && overview && (
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
                            <KpiCard icon={<ArrowUpCircle size={20} />} label="Cash-In aujourd'hui" value={fmt(overview.stats?.cashInToday || 0)} color="var(--success)" />
                            <KpiCard icon={<ArrowDownCircle size={20} />} label="Cash-Out aujourd'hui" value={fmt(overview.stats?.cashOutToday || 0)} color="var(--danger)" />
                            <KpiCard icon={<Activity size={20} />} label="Volume du jour" value={fmt(overview.stats?.volumeToday || 0)} color="var(--accent)" />
                            <KpiCard icon={<Wallet size={20} />} label="Coffre physique" value={fmt(overview.balance || 0)} color="var(--warning)" />
                            <KpiCard icon={<Users size={20} />} label="Sessions actives" value={String(overview.stats?.activeSessions || 0)} color="#3b82f6" />
                            <KpiCard icon={<AlertTriangle size={20} />} label="Écarts caisse" value={String(overview.stats?.discrepancies || 0)} color="var(--warning)" />
                        </div>
                        <div className="card" style={{ padding: 24 }}>
                            <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Informations de l'agence</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                {[
                                    ['Nom', overview.name], ['Code', overview.code], ['Ville', overview.city || '—'], ['Région', overview.region || '—'],
                                    ['Adresse', overview.address || '—'], ['Téléphone', overview.phone || '—'],
                                    ['Responsable', overview.manager?.name || '— Non assigné'], ['Statut', overview.status],
                                    ['Siège', overview.isHQ ? 'Oui' : 'Non'], ['Activé le', overview.activatedAt ? fmtDate(overview.activatedAt) : '—'],
                                    ['Staff total', String(overview._count?.staff || 0)], ['Sessions totales', String(overview._count?.sessions || 0)],
                                ].map(([k, v]) => (
                                    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{k}</span>
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>{v}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* STAFF */}
                {tab360 === 'staff' && (
                    <div>
                        <div className="card" style={{ padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <h3 style={{ margin: 0, fontWeight: 700 }}>Staff assigné ({staffList.length})</h3>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Matricule', 'Nom', 'Rôle', 'Statut', 'Affecté depuis', isAdmin ? 'Action' : ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {staffList.map(s => (
                                        <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '10px' }}><code style={{ fontSize: 11 }}>{s.matricule || '—'}</code></td>
                                            <td style={{ padding: '10px', fontWeight: 600 }}>{s.name}</td>
                                            <td style={{ padding: '10px' }}><span style={{ background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{s.role}</span></td>
                                            <td style={{ padding: '10px' }}><StatusBadge status={s.status} /></td>
                                            <td style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 12 }}>{fmtDate(s.createdAt)}</td>
                                            {isAdmin && <td style={{ padding: '10px' }}><button onClick={() => unassignStaff(s.id)} style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Désaffecter</button></td>}
                                        </tr>
                                    ))}
                                    {staffList.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun staff assigné.</td></tr>}
                                </tbody>
                            </table>

                            {isAdmin && unassigned.length > 0 && (
                                <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                                    <h4 style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 14 }}>Assigner un staff disponible</h4>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                        {unassigned.map(u => (
                                            <button key={u.id} onClick={() => assignStaff(u.id)} style={{ padding: '6px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Plus size={13} /> {u.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({u.role})</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TELLERS */}
                {tab360 === 'tellers' && (
                    <div className="card" style={{ padding: 20 }}>
                        <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Caissiers ({tellers.length})</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
                            {tellers.map(t => (
                                <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: t.activeSession ? 'var(--success-bg)' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.activeSession ? 'var(--success)' : 'var(--text-muted)' }}><User size={18} /></div>
                                        <div>
                                            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.matricule || '—'}</div>
                                        </div>
                                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: t.activeSession ? 'var(--success-bg)' : '#f1f5f9', color: t.activeSession ? 'var(--success)' : '#6b7280' }}>{t.activeSession ? '● EN CAISSE' : 'OFF'}</span>
                                    </div>
                                    {t.activeSession && (
                                        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, fontSize: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cash-In</span><span style={{ color: 'var(--success)', fontWeight: 700 }}>{fmt(t.activeSession.totalCashInValue)}</span></div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}><span>Cash-Out</span><span style={{ color: 'var(--danger)', fontWeight: 700 }}>{fmt(t.activeSession.totalCashOutValue)}</span></div>
                                            <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Ouvert: {fmtDate(t.activeSession.openedAt)}</div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {tellers.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>Aucun caissier assigné à cette agence.</div>}
                        </div>
                    </div>
                )}

                {/* VAULT */}
                {tab360 === 'vault' && vault && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div className="card" style={{ padding: 24 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>COFFRE PHYSIQUE</div>
                                <div style={{ fontSize: 32, fontWeight: 900, color: vault.physicalCash === 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(vault.physicalCash)}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Espèces disponibles au guichet</div>
                            </div>
                            <div className="card" style={{ padding: 24 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>WALLET ÉLECTRONIQUE</div>
                                <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent)' }}>{fmt(vault.electronicBalance)}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Caisse électronique (Mongain)</div>
                            </div>
                        </div>
                        <div className="card" style={{ padding: 20 }}>
                            <h3 style={{ margin: '0 0 14px', fontWeight: 700 }}>10 dernières opérations</h3>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    {['Réf.', 'Type', 'Montant', 'Frais', 'Statut', 'Date'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11 }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {(vault.lastOperations || []).map((op: any) => (
                                        <tr key={op.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '8px' }}><code style={{ fontSize: 11 }}>{op.reference}</code></td>
                                            <td style={{ padding: '8px' }}><span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: op.type === 'CASH_IN' ? 'var(--success-bg)' : op.type === 'CASH_OUT' ? 'var(--danger-bg)' : 'var(--bg-secondary)', color: op.type === 'CASH_IN' ? 'var(--success)' : op.type === 'CASH_OUT' ? 'var(--danger)' : 'var(--text-secondary)' }}>{op.type}</span></td>
                                            <td style={{ padding: '8px', fontWeight: 700 }}>{fmt(op.amount)}</td>
                                            <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{op.fee > 0 ? fmt(op.fee) : '—'}</td>
                                            <td style={{ padding: '8px' }}><StatusBadge status={op.status} /></td>
                                            <td style={{ padding: '8px', color: 'var(--text-muted)', fontSize: 12 }}>{fmtDate(op.createdAt)}</td>
                                        </tr>
                                    ))}
                                    {!(vault.lastOperations?.length) && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune opération.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* CASH OPERATIONS */}
                {tab360 === 'cashops' && (
                    <div className="card" style={{ padding: 20 }}>
                        <h3 style={{ margin: '0 0 16px', fontWeight: 700 }}>Opérations Cash</h3>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                            <select value={opType} onChange={e => setOpType(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
                                <option value="">Tous types</option>
                                <option value="CASH_IN">Cash-In</option>
                                <option value="CASH_OUT">Cash-Out</option>
                            </select>
                            <input type="date" value={opDateFrom} onChange={e => setOpDateFrom(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
                            <input type="date" value={opDateTo} onChange={e => setOpDateTo(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
                            <input placeholder="Référence..." value={opSearch} onChange={e => setOpSearch(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
                            <button onClick={() => selected && loadCashOps(selected.id)} style={{ padding: '8px 16px', background: 'var(--btn-dark-bg)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                                <Filter size={14} />
                            </button>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                                {['Réf.', 'Type', 'Montant', 'Frais', 'Client', 'Statut', 'Date'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 11 }}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                                {cashOps.map((op: any) => {
                                    const client = op.type === 'CASH_IN'
                                        ? op.receiverWallet?.user
                                        : op.senderWallet?.user;
                                    return (
                                        <tr key={op.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '10px' }}><code style={{ fontSize: 11 }}>{op.reference}</code></td>
                                            <td style={{ padding: '10px' }}><span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: op.type === 'CASH_IN' ? 'var(--success-bg)' : 'var(--danger-bg)', color: op.type === 'CASH_IN' ? 'var(--success)' : 'var(--danger)' }}>{op.type}</span></td>
                                            <td style={{ padding: '10px', fontWeight: 700 }}>{fmt(op.amount)}</td>
                                            <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{op.fee > 0 ? fmt(op.fee) : '—'}</td>
                                            <td style={{ padding: '10px' }}>{client ? <div><div style={{ fontWeight: 600 }}>{client.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{client.phone}</div></div> : '—'}</td>
                                            <td style={{ padding: '10px' }}><StatusBadge status={op.status} /></td>
                                            <td style={{ padding: '10px', color: 'var(--text-muted)', fontSize: 12 }}>{fmtDate(op.createdAt)}</td>
                                        </tr>
                                    );
                                })}
                                {cashOps.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune opération.</td></tr>}
                            </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
                            <button disabled={opPage <= 1} onClick={() => setOpPage(p => p - 1)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}><ChevronLeft size={16} /></button>
                            <span style={{ padding: '6px 12px', fontWeight: 600 }}>Page {opPage} / {Math.max(1, Math.ceil(cashOpsTotal / 20))}</span>
                            <button disabled={opPage * 20 >= cashOpsTotal} onClick={() => setOpPage(p => p + 1)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}><ChevronRight size={16} /></button>
                        </div>
                    </div>
                )}

                {/* RECONCILIATION */}
                {tab360 === 'reconciliation' && reconciliation && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="card" style={{ padding: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <h3 style={{ margin: 0, fontWeight: 700 }}>Rapprochement — {reconciliation.date}</h3>
                                <span style={{ padding: '4px 14px', borderRadius: 20, fontWeight: 800, fontSize: 13, background: reconciliation.varianceStatus === 'OK' ? 'var(--success-bg)' : 'var(--danger-bg)', color: reconciliation.varianceStatus === 'OK' ? 'var(--success)' : 'var(--danger)' }}>
                                    {reconciliation.varianceStatus === 'OK' ? '✓ Équilibré' : '⚠ Écart détecté'}
                                </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                                {[
                                    { label: 'Solde ouverture', value: fmt(reconciliation.openingBalance), color: 'var(--accent)' },
                                    { label: '+ Cash-In', value: fmt(reconciliation.totalCashIn), color: 'var(--success)' },
                                    { label: '— Cash-Out', value: fmt(reconciliation.totalCashOut), color: 'var(--danger)' },
                                    { label: 'Solde attendu', value: fmt(reconciliation.expectedBalance), color: 'var(--warning)' },
                                    { label: 'Solde physique', value: fmt(reconciliation.physicalBalance), color: '#3b82f6' },
                                    { label: 'Variance', value: fmt(reconciliation.variance), color: Math.abs(reconciliation.variance) < 1 ? 'var(--success)' : 'var(--danger)' },
                                ].map(item => (
                                    <div key={item.label} style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: 14 }}>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{item.label}</div>
                                        <div style={{ fontSize: 18, fontWeight: 800, color: item.color, marginTop: 4 }}>{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {reconciliation.sessionDiscrepancies?.length > 0 && (
                            <div className="card" style={{ padding: 20, borderLeft: '3px solid var(--danger)' }}>
                                <h4 style={{ margin: '0 0 12px', color: 'var(--danger)', fontWeight: 700 }}>⚠ Sessions avec écart</h4>
                                {reconciliation.sessionDiscrepancies.map((s: any) => (
                                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                        <span>{s.teller?.name} — {fmtDate(s.closedAt || s.openedAt)}</span>
                                        <span style={{ fontWeight: 700, color: (s.discrepancy || 0) < 0 ? 'var(--danger)' : 'var(--warning)' }}>{fmt(Math.abs(s.discrepancy || 0))} {(s.discrepancy || 0) < 0 ? '(déficit)' : '(excédent)'}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ALERTS */}
                {tab360 === 'alerts' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <h3 style={{ margin: 0, fontWeight: 700 }}>Alertes ({alerts.length})</h3>
                            <button onClick={() => loadAlerts(selected.id)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}><RefreshCw size={14} /> Actualiser</button>
                        </div>
                        {alerts.length === 0 && <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}><CheckCircle size={24} style={{ marginBottom: 8 }} /><br />Aucune alerte active. Agence opérationnelle.</div>}
                        {alerts.map((a, i) => {
                            const severityColors: Record<string, string> = { CRITICAL: 'var(--danger)', HIGH: 'var(--warning)', MEDIUM: 'var(--warning)', LOW: '#3b82f6' };
                            const sev = severityColors[a.severity] || '#6b7280';
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderRadius: 12, border: `1px solid ${sev}30`, background: `${sev}08` }}>
                                    <AlertTriangle size={20} style={{ color: sev, flexShrink: 0 }} />
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 700, fontSize: 13, color: sev }}>{a.type}</div>
                                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{a.message}</div>
                                    </div>
                                    <span style={{ padding: '3px 10px', borderRadius: 20, background: `${sev}20`, color: sev, fontWeight: 800, fontSize: 11 }}>{a.severity}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // ────────────────────────────────────────────────────────
    // RENDER: Network List
    // ────────────────────────────────────────────────────────
    const pages = Math.ceil(total / 20);

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader
                    title="Réseau d'Agences"
                    subtitle={`${total} agence${total !== 1 ? 's' : ''} dans le réseau Mongain`}
                    action={isAdmin && (
                        <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                            <Plus size={18} /> Nouvelle Agence
                        </button>
                    )}
                />
            </div>

            {/* Filters */}
            <div className="card" style={{ padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Rechercher par nom, code, ville, responsable..." style={{ width: '100%', padding: '8px 8px 8px 34px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }} />
                </div>
                <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}>
                    <option value="">Tous statuts</option>
                    <option value="ACTIVE">Active</option>
                    <option value="SUSPENDED">Suspendue</option>
                    <option value="DRAFT">Brouillon</option>
                    <option value="CONFIGURED">Configurée</option>
                    <option value="CLOSED">Fermée</option>
                </select>
                <input placeholder="Ville..." value={filterCity} onChange={e => { setFilterCity(e.target.value); setPage(1); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, width: 130 }} />
                <button onClick={() => { setPage(1); fetchBranches(); }} style={{ padding: '8px 14px', background: 'var(--btn-dark-bg)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    <Filter size={14} />
                </button>
            </div>

            {/* Error */}
            {error && <div style={{ padding: 16, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 10, marginBottom: 16, fontWeight: 600 }}>{error}</div>}

            {/* Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} /></div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                        <thead><tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                            {['Agence', 'Code', 'Ville', 'Responsable', 'Staff', 'Coffre', 'Statut', 'Action'].map(h => <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: 'var(--text-muted)', fontSize: 12 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                            {branches.map(b => (
                                <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-secondary)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                    <td style={{ padding: '14px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 36, height: 36, borderRadius: 10, background: b.isHQ ? '#7c3aed20' : 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: b.isHQ ? '#7c3aed' : 'var(--accent)' }}><Building2 size={18} /></div>
                                            <div>
                                                <div style={{ fontWeight: 700 }}>{b.name} {b.isHQ && <span style={{ fontSize: 10, background: '#7c3aed20', color: '#7c3aed', padding: '1px 6px', borderRadius: 10, fontWeight: 800 }}>SIÈGE</span>}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.city || '—'} {b.region ? `• ${b.region}` : ''}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 16px' }}><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 8px', borderRadius: 6 }}>{b.code}</code></td>
                                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}><MapPin size={13} style={{ marginRight: 4 }} />{b.city || '—'}</td>
                                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{b.manager?.name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Non assigné</span>}</td>
                                    <td style={{ padding: '14px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Users size={14} style={{ color: 'var(--text-muted)' }} /><span style={{ fontWeight: 600 }}>{b._count?.staff || 0}</span></div></td>
                                    <td style={{ padding: '14px 16px', fontWeight: 700 }}>{b.wallet ? fmt(b.balance) : '—'}</td>
                                    <td style={{ padding: '14px 16px' }}><StatusBadge status={b.status} /></td>
                                    <td style={{ padding: '14px 16px' }}>
                                        <button onClick={() => open360(b)} style={{ padding: '6px 14px', background: 'var(--btn-dark-bg)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <Eye size={13} /> 360°
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {branches.length === 0 && !loading && (
                                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune agence trouvée.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {pages > 1 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center', alignItems: 'center' }}>
                    <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}><ChevronLeft size={16} /></button>
                    <span style={{ padding: '8px 14px', fontWeight: 600 }}>Page {page} / {pages}</span>
                    <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', cursor: 'pointer' }}><ChevronRight size={16} /></button>
                </div>
            )}

            {/* Create Modal */}
            {showCreate && (
                <div style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div className="card" style={{ padding: 32, width: '100%', maxWidth: 520 }}>
                        <h3 style={{ margin: '0 0 20px', fontWeight: 800, fontSize: 20 }}>Créer une agence</h3>
                        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {[
                                { label: 'Nom', field: 'name', required: true },
                                { label: 'Code agence (unique)', field: 'code', required: true },
                                { label: 'Ville', field: 'city', required: false },
                                { label: 'Région', field: 'region', required: false },
                                { label: 'Adresse', field: 'address', required: false },
                                { label: 'Téléphone', field: 'phone', required: false },
                            ].map(({ label, field, required }) => (
                                <div key={field}>
                                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>{label} {required && '*'}</label>
                                    <input required={required} value={(createForm as any)[field]} onChange={e => setCreateForm(f => ({ ...f, [field]: e.target.value }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }} />
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: 12 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Statut initial</label>
                                    <select value={createForm.status} onChange={e => setCreateForm(f => ({ ...f, status: e.target.value }))} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }}>
                                        <option value="DRAFT">Brouillon</option>
                                        <option value="CONFIGURED">Configurée</option>
                                        <option value="ACTIVE">Active</option>
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                                    <input type="checkbox" id="isHQ" checked={createForm.isHQ} onChange={e => setCreateForm(f => ({ ...f, isHQ: e.target.checked }))} />
                                    <label htmlFor="isHQ" style={{ fontWeight: 700, fontSize: 14 }}>Agence Siège</label>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                                <button type="button" onClick={() => setShowCreate(false)} style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
                                <button type="submit" disabled={creating} style={{ flex: 2, padding: '12px', background: 'var(--btn-dark-bg)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                                    {creating ? 'Création...' : 'Créer l\'agence'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
