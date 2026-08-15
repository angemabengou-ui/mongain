import { Briefcase, Building, Edit2, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function StaffCRM({ token }: { token: string }) {
    const [staff, setStaff] = useState<any[]>([]);
    const [branches, setBranches] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Create Modal states
    const [showCreate, setShowCreate] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);

    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('TELLER');
    const [branchId, setBranchId] = useState('');
    const [matricule, setMatricule] = useState('');
    const [cni, setCni] = useState('');

    // EXHAUSTIVE HR FIELDS
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [dob, setDob] = useState('');
    const [gender, setGender] = useState('MALE');
    const [emergencyPhone, setEmergencyPhone] = useState('');

    // Edit Modal states
    const [editingStaff, setEditingStaff] = useState<any>(null);
    const [editRole, setEditRole] = useState('TELLER');
    const [editBranchId, setEditBranchId] = useState('');
    const [editIsActive, setEditIsActive] = useState(true);

    const fetchData = async () => {
        try {
            const [respStaff, respBranches] = await Promise.all([
                fetch(API_URL + '/api/admin/staff', { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(API_URL + '/api/admin/branches', { headers: { 'Authorization': `Bearer ${token}` } })
            ]);

            if (!respStaff.ok) throw new Error('Erreur chargement staff');

            setStaff(await respStaff.json());
            setBranches(await respBranches.json());
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [token]);

    const handleCreateStaff = async (e: React.FormEvent) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/staff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    email, name, password, role, matricule, cni,
                    phone, address, dob, gender, emergencyPhone,
                    branchId: branchId || undefined
                })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            alert(data.message);
            setShowCreate(false);

            // Reset state
            setEmail(''); setName(''); setPassword(''); setRole('TELLER'); setBranchId(''); setMatricule(''); setCni('');
            setPhone(''); setAddress(''); setDob(''); setGender('MALE'); setEmergencyPhone('');

            fetchData();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleEditStaff = async (e: React.FormEvent) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/staff/${editingStaff.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ role: editRole, branchId: editBranchId || undefined, isActive: editIsActive })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            alert(data.message);
            setEditingStaff(null);
            fetchData();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleApprove = async (staffId: string) => {
        if (!window.confirm("Voulez-vous officiellement valider cette accréditation bancaire ?")) return;

        try {
            const resp = await fetch(`${API_URL}/api/admin/staff/${staffId}/approve`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            alert(data.message);
            fetchData();
        } catch (e: any) {
            alert(e.message);
        }
    };

    if (loading) return <div>Chargement de l'organigramme...</div>;

    const getRoleColor = (r: string) => {
        if (r === 'SUPER_ADMIN') return 'var(--accent)';
        if (r === 'RISK' || r === 'COMPLIANCE_CHECKER') return '#f59e0b';
        if (r === 'BRANCH_MANAGER') return '#10b981';
        return '#64748b';
    };

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700 }}>Personnel & Habilitations</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Organigramme Corporate et attribution stricte des rôles (Maker-Checker).</p>
                </div>
                <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                    <UserPlus size={18} /> Instruire un Dossier RH (Employé)
                </button>
            </div>

            {error && <div style={{ color: 'red', marginBottom: 20 }}>{error}</div>}

            <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: 'var(--bg-primary)' }}>
                        <tr>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Garde / Nom</th>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Rôle RBAC</th>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Succursale</th>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Matricule</th>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 }}>Statut</th>
                            <th style={{ padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13, textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {staff.map((s, idx) => (
                            <tr key={s.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                <td style={{ padding: '15px 20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
                                            {s.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.email}</div>
                                        </div>
                                    </div>
                                </td>
                                <td style={{ padding: '15px 20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: getRoleColor(s.role), fontWeight: 600, fontSize: 13 }}>
                                        <ShieldCheck size={16} />
                                        {s.role}
                                    </div>
                                </td>
                                <td style={{ padding: '15px 20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 14 }}>
                                        {s.branch ? <><Building size={16} /> {s.branch.name}</> : <><Briefcase size={16} /> Siège Général</>}
                                    </div>
                                </td>
                                <td style={{ padding: '15px 20px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'monospace' }}>
                                        {s.matricule || 'N/A'}
                                    </div>
                                </td>
                                <td style={{ padding: '15px 20px' }}>
                                    {s.status === 'PENDING' ? (
                                        <button onClick={() => handleApprove(s.id)} style={{ padding: '6px 12px', background: 'var(--accent)', color: 'white', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                            APPROUVER
                                        </button>
                                    ) : (
                                        <div style={{
                                            display: 'inline-block', padding: '4px 10px', borderRadius: 20,
                                            fontSize: 12, fontWeight: 700,
                                            background: s.isActive ? (s.status === 'ACTIVE' ? '#ecfdf5' : '#fef2f2') : '#fef2f2',
                                            color: s.isActive ? (s.status === 'ACTIVE' ? '#10b981' : '#ef4444') : '#ef4444'
                                        }}>
                                            {s.isActive ? s.status : 'SUSPENDU'}
                                        </div>
                                    )}
                                </td>
                                <td style={{ padding: '15px 20px', textAlign: 'right' }}>
                                    <button onClick={() => {
                                        setEditingStaff(s);
                                        setEditRole(s.role);
                                        setEditBranchId(s.branchId || '');
                                        setEditIsActive(s.isActive);
                                    }} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '6px', borderRadius: '6px', color: 'var(--text-secondary)', cursor: 'pointer' }} title="Modifier Mutation">
                                        <Edit2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Modal Create Staff (Dossier RH Exhaustif) */}
            {showCreate && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 600, padding: 30, maxHeight: '90vh', overflowY: 'auto' }}>
                        <h3 style={{ marginTop: 0, marginBottom: 5 }}>Fiche du Personnel & Contrat RH</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>Remplissez intégralement le dossier de confidentialité pour accréditer ce profil institutionnel.</p>

                        <form onSubmit={handleCreateStaff}>

                            <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginBottom: 15 }}>1. Identité & État Civil</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nom Complet</label>
                                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Jean Dupont" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Email (Identifiant de Connexion)</label>
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jean@mongain.com" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Date de Naissance</label>
                                    <input type="date" value={dob} onChange={e => setDob(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Genre</label>
                                    <select value={gender} onChange={e => setGender(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}>
                                        <option value="MALE">Homme</option>
                                        <option value="FEMALE">Femme</option>
                                    </select>
                                </div>
                            </div>

                            <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginTop: 20, marginBottom: 15 }}>2. Contact & Confidentialité</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>N° Téléphone Personnel</label>
                                    <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="077..." style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Contact d'Urgence</label>
                                    <input value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} placeholder="066..." style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                            </div>

                            <div style={{ marginBottom: 15 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Adresse de Résidence</label>
                                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Quartier, Ville, B.P." style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                            </div>

                            <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginTop: 20, marginBottom: 15 }}>3. Documentation V-Bancaire</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Matricule RH Attribué</label>
                                    <input value={matricule} onChange={e => setMatricule(e.target.value)} placeholder="Ex: MONG-1049" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>N° Pièce d'Identité (CNI)</label>
                                    <input value={cni} onChange={e => setCni(e.target.value)} placeholder="Ex: GAB-00994" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 25 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rôle & Sécurité (RBAC)</label>
                                    <select value={role} onChange={e => setRole(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}>
                                        <option value="TELLER">Teller (Caissier)</option>
                                        <option value="BRANCH_MANAGER">Branch Manager</option>
                                        <option value="COMPLIANCE_CHECKER">Compliance Checker</option>
                                        <option value="RISK">Risk Analyst</option>
                                        <option value="SUPPORT_MAKER">Support Maker</option>
                                        <option value="SUPER_ADMIN">Super Admin (HQ)</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Affectation</label>
                                    <select value={branchId} onChange={e => setBranchId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}>
                                        <option value="">Aucune (Siège Général)</option>
                                        {branches.filter(b => !b.isHQ).map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ marginBottom: 25 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Création du Sceau (Mot de Passe Intranet)</label>
                                <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Mot de passe provisoire" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required minLength={6} />
                            </div>

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={() => setShowCreate(false)} style={{ flex: 1, padding: 12, background: 'var(--bg-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>Annuler</button>
                                <button type="submit" disabled={actionLoading} style={{ flex: 2, padding: 12, background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Archiver et Déployer le Profil</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Edit Staff */}
            {editingStaff && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 500, padding: 30 }}>
                        <h3 style={{ marginTop: 0, marginBottom: 5 }}>Modifier la Fiche : {editingStaff.name}</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>Mutation de poste, changement de rôle RBAC ou suspension de contrat.</p>

                        <form onSubmit={handleEditStaff}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginBottom: 15 }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nouveau Rôle</label>
                                    <select value={editRole} onChange={e => setEditRole(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}>
                                        <option value="TELLER">Teller (Caissier)</option>
                                        <option value="BRANCH_MANAGER">Branch Manager</option>
                                        <option value="COMPLIANCE_CHECKER">Compliance Checker</option>
                                        <option value="RISK">Risk Analyst</option>
                                        <option value="SUPPORT_MAKER">Support Maker</option>
                                        <option value="SUPER_ADMIN">Super Admin (HQ)</option>
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nouvelle Affectation</label>
                                    <select value={editBranchId} onChange={e => setEditBranchId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white' }}>
                                        <option value="">Aucune (Siège Général)</option>
                                        {branches.filter(b => !b.isHQ).map(b => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ marginBottom: 25, display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input type="checkbox" id="isActiveCheck" checked={editIsActive} onChange={e => setEditIsActive(e.target.checked)} style={{ width: 16, height: 16 }} />
                                <label htmlFor="isActiveCheck" style={{ fontSize: 14, fontWeight: 600 }}>Cocher pour maintenir actif (Décocher pour SUSPENDRE / RENVOYER)</label>
                            </div>

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={() => setEditingStaff(null)} style={{ flex: 1, padding: 12, background: 'var(--bg-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>Annuler</button>
                                <button type="submit" disabled={actionLoading} style={{ flex: 2, padding: 12, background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Archiver l'Avenant / Mutation</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
