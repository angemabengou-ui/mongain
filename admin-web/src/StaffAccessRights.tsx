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
    perm_vault_view: 'Voir les caisses communes',
    perm_vault_manage: 'Geler, forcer une résolution, gérer les rôles/bons',
    perm_tontine_view: 'Voir les tontines',
    perm_tontine_manage: 'Mettre en pause, forcer/relancer un cycle',
    perm_merchant_view: 'Voir les comptes marchands',
    perm_merchant_manage: 'Approuver/rejeter un retrait marchand',
    perm_treasury_view: 'Voir la masse monétaire globale',
    perm_treasury_mint: 'Émettre de la monnaie (Mint)',
    perm_treasury_allocate: 'Allouer des fonds à une agence',
    perm_treasury_approve: 'Approuver une demande de trésorerie (Checker)',
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
    { label: 'Caisse Commune & Tontine', perms: ['perm_vault_view', 'perm_vault_manage', 'perm_tontine_view', 'perm_tontine_manage'] },
    { label: 'Marchands', perms: ['perm_merchant_view', 'perm_merchant_manage'] },
    { label: 'Trésorerie & Système', perms: ['perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_allocate', 'perm_treasury_approve', 'perm_system_settings_view', 'perm_system_settings_edit', 'perm_system_settings_approve'] },
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

    const [staffList, setStaffList] = useState<any[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState('');

    // Matrice des droits
    const [permStaff, setPermStaff] = useState<any | null>(null);
    const [permData, setPermData] = useState<any | null>(null);
    const [permSaving, setPermSaving] = useState(false);
    const [checkedPerms, setCheckedPerms] = useState<Set<string>>(new Set());

    const loadData = async (currentPage = page, searchQuery = search) => {
        setLoading(true);
        try {
            const queryParam = searchQuery.trim() ? `&q=${encodeURIComponent(searchQuery)}` : '';
            // On récupère TOUT sans filtrer par statut "PENDING" ou autre
            const data = await apiFetch(`${API_URL}/api/admin/staff?page=${currentPage}&limit=${PAGE_SIZE}${queryParam}`, { headers: { 'Authorization': `Bearer ${token}` } });
            setStaffList(data.staff);
            setTotal(data.total);
            setError('');
        } catch (e: any) {
            setError(e.message || 'Erreur de connexion');
        } finally {
            setLoading(false);
        }
    };

    // Charger les données au montage ou changement de page
    useEffect(() => { loadData(page, search); }, [token, page]);

    // Live search avec debounce
    useEffect(() => {
        const t = setTimeout(() => { setPage(1); loadData(1, search); }, 400);
        return () => clearTimeout(t);
    }, [search]);

    const roleFor = (s: any) => roleSelection[s.id] ?? s.role;

    const setRole = async (staffId: string, role: string) => {
        await apiFetch(`${API_URL}/api/admin/staff/${staffId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ role })
        });
    };

    const handleActivate = async (s: any) => {
        if (!window.confirm(`Valider et activer la demande de recrutement de ${s.name} avec le rôle ${roleFor(s)} ?`)) return;
        setSavingId(s.id);
        try {
            await setRole(s.id, roleFor(s));
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}/approve`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
            loadData();
        } catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    const handleUpdateActive = async (s: any) => {
        setSavingId(s.id);
        try { await setRole(s.id, roleFor(s)); loadData(); }
        catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    const toggleSuspend = async (s: any) => {
        const nowActive = !s.isActive;
        if (!window.confirm(nowActive ? `Réactiver le compte de ${s.name} ?` : `Suspendre l'accès de ${s.name} ?`)) return;
        setSavingId(s.id);
        try {
            await apiFetch(`${API_URL}/api/admin/staff/${s.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ isActive: nowActive })
            });
            setStaffList(prev => prev.map(x => x.id === s.id ? { ...x, isActive: nowActive } : x));
        } catch (e: any) { alert(e.message); }
        finally { setSavingId(null); }
    };

    // Gestion Matrice des droits
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
            loadData(); // Rafraîchir pour afficher/cacher le badge DROITS PERSONNALISÉS
        } catch (e: any) { alert('Erreur : ' + e.message); }
        finally { setPermSaving(false); }
    };

    const resetPermissions = async () => {
        if (!permStaff || !window.confirm(`Remettre les droits de ${permStaff.name} stricto-sensu aux défauts de son rôle ?`)) return;
        setPermSaving(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/staff/${permStaff.id}/permissions`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
            });
            setCheckedPerms(new Set(data.effectivePermissions));
            setPermStaff(null);
            loadData();
        } catch (e: any) { alert('Erreur : ' + e.message); }
        finally { setPermSaving(false); }
    };

    const Pager = ({ cp, setCp, totalItems }: { cp: number; setCp: (p: number) => void; totalItems: number }) => {
        // En remplaçant par cp/setCp/totalItems on évite la collision variable avec le hook du haut
        const pages = Math.ceil(totalItems / PAGE_SIZE) || 1;
        if (pages <= 1) return null;
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                <button onClick={() => setCp(cp - 1)} disabled={cp <= 1} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: cp <= 1 ? 'not-allowed' : 'pointer', color: cp <= 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}><ChevronLeft size={16} /></button>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {cp} / {pages} · {totalItems} profils</span>
                <button onClick={() => setCp(cp + 1)} disabled={cp >= pages} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: cp >= pages ? 'not-allowed' : 'pointer', color: cp >= pages ? 'var(--text-muted)' : 'var(--text-primary)' }}><ChevronRight size={16} /></button>
            </div>
        );
    };

    const thStyle = { padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 };
    const tdStyle = { padding: '15px 20px' };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <PageHeader title="Droits d'Accès & Habilitations" subtitle="Gérez le personnel, leurs rôles, et forcez leurs droits d'accès granulaires de bout en bout." />

                <div style={{ position: 'relative', width: 320 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        value={search}
                        onChange={e => { setSearch(e.target.value); }}
                        placeholder="Rechercher nom, matricule, email..."
                        style={{ flex: '1 1 200px', width: '100%', padding: '12px 12px 12px 38px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14 }}
                    />
                </div>
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '12px 20px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{error}</span>
                    <button onClick={() => loadData()} style={{ padding: '6px 14px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Réessayer</button>
                </div>
            )}

            <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: 'var(--bg-primary)' }}>
                        <tr>
                            <th style={thStyle}>Profil Employé</th>
                            <th style={thStyle}>Agence / Rôle</th>
                            <th style={thStyle}>Statut Compte</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Actions Administratives</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && staffList.length === 0 ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement en cours...</td></tr>
                        ) : staffList.length === 0 ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun employé trouvé.</td></tr>
                        ) : staffList.map((s, idx) => (
                            <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none', background: s.status === 'PENDING' ? 'rgba(234, 179, 8, 0.05)' : (!s.isActive && s.status !== 'PENDING' ? 'rgba(239, 68, 68, 0.05)' : 'transparent') }}>
                                {/* PROFIL */}
                                <td style={tdStyle}>
                                    <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {s.name}
                                        {s.status === 'PENDING' && <span style={{ fontSize: 10, background: 'var(--warning)', color: '#fff', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>NOUVELLE RECRUE</span>}
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{s.email}</div>
                                    <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                                        <span style={{ fontSize: 10, border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: 4 }}>ID: {s.matricule}</span>
                                        {s.permissionsCustomized && (
                                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '1px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}><ShieldCheck size={10} /> FORCÉ</span>
                                        )}
                                    </div>
                                </td>
                                {/* AFFECTATION */}
                                <td style={tdStyle}>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                                        <Building size={14} /> {s.branch?.name || 'Direction Corporate'}
                                    </div>
                                    <div>
                                        <select value={roleFor(s)} onChange={e => setRoleSelection(sel => ({ ...sel, [s.id]: e.target.value }))} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13, color: getRoleColor(roleFor(s)), minWidth: 180 }}>
                                            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                                        </select>
                                    </div>
                                </td>
                                {/* STATUT */}
                                <td style={tdStyle}>
                                    {s.status === 'PENDING' ? (
                                        <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'var(--warning-bg)', color: 'var(--warning)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                            EN ATTENTE VALIDATION
                                        </span>
                                    ) : (
                                        <span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: s.isActive ? 'var(--success-bg)' : 'var(--danger-bg)', color: s.isActive ? 'var(--success)' : 'var(--danger)', border: `1px solid ${s.isActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}` }}>
                                            {s.isActive ? '✅ COMPTE ACTIF' : '🚫 SUSPENDU'}
                                        </span>
                                    )}
                                </td>
                                {/* ACTIONS */}
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        {/* Bouton d'enregistrement du ROLE si changé */}
                                        {roleFor(s) !== s.role && (
                                            <button onClick={() => handleUpdateActive(s)} disabled={savingId === s.id} style={{ padding: '8px 14px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                                Sauvegarder rôle
                                            </button>
                                        )}

                                        {/* Action principale selon PENDING ou ACTIVE */}
                                        {s.status === 'PENDING' ? (
                                            <button onClick={() => handleActivate(s)} disabled={savingId === s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                                                <ShieldCheck size={14} /> Activer Employé
                                            </button>
                                        ) : (
                                            <>
                                                <button onClick={() => openPermMatrix(s)} style={{ padding: '8px 14px', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                    <Lock size={13} /> Droits
                                                </button>
                                                <button onClick={() => toggleSuspend(s)} disabled={savingId === s.id} style={{ padding: '8px 14px', background: s.isActive ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', border: `1px solid ${s.isActive ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`, color: s.isActive ? 'var(--danger)' : 'var(--success)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                                    {s.isActive ? 'Suspendre' : 'Réactiver'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Pager cp={page} setCp={setPage} totalItems={total} />

            {/* ── MODALE : MATRICE DES PERMISSIONS ── */}
            {permStaff && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div className="card" style={{ padding: 28, width: '100%', maxWidth: 780, maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                            <div>
                                <h3 style={{ margin: 0, fontWeight: 800 }}>Configuration des Droits</h3>
                                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 4 }}>
                                    Employé(e) : <strong style={{ color: 'var(--text-primary)' }}>{permStaff.name}</strong> • Rôle source : <strong style={{ color: getRoleColor(permStaff.role) }}>{permStaff.role}</strong>
                                    {permData?.permissionsCustomized && (
                                        <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.2)' }}>⚠️ FORCE OVERRIDE</span>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setPermStaff(null)} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
                        </div>

                        {!permData ? (
                            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement de l'arbre des droits...</div>
                        ) : (
                            <>
                                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                                    Les cases sélectionnées représentent les autorisations <strong>effectives</strong>. En cas de remise aux valeurs par défaut, la matrice reflètera le standard strict du poste de {permStaff.role}.
                                </p>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                                    {/* Source de vérité = le catalogue renvoyé par le backend (permData.groups), pas la
                                        copie codée en dur PERM_GROUPS ci-dessus : celle-ci avait dérivé et omettait
                                        perm_treasury_approve, rendant ce droit impossible à consulter ou modifier depuis
                                        cette matrice pour n'importe quel employé, alors que le catalogue RBAC.ts (source
                                        réelle) le porte bien. PERM_GROUPS ne reste qu'un repli si le backend n'en renvoie
                                        pas (compat descendante). */}
                                    {(permData.groups && permData.groups.length > 0 ? permData.groups : PERM_GROUPS).map((group: { label: string; perms: string[] }) => (
                                        <div key={group.label}>
                                            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                                                {group.label}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {group.perms.map(perm => (
                                                    <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, background: checkedPerms.has(perm) ? 'rgba(99,102,241,0.04)' : 'transparent', padding: '6px 8px', borderRadius: 6 }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checkedPerms.has(perm)}
                                                            onChange={e => {
                                                                const next = new Set(checkedPerms);
                                                                e.target.checked ? next.add(perm) : next.delete(perm);
                                                                setCheckedPerms(next);
                                                            }}
                                                            style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
                                                        />
                                                        <span style={{ color: checkedPerms.has(perm) ? 'var(--text-primary)' : 'var(--text-muted)' }}>{PERM_LABELS[perm] || perm}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: 12, marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                                    <button onClick={savePermissions} disabled={permSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                                        <Save size={16} /> {permSaving ? 'Sauvegarde...' : 'Appliquer ces droits'}
                                    </button>
                                    <button onClick={resetPermissions} disabled={permSaving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                                        <RotateCcw size={15} /> Restaurer la charte ({permStaff.role})
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
