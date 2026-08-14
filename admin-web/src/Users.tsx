import { Briefcase, Lock, ShieldAlert, BadgeCheck as ShieldCheck, Store, User, UserPlus, Users as UsersIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function UsersManagement({ token }: { token: string }) {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 10;

    // Slide-over CRM 360
    const [selectedUser, setSelectedUser] = useState<any>(null);

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newPhone, setNewPhone] = useState('');
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('AGENT');
    const [newPin, setNewPin] = useState('1234');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/admin/users' + (filter ? `?role=${filter}` : ''), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) setUsers(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
        setCurrentPage(1); // Reset page on filter change
    }, [filter]);

    const filteredUsers = users.filter((u: any) => {
        if (!searchTerm) return true;
        const lowSearch = searchTerm.toLowerCase();
        return (
            u.name?.toLowerCase().includes(lowSearch) ||
            u.phone?.toLowerCase().includes(lowSearch) ||
            u.username?.toLowerCase().includes(lowSearch) ||
            u.email?.toLowerCase().includes(lowSearch)
        );
    });

    const handleCreatePro = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setCreating(true);
        try {
            const resp = await fetch(API_URL + '/api/admin/users/create-pro', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ phone: newPhone, name: newName, role: newRole, pin: newPin })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            setIsModalOpen(false);
            fetchUsers(); // Refresh
            alert(`Compte Pro (${newRole}) créé avec succès !`);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreating(false);
        }
    };

    const toggleStatus = async (userId: string) => {
        if (!window.confirm('Voulez-vous vraiment changer le statut de cet utilisateur ?')) return;
        try {
            const resp = await fetch(`${API_URL}/api/admin/users/${userId}/toggle-status`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) {
                alert(data.message);
                fetchUsers();
            } else alert(data.error);
        } catch (e) {
            console.error(e);
        }
    };

    const resetPin = async (userId: string) => {
        if (!window.confirm('Voulez-vous générer un nouveau PIN secret pour cet utilisateur ?')) return;
        try {
            const resp = await fetch(`${API_URL}/api/admin/users/${userId}/reset-pin`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) {
                alert(`${data.message}`);
            } else alert(data.error);
        } catch (e) {
            console.error(e);
        }
    };

    const deleteUser = async (userId: string) => {
        if (!window.confirm('🚨 ATTENTION : Voulez-vous vraiment supprimer définitivement cet utilisateur ? Cette action est irréversible.')) return;
        try {
            const resp = await fetch(`${API_URL}/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) {
                alert('Utilisateur supprimé avec succès.');
                fetchUsers();
            } else {
                alert(`Erreur : ${data.error}`);
            }
        } catch (e) {
            console.error(e);
            alert('Erreur réseau.');
        }
    };

    const getRoleIcon = (role: string) => {
        if (role === 'AGENT') return <Briefcase size={16} color="#4F46E5" />;
        if (role === 'MERCHANT') return <Store size={16} color="#F59E0B" />;
        if (role === 'ADMIN') return <UsersIcon size={16} color="#E11D48" />;
        return <User size={16} color="#10B981" />;
    };

    return (
        <div className="dashboard-content" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Base de Données Utilisateurs</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Filtrez, visualisez et superviez les comptes de l'écosystème Mongain.</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn-primary"
                    style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserPlus size={18} /> Créer un Profil Pro
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setFilter('')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === '' ? 'none' : '1px solid var(--border)', backgroundColor: filter === '' ? 'var(--text-primary)' : 'transparent', color: filter === '' ? 'var(--bg-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500' }}>Tous</button>
                    <button onClick={() => setFilter('USER')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'USER' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'USER' ? 'var(--success)' : 'transparent', color: filter === 'USER' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500' }}>Clients</button>
                    <button onClick={() => setFilter('AGENT')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'AGENT' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'AGENT' ? 'var(--accent)' : 'transparent', color: filter === 'AGENT' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500' }}>Agents</button>
                    <button onClick={() => setFilter('MERCHANT')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'MERCHANT' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'MERCHANT' ? 'var(--warning)' : 'transparent', color: filter === 'MERCHANT' ? 'white' : 'var(--text-secondary)', cursor: 'pointer', fontWeight: '500' }}>Marchands</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Rechercher par nom ou numéro..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                    />
                </div>
            </div>

            <div className="stat-card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Utilisateur</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Téléphone</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Pseudo</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>KYC Status</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Rôle</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Statut</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Solde</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.slice((currentPage - 1) * usersPerPage, currentPage * usersPerPage).map(u => (
                                <tr key={u.id}
                                    onClick={() => setSelectedUser(u)}
                                    style={{
                                        cursor: 'pointer',
                                        transition: 'background 0.2s',
                                        opacity: u.isActive === false ? 0.6 : 1
                                    }}>
                                    <td style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{ width: '40px', height: '40px', borderRadius: '20px', backgroundColor: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {getRoleIcon(u.role)}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 'bold' }}>{u.name}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ID: {u.id.substring(0, 8)}...</div>
                                        </div>
                                    </td>
                                    <td style={{ padding: '16px', fontFamily: 'monospace' }}>{u.phone}</td>
                                    <td style={{ padding: '16px', color: '#1DC5E9', fontWeight: '600' }}>
                                        {u.username ? `@${u.username}` : '---'}
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold',
                                            backgroundColor: u.kycStatus === 'UNVERIFIED' ? '#334155' : u.kycStatus === 'APPROVED' ? '#10B98120' : '#F59E0B20',
                                            color: u.kycStatus === 'UNVERIFIED' ? '#94a3b8' : u.kycStatus === 'APPROVED' ? '#10B981' : '#F59E0B',
                                            border: '1px solid var(--border)'
                                        }}>
                                            {u.kycStatus || 'UNVERIFIED'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold',
                                            backgroundColor: u.role === 'ADMIN' ? '#E11D4820' : u.role === 'AGENT' ? '#4F46E520' : u.role === 'MERCHANT' ? '#F59E0B20' : '#10B98120',
                                            color: u.role === 'ADMIN' ? '#E11D48' : u.role === 'AGENT' ? '#4F46E5' : u.role === 'MERCHANT' ? '#F59E0B' : '#10B981'
                                        }}>
                                            {u.role}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                                            backgroundColor: u.isActive !== false ? '#10B98120' : '#E11D4820',
                                            color: u.isActive !== false ? '#10B981' : '#E11D48'
                                        }}>
                                            {u.isActive !== false ? 'ACTIF' : 'SUSPENDU'}
                                        </span>
                                        {u.failedPinAttempts >= 3 && (
                                            <div style={{ marginTop: '8px' }}>
                                                <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', backgroundColor: '#E11D4820', color: '#E11D48', border: '1px solid #E11D4840' }}>
                                                    ⚠️ LOCKOUT SÉCURITÉ
                                                </span>
                                            </div>
                                        )}
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right', fontWeight: 'bold', color: '#10B981' }}>
                                        {u.wallet?.balance?.toLocaleString('fr-FR')} FCFA
                                    </td>
                                </tr>
                            ))}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Aucun utilisateur trouvé.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {users.length > usersPerPage && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        Affichage {((currentPage - 1) * usersPerPage) + 1} - {Math.min(currentPage * usersPerPage, users.length)} sur {users.length}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-card)', color: currentPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                            Précédent
                        </button>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(users.length / usersPerPage), p + 1))}
                            disabled={currentPage >= Math.ceil(users.length / usersPerPage)}
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-card)', color: currentPage >= Math.ceil(users.length / usersPerPage) ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage >= Math.ceil(users.length / usersPerPage) ? 'not-allowed' : 'pointer', fontWeight: '600' }}>
                            Suivant
                        </button>
                    </div>
                </div>
            )}

            {isModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ backgroundColor: 'var(--bg-primary)', padding: '32px', borderRadius: '16px', width: '100%', maxWidth: '400px' }}>
                        <h3 style={{ marginTop: 0, marginBottom: '20px' }}>Créer un Profil Professionnel</h3>
                        {error && <div style={{ marginBottom: '16px', color: 'var(--danger)', fontSize: '14px' }}>{error}</div>}
                        <form onSubmit={handleCreatePro} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: '600' }}>Type de Profil</label>
                                <select value={newRole} onChange={e => setNewRole(e.target.value)}>
                                    <option value="AGENT">Agent (Agence / Dépôt-Retrait)</option>
                                    <option value="MERCHANT">Marchand (Boutique / Vendeur Comptoir)</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: '600' }}>Nom / Enseigne</label>
                                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required placeholder="Ex: Boutique Ali" />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: '600' }}>Téléphone</label>
                                <input type="text" value={newPhone} onChange={e => setNewPhone(e.target.value)} required placeholder="+24177......." />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: '600' }}>PIN PROVISOIRE</label>
                                <input type="text" value={newPin} onChange={e => setNewPin(e.target.value)} required />
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}>Annuler</button>
                                <button type="submit" disabled={creating} className="btn-primary" style={{ flex: 1 }}>{creating ? 'Création...' : 'Créer le profil'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* CRM 360-View Panel */}
            {selectedUser && (
                <div style={{
                    position: 'fixed', top: 0, right: 0, width: '450px', height: '100vh',
                    backgroundColor: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-lg)', zIndex: 50, padding: '32px',
                    overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px'
                }}>
                    <div className="flex-between">
                        <h3 style={{ fontSize: '20px' }}>Profil Utilisateur</h3>
                        <button onClick={() => setSelectedUser(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <X size={24} />
                        </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '24px', backgroundColor: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '32px', backgroundColor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
                            {selectedUser.name?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{selectedUser.name}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{selectedUser.phone}</div>
                            {selectedUser.username && <div style={{ color: 'var(--accent)', fontSize: '13px' }}>@{selectedUser.username}</div>}
                        </div>
                    </div>

                    <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 0 }}>
                        <div className="stat-card" style={{ padding: '20px' }}>
                            <div className="stat-label">Solde Portefeuille</div>
                            <div className="stat-value" style={{ fontSize: '24px', color: 'var(--success)' }}>{selectedUser.wallet?.balance?.toLocaleString('fr-FR')} F</div>
                        </div>
                        <div className="stat-card" style={{ padding: '20px' }}>
                            <div className="stat-label">Statut KYC</div>
                            <div style={{ marginTop: '8px' }}>
                                <span className={`status-pill ${selectedUser.kycStatus === 'UNVERIFIED' ? 'neutral' : selectedUser.kycStatus === 'APPROVED' ? 'success' : 'warning'}`}>
                                    {selectedUser.kycStatus || 'UNVERIFIED'}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h4 style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.5px', marginBottom: '16px' }}>
                            Actions Administratives
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button onClick={() => { toggleStatus(selectedUser.id); setSelectedUser({ ...selectedUser, isActive: !selectedUser.isActive }); }}
                                style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: selectedUser.isActive === false ? 'var(--success-bg)' : 'var(--danger-bg)', color: selectedUser.isActive === false ? 'var(--success)' : 'var(--danger)', border: '1px solid transparent', borderRadius: '12px', cursor: 'pointer', fontWeight: '600' }}>
                                {selectedUser.isActive === false ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
                                {selectedUser.isActive === false ? 'Réactiver le compte' : 'Suspendre le compte'}
                            </button>
                            <button onClick={() => resetPin(selectedUser.id)}
                                style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '12px', cursor: 'pointer', fontWeight: '600' }}>
                                <Lock size={20} />
                                Générer un nouveau code PIN
                            </button>
                            <button onClick={() => { deleteUser(selectedUser.id); setSelectedUser(null); }}
                                style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--bg-primary)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', marginTop: '16px' }}>
                                🗑️ Clôturer définitivement le compte
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
