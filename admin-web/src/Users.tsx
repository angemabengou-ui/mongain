import { AlertTriangle, Briefcase, Search, Store, User, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';
import Customer360 from './Customer360';

const KYC_STATUS_LABELS: Record<string, string> = {
    UNVERIFIED: 'Non vérifié',
    PENDING: 'En attente',
    APPROVED: 'Approuvé',
    REJECTED: 'Rejeté',
};

export default function UsersManagement({ token, staffRole, hasPerm, lockedRole, initialSelectedUserId }: { token: string; staffRole?: string; hasPerm: (perms: string[]) => boolean; lockedRole?: 'AGENT'; initialSelectedUserId?: string }) {
    const [users, setUsers] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Pagination & Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [statusFilter, setStatusFilter] = useState('');
    const [kycFilter, setKycFilter] = useState('');
    // Segment de compte. Clients et Marchands sont des tiers externes autonomes (le
    // client s'inscrit lui-même depuis son téléphone) : ils partagent cet écran via un
    // sélecteur. Les Agents, eux, NE sont PAS un segment client — ce sont des comptes
    // qui opèrent pour Mongain au sein d'une agence, donc rattachés à l'Organisation
    // (voir prop `lockedRole`, utilisée par l'entrée "Agents Mongain" du menu
    // Organisation Interne) plutôt que sélectionnables ici au même titre qu'un client.
    const [roleFilter, setRoleFilter] = useState<'USER' | 'AGENT' | 'MERCHANT' | 'ALL'>(lockedRole || 'USER');
    const limit = 20;
    const isAgentView = lockedRole === 'AGENT';

    // Slide-over CRM 360
    const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

    // Arrivée depuis la recherche globale (barre du haut) : ouvre directement la fiche
    // client visée sans forcer l'admin à la retrouver dans la liste paginée.
    useEffect(() => { if (initialSelectedUserId) setSelectedUserId(initialSelectedUserId); }, [initialSelectedUserId]);

    // Create Pro (Merchant) state — les Agents ne se créent plus ici : un vrai agent
    // doit être rattaché à une agence via Organisation Interne > Gestion du Personnel
    // (rôle TELLER), qui donne les droits opérationnels réels (session de caisse, coffre
    // physique). Ce formulaire ne crée donc plus que des comptes Marchand.
    const [showCreatePro, setShowCreatePro] = useState(false);
    const [proPhone, setProPhone] = useState('');
    const [proName, setProName] = useState('');
    const [proPin, setProPin] = useState('');
    const [createLoading, setCreateLoading] = useState(false);

    // Rattachement agence (vue Agents uniquement)
    const [branches, setBranches] = useState<any[]>([]);

    useEffect(() => {
        if (!isAgentView) return;
        fetch(`${API_URL}/api/admin/branches?limit=200`, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json())
            .then(d => setBranches(Array.isArray(d) ? d : (d.branches || [])))
            .catch(console.error);
    }, [isAgentView, token]);

    const assignBranch = async (userId: string, branchId: string) => {
        try {
            const r = await fetch(`${API_URL}/api/admin/users/${userId}/branch`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ branchId: branchId || null })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            fetchCustomers(searchTerm, currentPage, statusFilter, kycFilter, roleFilter);
        } catch (e: any) {
            alert(e.message);
        }
    };

    const fetchCustomers = async (query: string = '', page: number = 1, stat: string = '', kyc: string = '', segment: string = roleFilter) => {
        setLoading(true);
        try {
            let url = `${API_URL}/api/admin/customers?page=${page}&limit=${limit}&role=${segment}`;
            if (query) url += `&q=${encodeURIComponent(query)}`;
            if (stat) url += `&status=${stat}`;
            if (kyc) url += `&kycStatus=${kyc}`;

            const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            // Sans ce cas, un 403 (ex: rôle non habilité pour ce segment) laissait croire
            // à une liste vide au lieu d'un accès refusé.
            if (resp.ok) {
                const data = await resp.json();
                setUsers(data.customers || []);
                setTotal(data.total || 0);
                setError('');
            } else {
                const data = await resp.json().catch(() => ({}));
                setUsers([]);
                setError(data.error || 'Accès à la liste des comptes refusé.');
            }
        } catch (e) {
            console.error(e);
            setUsers([]);
            setError('Impossible de contacter le serveur.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers(searchTerm, currentPage, statusFilter, kycFilter, roleFilter);
    }, [currentPage, statusFilter, kycFilter, roleFilter, token]);

    const handleSearch = () => {
        setCurrentPage(1);
        fetchCustomers(searchTerm, 1, statusFilter, kycFilter, roleFilter);
    };

    const getRoleIcon = (role?: string) => {
        if (role === 'AGENT') return <Briefcase size={16} color="var(--accent)" />;
        if (role === 'MERCHANT') return <Store size={16} color="var(--warning)" />;
        if (role === 'ADMIN') return <UsersIcon size={16} color="var(--danger)" />;
        return <User size={16} color="var(--success)" />;
    };

    if (selectedUserId) {
        return <Customer360 token={token} userId={selectedUserId} onBack={() => setSelectedUserId(null)} staffRole={staffRole} hasPerm={hasPerm} />;
    }

    const handleCreatePro = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateLoading(true);
        try {
            const res = await fetch(`${API_URL}/api/admin/users/create-pro`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ phone: proPhone, name: proName, role: 'MERCHANT', pin: proPin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            alert('Compte marchand créé avec succès.');
            setShowCreatePro(false);
            setProPhone(''); setProName(''); setProPin('');
            // Bascule sur le segment Marchands — sinon le compte reste invisible tant que
            // le segment précédent reste sélectionné, ce qui donnait l'impression que la
            // création avait échoué silencieusement.
            setRoleFilter('MERCHANT');
            setCurrentPage(1);
            fetchCustomers(searchTerm, 1, statusFilter, kycFilter, 'MERCHANT');
        } catch (err: any) {
            alert(err.message);
        } finally {
            setCreateLoading(false);
        }
    };

    return (
        <div className="dashboard-content" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>{isAgentView ? 'Agents Mongain (réseau historique)' : 'Comptes Clients & Marchands (C-360)'}</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>
                        {isAgentView
                            ? "Comptes Agent créés avant le système d'agences. Pour un nouvel agent rattaché à une agence avec les droits opérationnels complets (session de caisse, coffre), utilisez Organisation Interne > Gestion du Personnel."
                            : "Comptes auto-inscrits depuis l'app mobile (clients) ou créés ici (marchands) — retrouvez, identifiez et analysez-les grâce à la vue 360."}
                    </p>
                </div>
                {staffRole === 'SUPER_ADMIN' && !isAgentView && (
                    <button onClick={() => setShowCreatePro(true)} className="btn-primary" style={{ width: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Briefcase size={18} /> Créer Compte Marchand
                    </button>
                )}
            </div>

            {!isAgentView && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                    {[
                        { val: 'USER', label: 'Clients' },
                        { val: 'MERCHANT', label: 'Marchands' },
                        { val: 'ALL', label: 'Tous' },
                    ].map(seg => (
                        <button
                            key={seg.val}
                            onClick={() => { setRoleFilter(seg.val as any); setCurrentPage(1); }}
                            style={{
                                padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                                border: `1px solid ${roleFilter === seg.val ? 'var(--accent)' : 'var(--border)'}`,
                                background: roleFilter === seg.val ? 'var(--accent)' : 'var(--bg-card)',
                                color: roleFilter === seg.val ? '#fff' : 'var(--text-primary)',
                            }}
                        >
                            {seg.label}
                        </button>
                    ))}
                </div>
            )}

            <div style={{
                display: 'flex',
                gap: '16px',
                marginBottom: '24px',
                flexWrap: 'wrap',
                alignItems: 'center'
            }}>
                <div style={{ display: 'flex', gap: '8px', flex: '1 1 300px', maxWidth: '500px' }}>
                    <input
                        type="text"
                        placeholder="Recherche : Nom, Tel, ID Client, Réf TX..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        style={{ flex: 1, padding: '10px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button onClick={handleSearch} className="btn-primary" style={{ width: 'auto', padding: '0 20px', display: 'flex', gap: '8px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                        <Search size={18} /> <span className="hide-mobile">Rechercher</span>
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', flex: '1 1 auto' }}>
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ flex: '1 1 180px', maxWidth: '250px', padding: '10px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <option value="">Tous les Statuts</option>
                        <option value="ACTIVE">Actif</option>
                        <option value="SUSPENDED">Suspendu</option>
                        <option value="FROZEN">Gelé (Freeze)</option>
                        <option value="CLOSED">Clôturé</option>
                    </select>

                    <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)} style={{ flex: '1 1 180px', maxWidth: '250px', padding: '10px 16px', borderRadius: '8px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <option value="">Tous les Niveaux KYC</option>
                        <option value="UNVERIFIED">Non Vérifié (Tier 0)</option>
                        <option value="PENDING">En Revue KYC</option>
                        <option value="APPROVED">Vérifié (Tier 1/2)</option>
                        <option value="REJECTED">Rejeté</option>
                    </select>
                </div>
            </div>

            <div className="stat-card" style={{ padding: 0, overflow: 'hidden', overflowX: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>Recherche dans la base de données...</div>
                ) : (
                    <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>{isAgentView ? 'Identité Agent' : 'Identité Client'}</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Téléphone</th>
                                {isAgentView && <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Agence</th>}
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Statut KYC</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Activité Réc.</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Risque</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Statut Compte</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id}
                                    onClick={() => setSelectedUserId(u.id)}
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'background 0.2s',
                                        opacity: u.accountStatus !== 'ACTIVE' ? 0.6 : 1,
                                        borderBottom: '1px solid var(--border)'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'}
                                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    <td style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: '40px', height: '40px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {getRoleIcon(u.role)}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 'bold' }}>{u.name}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ID: {u.id.substring(0, 8)}</div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px' }}><div style={{ color: 'var(--accent)', fontWeight: 'bold', fontFamily: 'monospace' }}>{u.accountNumber || 'Non assigné'}</div><div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{u.phone}</div></td>

                                    {isAgentView && (
                                        <td style={{ padding: '16px' }} onClick={e => e.stopPropagation()}>
                                            <select
                                                value={u.branchId || ''}
                                                onChange={e => assignBranch(u.id, e.target.value)}
                                                style={{ padding: '6px 10px', borderRadius: '6px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: u.branchId ? 'var(--text-primary)' : 'var(--warning)', fontSize: '13px' }}
                                            >
                                                <option value="">— Non rattaché —</option>
                                                {branches.map(b => (
                                                    <option key={b.id} value={b.id}>{b.name}</option>
                                                ))}
                                            </select>
                                        </td>
                                    )}

                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold',
                                            backgroundColor: u.kycStatus === 'UNVERIFIED' ? '#334155' : u.kycStatus === 'APPROVED' ? 'var(--success-bg)' : 'var(--warning-bg)',
                                            color: u.kycStatus === 'UNVERIFIED' ? '#94a3b8' : u.kycStatus === 'APPROVED' ? 'var(--success)' : 'var(--warning)',
                                            border: '1px solid var(--border)'
                                        }}>
                                            {KYC_STATUS_LABELS[u.kycStatus] || u.kycStatus}
                                        </span>
                                    </td>

                                    <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                        {u.wallet?.updatedAt ? new Date(u.wallet.updatedAt).toLocaleDateString('fr-FR') : '—'}
                                    </td>

                                    <td style={{ padding: '16px' }}>
                                        {u._count?.riskFlags > 0 ? (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--danger)', fontWeight: 600, fontSize: '13px' }}>
                                                <AlertTriangle size={14} /> {u._count.riskFlags} Flag(s)
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--success)', fontSize: '13px', fontWeight: 600 }}>Propre</span>
                                        )}
                                    </td>

                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold',
                                            backgroundColor: u.accountStatus === 'ACTIVE' ? 'var(--success-bg)' : 'var(--danger-bg)',
                                            color: u.accountStatus === 'ACTIVE' ? 'var(--success)' : 'var(--danger)',
                                            border: u.accountStatus !== 'ACTIVE' ? '1px solid var(--danger-bg)' : 'none'
                                        }}>
                                            {u.accountStatus === 'ACTIVE' ? 'ACTIF' : u.accountStatus}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={isAgentView ? 7 : 6} style={{ padding: '60px', textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                        <User size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                        <div>{error ? `⚠️ ${error}` : isAgentView ? 'Aucun agent correspondant.' : 'Aucun client correspondant trouvé sur la plateforme.'}</div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {total > limit && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Affichage de {((currentPage - 1) * limit) + 1} à {Math.min(currentPage * limit, total)} sur {total} clients (Page {currentPage})
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-card)', color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                            Précédent
                        </button>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(total / limit), p + 1))}
                            disabled={currentPage >= Math.ceil(total / limit)}
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-card)', color: currentPage >= Math.ceil(total / limit) ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage >= Math.ceil(total / limit) ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                            Suivant
                        </button>
                    </div>
                </div>
            )}
            {showCreatePro && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div className="card" style={{ width: '400px', backgroundColor: 'var(--bg-card)' }}>
                        <h3 style={{ marginBottom: '20px', color: 'var(--text-primary)' }}>Nouveau Compte Marchand</h3>
                        <form onSubmit={handleCreatePro} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Téléphone (+241...)</label>
                                <input type="text" value={proPhone} onChange={e => setProPhone(e.target.value)} placeholder="+241xxxxxxx" required />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Nom de l'Entité</label>
                                <input type="text" value={proName} onChange={e => setProName(e.target.value)} required />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 600 }}>Code PIN Initial (4 chiffres)</label>
                                <input type="password" value={proPin} onChange={e => setProPin(e.target.value)} minLength={4} maxLength={4} required />
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                                <button type="button" onClick={() => setShowCreatePro(false)} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}>Annuler</button>
                                <button type="submit" disabled={createLoading} className="btn-primary" style={{ flex: 1, padding: '12px' }}>
                                    {createLoading ? 'Création...' : 'Créer Compte'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}



