import { Building, ChevronLeft, ChevronRight, Lock, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react';
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

const PERM_LABELS: Record<string, string> = {
    perm_customer_view: 'Voir la liste des clients',
    perm_customer_360_basic: 'Consulter un profil client',
    perm_customer_wallet_view: 'Voir le solde wallet',
    perm_customer_kyc_view: 'Voir les photos KYC (CNI/selfie)',
    perm_customer_kyc_validate: 'Approuver/Rejeter un dossier KYC',
    perm_customer_flag: 'Signaler un client comme suspect',
    perm_customer_freeze: 'Geler / Dégeler un compte',
    perm_customer_suspend: 'Suspendre / Réactiver un compte',
    perm_cash_session_open: 'Ouvrir une session de caisse',
    perm_cash_session_close: 'Clôturer une session de caisse',
    perm_cash_in: 'Effectuer un dépôt (Cash-In)',
    perm_cash_out: 'Effectuer un retrait (Cash-Out)',
    perm_transaction_view: 'Voir l\'historique des transactions',
    perm_refund_request: 'Créer une demande de remboursement',
    perm_refund_approve: 'Approuver un remboursement',
    perm_ticket_view: 'Voir les réclamations',
    perm_ticket_create: 'Créer un ticket de réclamation',
    perm_ticket_resolve: 'Clôturer un ticket',
    perm_support_note: 'Ajouter une note de support',
    perm_branch_view: 'Voir les données de son agence',
    perm_branch_manage: 'Gérer les paramètres d\'agence',
    perm_treasury_view: 'Voir la masse monétaire globale',
    perm_treasury_mint: 'Émettre de la monnaie (Mint)',
    perm_treasury_allocate: 'Allouer des fonds à une agence',
    perm_system_settings_view: 'Voir les paramètres système',
    perm_system_settings_edit: 'Modifier les paramètres (Maker)',
    perm_system_settings_approve: 'Approuver un paramètre (Checker)',
    perm_staff_view: 'Voir la liste du personnel',
    perm_staff_manage: 'Créer/Modifier des comptes employés',
    perm_staff_permissions_edit: 'Modifier les droits d\'un employé',
    perm_analytics_view: 'Voir les tableaux de bord analytique',
    perm_audit_log_view: 'Voir les journaux d\'audit',
};

const PERM_GROUPS = [
    { label: 'Clients & CRM', perms: ['perm_customer_view', 'perm_customer_360_basic', 'perm_customer_wallet_view', 'perm_customer_kyc_view', 'perm_customer_kyc_validate', 'perm_customer_flag', 'perm_customer_freeze', 'perm_customer_suspend'] },
    { label: 'Guichet (Cash)', perms: ['perm_cash_session_open', 'perm_cash_session_close', 'perm_cash_in', 'perm_cash_out'] },
    { label: 'Transactions & Remboursements', perms: ['perm_transaction_view', 'perm_refund_request', 'perm_refund_approve'] },
    { label: 'Support & Réclamations', perms: ['perm_ticket_view', 'perm_ticket_create', 'perm_ticket_resolve', 'perm_support_note'] },
    { label: 'Agences', perms: ['perm_branch_view', 'perm_branch_manage'] },
    { label: 'Trésorerie & Système', perms: ['perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_allocate', 'perm_system_settings_view', 'perm_system_settings_edit', 'perm_system_settings_approve'] },
    { label: 'Personnel', perms: ['perm_staff_view', 'perm_staff_manage', 'perm_staff_permissions_edit'] },
    { label: 'Rapports & Audit', perms: ['perm_analytics_view', 'perm_audit_log_view'] },
];

const getRoleColor = (r: string) => {
    if (r === 'SUPER_ADMIN') return 'var(--accent)';
    if (r === 'RISK' || r === 'COMPLIANCE_CHECKER') return 'var(--warning)';
    if (r === 'BRANCH_MANAGER') return 'var(--success)';
    return 'var(--text-secondary)';
};

export default function StaffAccessRights({ token }: { token: string }) {
    const [error, setError] = useState('');
    const [roleSelection, setRoleSelection] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    const [pending, setPending] = useState<any[]>([]);
    const [pendingPage, setPendingPage] = useState(1);
    const [pendingTotal, setPendingTotal] = useState(0);
    const [pendingLoading, setPendingLoading] = useState(true);

    const [search, setSearch] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchPage, setSearchPage] = useState(1);
    const [searchTotal, setSearchTotal] = useState(0);
    const [searchLoading, setSearchLoading] = useState(false);

    // Matrice des droits
    const [permStaff, setPermStaff] = useState<any | null>(null);
    const [permData, setPermData] = useState<any | null>(null);
    const [permSaving, setPermSaving] = useState(false);
    const [checkedPerms, setCheckedPerms] = useState<Set<string>>(new Set());

    const fetchPending = async (page = pendingPage) => {
        setPendingLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff?unassigned=false&status=PENDING&page=${page}&limit=${PAGE_SIZE}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setPending(data.staff);
            setPendingTotal(data.total);
            setError('');
        } catch (e: any) { setError(e.message); }
        finally { setPendingLoading(false); }
    };

    useEffect(() => { fetchPending(pendingPage); }, [token, pendingPage]);

    const fetchSearch = async () => {
        if (!search.trim()) { setSearchResults([]); setSearchTotal(0); return; }
        setSearchLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff?q=${encodeURIComponent(search)}&unassigned=false&status=ACTIVE,SUSPENDED&page=${searchPage}&limit=${PAGE_SIZE}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setSearchResults(data.staff);
            setSearchTotal(data.total);
            setError('');
        } catch (e: any) { setError(e.message); }
        finally { setSearchLoading(false); }
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
        if (!window.confirm(`Activer ${s.name} avec le rôle ${roleFor(s)} sur l'agence ${s.branch?.name} ?`)) return;
        setSavingId(s.id);
        try {
            await setRole(s.id, roleFor(s));
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}/approve`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
            fetchPending(pendingPage);
        } catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    const handleUpdateActive = async (s: any) => {
        setSavingId(s.id);
        try { await setRole(s.id, roleFor(s)); fetchSearch(); }
        catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    const toggleSuspend = async (s: any) => {
        const nowActive = !s.isActive;
        if (!window.confirm(nowActive ? `Réactiver ${s.name} ?` : `Suspendre ${s.name} ?`)) return;
        setSavingId(s.id);
        try {
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ isActive: nowActive })
            });
            setSearchResults(prev => prev.map(x => x.id === s.id ? { ...x, isActive: nowActive } : x));
        } catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    const openPermMatrix = async (s: any) => {
        setPermStaff(s); setPermData(null);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff/${s.id}/permissions`, { headers: { 'Authorization': `Bearer ${token}` } });
            setPermData(data);
            setCheckedPerms(new Set(data.effectivePermissions));
        } catch (e: any) { alert('Impossible de charger les droits : ' + e.message); }
    };

    const savePermissions = async () => {
        if (!permStaff) return;
        setPermSaving(true);
        try {
            await apiFetch(`${API_URL}/api/admin/staff/${permStaff.id}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ permissions: Array.from(checkedPerms) })
            });
            alert(`✅ Droits de ${permStaff.name} mis à jour.`);
            setPermStaff(null);
        } catch (e: any) { alert('Erreur : ' + e.message); }
        finally { setPermSaving(false); }
    };

    const resetPermissions = async () => {
        if (!permStaff || !window.confirm(`Remettre les droits de ${permStaff.name} aux défauts du rôle ?`)) return;
        setPermSaving(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff/${permStaff.id}/permissions`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
            });
            setCheckedPerms(new Set(data.effectivePermissions));
            setPermStaff(null);
        } catch (e: any) { alert('Erreur : ' + e.message); }
        finally { setPermSaving(false); }
    };

    const Pager = ({ page, setPage, total }: { page: number; setPage: (p: number) => void; total: number }) => {
        const pages = Math.ceil(total / PAGE_SIZE) || 1;
        if (pages <= 1) return null;
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                <button onClick={() => setPage(page - 1)} disabled={page <= 1} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}><ChevronLeft size={16} /></button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} / {pages} · {total} au total</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= pages} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)' }}><ChevronRight size={16} /></button>
            </div>
        );
    };

    const thStyle = { padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 };
    const tdStyle = { padding: '15px 20px' };

    return (
        <div style={{ maxWidth: 950, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="3. Droits d'Accès & Activation" subtitle="File d'attente d'activation, reconfiguration de rôles, et gestion granulaire des permissions par employé." />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button onClick={() => { fetchPending(pendingPage); if (search.trim()) fetchSearch(); }} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Réessayer</button>
                </div>
            )}

            {/* ── FILE D'ATTENTE ── */}
            <div style={{ marginBottom: 40 }}>
                <h4 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                    File d'attente {pendingTotal > 0 && `(${pendingTotal})`}
                </h4>
                <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--bg-primary)' }}>
                            <tr>
                                <th style={thStyle}>Nom</th>
                                <th style={thStyle}>Agence</th>
                                <th style={thStyle}>Rôle</th>
                                <th style={thStyle}>Statut</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pendingLoading ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                            ) : pending.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Aucun compte en attente.</td></tr>
                            ) : pending.map((s, idx) => (
                                <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                    <td style={tdStyle}><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div></td>
                                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 14 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building size={12} /> {s.branch?.name}</span></td>
                                    <td style={tdStyle}>
                                        <select value={roleFor(s)} onChange={e => setRoleSelection(sel => ({ ...sel, [s.id]: e.target.value }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, minWidth: 190 }}>
                                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                        </select>
                                    </td>
                                    <td style={tdStyle}><span style={{ fontSize: 12, fontWeight: 700, color: 'var(--warning)', background: 'var(--warning-bg)', padding: '3px 8px', borderRadius: 10 }}>EN ATTENTE</span></td>
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        <button onClick={() => handleActivate(s)} disabled={savingId === s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
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

            {/* ── RECHERCHE ── */}
            <div style={{ marginBottom: 40 }}>
                <h4 style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                    Reconfigurer un compte existant
                </h4>
                <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={search} onChange={e => { setSearch(e.target.value); setSearchPage(1); }} placeholder="Nom, email ou matricule..." style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid var(--border)' }} />
                </div>

                {!search.trim() ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Tapez un nom, email ou matricule pour changer le rôle, suspendre ou configurer les droits granulaires.</p>
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
                                        <th style={thStyle}>Nom</th>
                                        <th style={thStyle}>Agence</th>
                                        <th style={thStyle}>Rôle</th>
                                        <th style={thStyle}>Statut</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {searchResults.map((s, idx) => (
                                        <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                            <td style={tdStyle}>
                                                <div style={{ fontWeight: 600 }}>{s.name}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div>
                                                {s.permissionsCustomized && (
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 6px', borderRadius: 8 }}>DROITS PERSONNALISÉS</span>
                                                )}
                                            </td>
                                            <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 14 }}>{s.branch?.name || '—'}</td>
                                            <td style={tdStyle}>
                                                <select value={roleFor(s)} onChange={e => setRoleSelection(sel => ({ ...sel, [s.id]: e.target.value }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, color: getRoleColor(roleFor(s)) }}>
                                                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                                </select>
                                            </td>
                                            <td style={tdStyle}>
                                                <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: s.isActive ? 'var(--success-bg)' : 'var(--danger-bg)', color: s.isActive ? 'var(--success)' : 'var(--danger)' }}>
                                                    {s.isActive ? 'ACTIF' : 'SUSPENDU'}
                                                </span>
                                            </td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                                    {roleFor(s) !== s.role && (
                                                        <button onClick={() => handleUpdateActive(s)} disabled={savingId === s.id} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                                            Enregistrer
                                                        </button>
                                                    )}
                                                    <button onClick={() => openPermMatrix(s)} style={{ padding: '6px 12px', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                        <Lock size={11} /> Droits
                                                    </button>
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

            {/* ── MODALE : MATRICE DES PERMISSIONS ── */}
            {permStaff && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div className="card" style={{ padding: 28, width: '100%', maxWidth: 780, maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div>
                                <h3 style={{ margin: 0, fontWeight: 800 }}>Droits : {permStaff.name}</h3>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                    Rôle : <strong style={{ color: getRoleColor(permStaff.role) }}>{permStaff.role}</strong>
                                    {permData?.permissionsCustomized && (
                                        <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '2px 8px', borderRadius: 8 }}>PERSONNALISÉS</span>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setPermStaff(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
                        </div>

                        {!permData ? (
                            <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Chargement des droits...</p>
                        ) : (
                            <>
                                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                                    Cochez les droits à accorder à cet employé. Si vous remettez les droits par défaut du rôle, les cases reflèteront les droits standard du poste.
                                </p>
                                {PERM_GROUPS.map(group => (
                                    <div key={group.label} style={{ marginBottom: 20 }}>
                                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                                            {group.label}
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                            {group.perms.map(perm => (
                                                <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={checkedPerms.has(perm)}
                                                        onChange={e => {
                                                            const next = new Set(checkedPerms);
                                                            e.target.checked ? next.add(perm) : next.delete(perm);
                                                            setCheckedPerms(next);
                                                        }}
                                                        style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
                                                    />
                                                    {PERM_LABELS[perm] || perm}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}

                                <div style={{ display: 'flex', gap: 12, marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                                    <button onClick={savePermissions} disabled={permSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                                        <Save size={14} /> {permSaving ? 'Enregistrement...' : 'Enregistrer les droits'}
                                    </button>
                                    <button onClick={resetPermissions} disabled={permSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 20px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                                        <RotateCcw size={14} /> Remettre les défauts du rôle
                                    </button>
                                    <button onClick={() => setPermStaff(null)} style={{ marginLeft: 'auto', padding: '10px 20px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
                                        Annuler
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
