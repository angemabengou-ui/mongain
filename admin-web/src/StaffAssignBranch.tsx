import { Building, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

const PAGE_SIZE = 15;

const SORT_OPTIONS = [
    { value: 'name-asc', label: 'Nom (A → Z)' },
    { value: 'name-desc', label: 'Nom (Z → A)' },
    { value: 'createdAt-desc', label: 'Plus récents' },
    { value: 'createdAt-asc', label: 'Plus anciens' },
];

// Page 2/3 du parcours d'onboarding — affecte ET réaffecte à une agence.
// Un seul tableau, toujours rempli de données réelles (jamais vide par défaut) :
// filtrable par statut d'affectation et par agence, triable, et cherchable pour
// retrouver quelqu'un qui ne serait pas dans les 15 lignes affichées.
export default function StaffAssignBranch({ token }: { token: string }) {
    const [branches, setBranches] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [selection, setSelection] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    const [list, setList] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    const [q, setQ] = useState('');
    const [assignFilter, setAssignFilter] = useState<'ALL' | 'UNASSIGNED' | 'ASSIGNED'>('ALL');
    const [branchFilter, setBranchFilter] = useState('');
    const [sort, setSort] = useState('name-asc');

    useEffect(() => {
        apiFetch(API_URL + '/api/admin/branches?limit=200', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(d => setBranches(Array.isArray(d) ? d : (d.branches || [])))
            .catch((e: any) => setError(e.message));
    }, [token]);

    const fetchList = async () => {
        setLoading(true);
        try {
            const [sortBy, order] = sort.split('-');
            const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sortBy, order });
            if (q.trim()) params.set('q', q.trim());
            if (assignFilter === 'UNASSIGNED') params.set('unassigned', 'true');
            else if (assignFilter === 'ASSIGNED') params.set('unassigned', 'false');
            if (branchFilter) params.set('branchId', branchFilter);

            const data = await apiFetch(`${API_URL}/api/admin/staff?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setList(data.staff);
            setTotal(data.total);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Débounce léger sur tout changement (recherche, filtres, tri, page) — un seul
    // point de vérité, jamais deux tableaux ni deux logiques de chargement à gérer.
    useEffect(() => {
        const t = setTimeout(fetchList, 300);
        return () => clearTimeout(t);
    }, [token, page, q, assignFilter, branchFilter, sort]);

    // Tout changement de filtre/recherche/tri doit ramener à la page 1.
    useEffect(() => { setPage(1); }, [q, assignFilter, branchFilter, sort]);

    const selectedValue = (s: any) => selection[s.id] ?? (s.branchId || '');
    const hasChanged = (s: any) => selectedValue(s) !== (s.branchId || '');

    const handleSave = async (s: any) => {
        const newBranchId = selectedValue(s);
        const isReassign = !!s.branchId;
        const label = newBranchId ? branches.find(b => b.id === newBranchId)?.name || '' : null;
        const confirmMsg = !label
            ? `Retirer ${s.name} de son agence actuelle (${s.branch?.name}) ?`
            : isReassign
                ? `Transférer ${s.name} de ${s.branch?.name || 'aucune agence'} vers ${label} ?`
                : `Affecter ${s.name} à ${label} ?`;
        if (!window.confirm(confirmMsg)) return;

        setSavingId(s.id);
        try {
            // N'envoie que branchId — role/isActive restent inchangés (Prisma ignore les
            // clés absentes d'un update), cette page ne décide jamais des droits.
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ branchId: newBranchId || null })
            });
            setSelection(sel => { const n = { ...sel }; delete n[s.id]; return n; });
            fetchList();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSavingId(null);
        }
    };

    const emptyLabel = q.trim()
        ? `Aucun résultat pour « ${q} ».`
        : assignFilter === 'UNASSIGNED'
            ? 'Aucun utilisateur non affecté.'
            : assignFilter === 'ASSIGNED'
                ? 'Aucun utilisateur affecté pour le moment.'
                : 'Aucun utilisateur ne correspond à ces filtres.';

    const pages = Math.ceil(total / PAGE_SIZE) || 1;

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ marginBottom: 32 }}>
                <PageHeader
                    title="2. Affecter à une Agence"
                    subtitle="Gérez l'affectation de votre réseau. Recherchez et filtrez vos collaborateurs pour les assigner aux agences de la plateforme."
                />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '16px 20px', borderRadius: 12, marginBottom: 24, fontWeight: 600 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button
                        onClick={fetchList}
                        style={{ padding: '8px 16px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 13, transition: '0.2s' }}
                    >
                        Réessayer
                    </button>
                </div>
            )}

            {/* ── FILTRES (Glassmorphism/Sleek) ── */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 260 }}>
                    <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Rechercher par nom, email ou matricule..."
                        style={{ flex: '1 1 200px', width: '100%', padding: '12px 16px 12px 42px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, outline: 'none', transition: 'border-color 0.2s' }}
                    />
                </div>
                <select value={assignFilter} onChange={e => setAssignFilter(e.target.value as any)} style={{ width: 'auto', flex: '1 1 200px', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, minWidth: 160, cursor: 'pointer', outline: 'none' }}>
                    <option value="ALL">Tous les statuts</option>
                    <option value="UNASSIGNED">En attente d'affectation</option>
                    <option value="ASSIGNED">Affectés (Actifs)</option>
                </select>
                <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={{ width: 'auto', flex: '1 1 200px', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, minWidth: 200, cursor: 'pointer', outline: 'none' }}>
                    <option value="">Toutes les agences</option>
                    {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}{b.isHQ ? ' (Siège HQ)' : ''}</option>
                    ))}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 'auto', flex: '1 1 200px', padding: '12px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 14, minWidth: 160, cursor: 'pointer', outline: 'none' }}>
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 8px' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>Résultats ({total} utilisateurs)</span>
            </div>

            {/* ── TABLEAU ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['Utilisateur', 'Matricule', 'Agence Actuelle', 'Nouvelle Affectation', 'Action'].map((h, i) => (
                                <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: i === 4 ? 'right' : 'left' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Récupération des profils en cours...</td></tr>
                        ) : list.length === 0 ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)', fontWeight: 600, fontSize: 15 }}>{emptyLabel}</td></tr>
                        ) : list.map(s => (
                            <tr key={s.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                <td style={{ padding: '16px 20px' }}>
                                    <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>{s.name}</div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.email}</div>
                                </td>
                                <td style={{ padding: '16px 20px', fontFamily: 'monospace', fontSize: 13, color: 'var(--text-secondary)' }}>{s.matricule || '—'}</td>
                                <td style={{ padding: '16px 20px' }}>
                                    {s.branch ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontWeight: 700, padding: '6px 12px', background: 'var(--accent-bg)', borderRadius: 20, fontSize: 12 }}><Building size={14} /> {s.branch.name}</span>
                                    ) : (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 900, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '6px 10px', borderRadius: 20 }}>NON AFFECTÉ</span>
                                    )}
                                </td>
                                <td style={{ padding: '16px 20px' }}>
                                    <select
                                        value={selectedValue(s)}
                                        onChange={e => setSelection(sel => ({ ...sel, [s.id]: e.target.value }))}
                                        style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, minWidth: 220, cursor: 'pointer', outline: 'none', transition: '0.2s', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }}
                                    >
                                        <option value="">— Désaffecter / Non assigné —</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}{b.isHQ ? ' (Siège HQ)' : ''}</option>
                                        ))}
                                    </select>
                                </td>
                                <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                    <button
                                        onClick={() => handleSave(s)}
                                        disabled={savingId === s.id || !hasChanged(s)}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 18px',
                                            background: hasChanged(s) ? 'linear-gradient(135deg, var(--accent) 0%, rgba(139, 92, 246, 0.8) 100%)' : 'var(--bg-secondary)',
                                            color: hasChanged(s) ? '#fff' : 'var(--text-muted)',
                                            border: 'none',
                                            borderRadius: 10, cursor: savingId === s.id || !hasChanged(s) ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13,
                                            boxShadow: hasChanged(s) ? '0 4px 12px rgba(139, 92, 246, 0.25)' : 'none',
                                            transition: 'all 0.2s ease',
                                            transform: hasChanged(s) ? 'translateY(-1px)' : 'none'
                                        }}
                                    >
                                        <Building size={14} /> {savingId === s.id ? 'Patientez...' : s.branchId && s.branchId !== selectedValue(s) ? 'Réaffecter' : 'Affecter'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 24 }}>
                    <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} style={{ padding: 10, background: 'var(--bg-secondary)', border: 'none', borderRadius: 10, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', transition: '0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                        <ChevronLeft size={18} />
                    </button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '6px 16px', borderRadius: 20 }}>Page {page} / {pages}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= pages} style={{ padding: 10, background: 'var(--bg-secondary)', border: 'none', borderRadius: 10, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)', transition: '0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}
