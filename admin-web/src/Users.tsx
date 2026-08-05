import { API_URL } from './config';
import { Briefcase, Store, User, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function UsersManagement({ token }: { token: string }) {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 10;

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
        return u.name?.toLowerCase().includes(lowSearch) || u.phone?.toLowerCase().includes(lowSearch);
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

    const getRoleIcon = (role: string) => {
        if (role === 'AGENT') return <Briefcase size={16} color="#4F46E5" />;
        if (role === 'MERCHANT') return <Store size={16} color="#F59E0B" />;
        if (role === 'ADMIN') return <UsersIcon size={16} color="#E11D48" />;
        return <User size={16} color="#10B981" />;
    };

    return (
        <div className="dashboard-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Gestion des Utilisateurs</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Filtrez, visualisez et superviez les comptes de l'écosystème.</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    style={{ padding: '12px 20px', backgroundColor: '#4F46E5', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                    <UserPlus size={18} /> Ajouter Profil Pro
                </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setFilter('')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === '' ? 'none' : '1px solid var(--border)', backgroundColor: filter === '' ? '#334155' : 'transparent', color: '#fff', cursor: 'pointer' }}>Tous</button>
                    <button onClick={() => setFilter('USER')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'USER' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'USER' ? '#10B981' : 'transparent', color: '#fff', cursor: 'pointer' }}>Clients</button>
                    <button onClick={() => setFilter('AGENT')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'AGENT' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'AGENT' ? '#4F46E5' : 'transparent', color: '#fff', cursor: 'pointer' }}>Agents</button>
                    <button onClick={() => setFilter('MERCHANT')} style={{ padding: '8px 16px', borderRadius: '20px', border: filter === 'MERCHANT' ? 'none' : '1px solid var(--border)', backgroundColor: filter === 'MERCHANT' ? '#F59E0B' : 'transparent', color: '#fff', cursor: 'pointer' }}>Marchands</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Rechercher par nom ou numéro..."
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)', color: 'white', width: '250px' }}
                    />
                </div>
            </div>

            <div className="stat-card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Utilisateur</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Téléphone</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Rôle</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Statut</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Solde</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.slice((currentPage - 1) * usersPerPage, currentPage * usersPerPage).map(u => (
                                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: u.isActive === false ? 0.6 : 1 }}>
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
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        {u.role !== 'ADMIN' && (
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => toggleStatus(u.id)} style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: u.isActive !== false ? '#E11D4820' : '#10B98120', color: u.isActive !== false ? '#E11D48' : '#10B981', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    {u.isActive !== false ? 'BLOQUER' : 'ACTIVER'}
                                                </button>
                                                <button onClick={() => resetPin(u.id)} style={{ padding: '6px 12px', fontSize: '12px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    RESET PIN
                                                </button>
                                            </div>
                                        )}
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
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-secondary)', color: currentPage === 1 ? 'var(--text-secondary)' : '#fff', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
                            Précédent
                        </button>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(Math.ceil(users.length / usersPerPage), p + 1))}
                            disabled={currentPage >= Math.ceil(users.length / usersPerPage)}
                            style={{ padding: '8px 16px', backgroundColor: 'var(--bg-secondary)', color: currentPage >= Math.ceil(users.length / usersPerPage) ? 'var(--text-secondary)' : '#fff', border: '1px solid var(--border)', borderRadius: '8px', cursor: currentPage >= Math.ceil(users.length / usersPerPage) ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
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
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Type de Profil</label>
                                <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white' }}>
                                    <option value="AGENT">Agent (Agence / Dépôt-Retrait)</option>
                                    <option value="MERCHANT">Marchand (Boutique / Vendeur Comptoir)</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Nom / Enseigne</label>
                                <input type="text" value={newName} onChange={e => setNewName(e.target.value)} required style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white' }} placeholder="Ex: Boutique Ali" />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Téléphone</label>
                                <input type="text" value={newPhone} onChange={e => setNewPhone(e.target.value)} required style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white' }} placeholder="+24177......." />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>PIN PROVISOIRE</label>
                                <input type="text" value={newPin} onChange={e => setNewPin(e.target.value)} required style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white' }} />
                            </div>

                            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                                <button type="button" onClick={() => setIsModalOpen(false)} style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', border: '1px solid var(--border)', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>Annuler</button>
                                <button type="submit" disabled={creating} style={{ flex: 1, padding: '12px', backgroundColor: '#4F46E5', border: 'none', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>{creating ? 'Création...' : 'Créer'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
