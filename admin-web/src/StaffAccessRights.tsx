import { Building, ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

const PAGE_SIZE = 20;

const ROLES = [
    { value: 'TELLER', label: 'Teller (Caissier)' },
    { value: 'BRANCH_MANAGER', label: 'Responsable d\'Agence' },
    { value: 'COMPLIANCE_CHECKER', label: 'Conformité' },
    { value: 'RISK', label: 'Analyste Risque' },
    { value: 'SUPPORT_MAKER', label: 'Support Client' },
    { value: 'SUPER_ADMIN', label: 'Super Administrateur' },
];

const getRoleColor = (r: string) => {
    if (r === 'SUPER_ADMIN') return 'var(--accent)';
    if (r === 'RISK' || r === 'COMPLIANCE_CHECKER') return 'var(--warning)';
    if (r === 'BRANCH_MANAGER') return 'var(--success)';
    return 'var(--text-secondary)';
};

// Page 3/3 du parcours d'onboarding — conçue pour tenir à l'échelle : la file d'attente
// d'activation est paginée côté serveur (elle ne contient que les comptes PENDING déjà
// affectés à une agence — page 2), et la reconfiguration des comptes déjà actifs passe par
// une recherche à la demande plutôt que de charger tout le personnel d'un coup.
export default function StaffAccessRights({ token }: { token: string }) {
    const [error, setError] = useState('');
    const [roleSelection, setRoleSelection] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    // File d'attente — affectés à une agence, en attente d'activation
    const [pending, setPending] = useState<any[]>([]);
    const [pendingPage, setPendingPage] = useState(1);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [pendingLoading, setPendingLoading] = useState(true);

    // Recherche — reconfiguration des comptes déjà actifs
    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchPage, setSearchPage] = useState(1);
    const [searchTotal, setSearchTotal] = useState(0);
    const [searchLoading, setSearchLoading] = useState(false);

    const fetchPending = async (page = pendingPage) => {
        setPendingLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff?unassigned=false&status=PENDING&page=${page}&limit=${PAGE_SIZE}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setPending(data.staff);
            setPendingTotal(data.total);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setPendingLoading(false);
        }
    };

    useEffect(() => { fetchPending(pendingPage); }, [token, pendingPage]);

    const fetchSearch = async () => {
        if (!search.trim()) { setSearchResults([]); setSearchTotal(0); return; }
        setSearchLoading(true);
        try {
            // La recherche cible la reconfiguration des comptes déjà actifs/suspendus — les PENDING
            // ont déjà leur propre file d'attente ci-dessus, pas besoin de les dupliquer ici. Filtré
            // côté serveur (pas juste après coup côté client) pour que `total`, et donc la pagination,
            // reflète vraiment le nombre de lignes affichées plutôt que de compter aussi les PENDING.
            const data = await apiFetch(`${API_URL}/api/admin/staff?q=${encodeURIComponent(search)}&unassigned=false&status=ACTIVE,SUSPENDED&page=${searchPage}&limit=${PAGE_SIZE}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setSearchResults(data.staff);
            setSearchTotal(data.total);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSearchLoading(false);
        }
    };

    useEffect(() => {
        if (!search.trim()) { setSearchResults([]); setSearchTotal(0); return; }
        const t = setTimeout(fetchSearch, 350);
        return () => clearTimeout(t);
    }, [token, search, searchPage]);

    const roleFor = (s: any) => roleSelection[s.id] ?? s.role;

    const setRole = async (staffId: string, role: string) => {
        await apiFetch(`${API_URL}/api/admin/staff/${staffId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ role })
        });
    };

    const handleActivate = async (s: any) => {
        if (!window.confirm(`Activer ${s.name} avec le rôle ${roleFor(s)} sur l'agence ${s.branch?.name} ? Cette accréditation sera immédiatement active.`)) return;
        setSavingId(s.id);
        try {
            await setRole(s.id, roleFor(s));
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}/approve`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            fetchPending(pendingPage);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSavingId(null);
        }
    };

    const handleUpdateActive = async (s: any) => {
        setSavingId(s.id);
        try {
            await setRole(s.id, roleFor(s));
            fetchSearch();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSavingId(null);
        }
    };

    const toggleSuspend = async (s: any) => {
        const nowActive = !s.isActive;
        if (!window.confirm(nowActive ? `Réactiver ${s.name} ?` : `Suspendre ${s.name} ? Il/elle perdra immédiatement l'accès.`)) return;
        setSavingId(s.id);
        try {
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ isActive: nowActive })
            });
            setSearchResults(prev => prev.map(x => x.id === s.id ? { ...x, isActive: nowActive } : x));
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSavingId(null);
        }
    };

    const Pager = ({ page, setPage, total }: { page: number; setPage: (p: number) => void; total: number }) => {
        const pages = Math.ceil(total / PAGE_SIZE) || 1;
        if (pages <= 1) return null;
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                <button onClick={() => setPage(page - 1)} disabled={page <= 1} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} / {pages} · {total} au total</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= pages} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    <ChevronRight size={16} />
                </button>
            </div>
        );
    };

    return (
        <div style={{ maxWidth: 950, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="3. Droits d'Accès & Activation" subtitle="File d'attente d'activation, plus une recherche pour reconfigurer n'importe quel compte déjà actif." />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button
                        onClick={() => { fetchPending(pendingPage); if (search.trim()) fetchSearch(); }}
                        style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                    >
                        Réessayer
                    </button>
                </div>
            )}

            {/* ── FILE D'ATTENTE : ACTIVATION ── */}
            <div style={{ marginBottom: 40 }}>
                <h4 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                    File d'attente {pendingTotal > 0 && `(${pendingTotal})`}
                </h4>
                <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--bg-primary)' }}>
                            <tr>
                                <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Nom</th>
                                <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Agence</th>
                                <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Rôle</th>
                                <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Statut</th>
                                <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13, textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pendingLoading ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                            ) : pending.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Aucun compte en attente d'activation.</td></tr>
                            ) : pending.map((s, idx) => (
                                <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                    <td style={{ padding: '15px 20px' }}>
                                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div>
                                    </td>
                                    <td style={{ padding: '15px 20px', color: 'var(--text-secondary)', fontSize: 14 }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building size={12} /> {s.branch?.name}</span>
                                    </td>
                                    <td style={{ padding: '15px 20px' }}>
                                        <select
                                            value={roleFor(s)}
                                            onChange={e => setRoleSelection(sel => ({ ...sel, [s.id]: e.target.value }))}
                                            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, minWidth: 190 }}
                                        >
                                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                        </select>
                                    </td>
                                    <td style={{ padding: '15px 20px' }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '3px 8px', borderRadius: 10 }}>EN ATTENTE</span>
                                    </td>
                                    <td style={{ padding: '15px 20px', textAlign: 'right' }}>
                                        <button
                                            onClick={() => handleActivate(s)}
                                            disabled={savingId === s.id}
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: savingId === s.id ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}
                                        >
                                            <ShieldCheck size={14} /> {savingId === s.id ? '...' : 'Activer'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {pendingTotal > PAGE_SIZE && <Pager page={pendingPage} setPage={setPendingPage} total={pendingTotal} />}
            </div>

            {/* ── RECHERCHE : RECONFIGURER UN COMPTE ACTIF ── */}
            <div>
                <h4 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                    Reconfigurer un compte existant
                </h4>
                <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        value={search}
                        onChange={e => { setSearch(e.target.value); setSearchPage(1); }}
                        placeholder="Nom, email ou matricule..."
                        style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                </div>

                {!search.trim() ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Tapez un nom, un email ou un matricule pour changer le rôle ou suspendre quelqu'un.</p>
                ) : searchLoading ? (
                    <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Recherche...</div>
                ) : searchResults.length === 0 ? (
                    <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun résultat pour « {search} ».</div>
                ) : (
                    <>
                        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ background: 'var(--bg-primary)' }}>
                                    <tr>
                                        <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Nom</th>
                                        <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Agence</th>
                                        <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Rôle</th>
                                        <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Statut</th>
                                        <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13, textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((s, idx) => (
                                        <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                            <td style={{ padding: '15px 20px' }}>
                                                <div style={{ fontWeight: 600 }}>{s.name}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div>
                                            </td>
                                            <td style={{ padding: '15px 20px', color: 'var(--text-secondary)', fontSize: 14 }}>{s.branch?.name || '—'}</td>
                                            <td style={{ padding: '15px 20px' }}>
                                                <select
                                                    value={roleFor(s)}
                                                    onChange={e => setRoleSelection(sel => ({ ...sel, [s.id]: e.target.value }))}
                                                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, color: getRoleColor(roleFor(s)) }}
                                                >
                                                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={{ padding: '15px 20px' }}>
                                                <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.isActive ? 'var(--success-bg)' : 'var(--danger-bg)', color: s.isActive ? 'var(--success)' : 'var(--danger)' }}>
                                                    {s.isActive ? 'ACTIF' : 'SUSPENDU'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '15px 20px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                                    {roleFor(s) !== s.role && (
                                                        <button onClick={() => handleUpdateActive(s)} disabled={savingId === s.id} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                                            Enregistrer
                                                        </button>
                                                    )}
                                                    <button onClick={() => toggleSuspend(s)} disabled={savingId === s.id} style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border)', color: s.isActive ? 'var(--danger)' : 'var(--success)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                                        {s.isActive ? 'Suspendre' : 'Réactiver'}
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <Pager page={searchPage} setPage={setSearchPage} total={searchTotal} />
                    </>
                )}
            </div>
        </div>
    );
}
