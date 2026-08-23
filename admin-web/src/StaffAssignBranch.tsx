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
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader
                    title="2. Affecter à une Agence"
                    subtitle="Recherchez, filtrez et triez le personnel pour l'affecter ou le réaffecter à une agence — y compris le Siège."
                />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button
                        onClick={fetchList}
                        style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                    >
                        Réessayer
                    </button>
                </div>
            )}

            {/* ── FILTRES ── */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Nom, email ou matricule..."
                        style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                </div>
                <select value={assignFilter} onChange={e => setAssignFilter(e.target.value as any)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <option value="ALL">Tous les statuts</option>
                    <option value="UNASSIGNED">Non affectés</option>
                    <option value="ASSIGNED">Affectés</option>
                </select>
                <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <option value="">Toutes les agences</option>
                    {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}{b.isHQ ? ' (Siège HQ)' : ''}</option>
                    ))}
                </select>
                <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{total} utilisateur{total !== 1 ? 's' : ''}</div>

            {/* ── TABLEAU ── */}
            <div className="table-container">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                    <thead>
                        <tr>
                            <th>Utilisateur</th>
                            <th>Matricule</th>
                            <th>Agence Actuelle</th>
                            <th>Nouvelle Affectation</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : list.length === 0 ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{emptyLabel}</td></tr>
                        ) : list.map(s => (
                            <tr key={s.id}>
                                <td>
                                    <div style={{ fontWeight: 600 }}>{s.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div>
                                </td>
                                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{s.matricule || '—'}</td>
                                <td>
                                    {s.branch ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}><Building size={14} /> {s.branch.name}</span>
                                    ) : (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '3px 8px', borderRadius: 10 }}>NON AFFECTÉ</span>
                                    )}
                                </td>
                                <td>
                                    <select
                                        value={selectedValue(s)}
                                        onChange={e => setSelection(sel => ({ ...sel, [s.id]: e.target.value }))}
                                        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', minWidth: 200 }}
                                    >
                                        <option value="">— Non affecté —</option>
                                        {branches.map(b => (
                                            <option key={b.id} value={b.id}>{b.name}{b.isHQ ? ' (Siège HQ)' : ''}</option>
                                        ))}
                                    </select>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <button
                                        onClick={() => handleSave(s)}
                                        disabled={savingId === s.id || !hasChanged(s)}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
                                            background: hasChanged(s) ? 'var(--btn-dark-bg)' : 'var(--bg-secondary)',
                                            color: hasChanged(s) ? 'var(--btn-dark-text)' : 'var(--text-muted)',
                                            border: hasChanged(s) ? 'none' : '1px solid var(--border)',
                                            borderRadius: 8, cursor: savingId === s.id || !hasChanged(s) ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13
                                        }}
                                    >
                                        <Building size={14} /> {savingId === s.id ? '...' : s.branchId ? 'Réaffecter' : 'Affecter'}
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                    <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} / {pages} · {total} au total</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= pages} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
