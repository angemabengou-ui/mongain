import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';

// Page 1/3 du parcours d'onboarding — crée uniquement l'identité (statut "En attente").
// Le rôle et l'agence de rattachement se décident ensuite sur des pages séparées
// ("Affecter à une Agence" puis "Droits d'Accès") pour une vision plus claire de chaque
// étape, plutôt que de tout décider dans un seul écran/une seule modale.
export default function StaffCreate({ token }: { token: string }) {
    const [actionLoading, setActionLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [matricule, setMatricule] = useState('');
    const [cni, setCni] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [dob, setDob] = useState('');
    const [gender, setGender] = useState('MALE');
    const [emergencyPhone, setEmergencyPhone] = useState('');
    const [lastCreated, setLastCreated] = useState<string | null>(null);

    const handleCreateStaff = async (e: React.FormEvent) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/staff`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    email, name, password, matricule, cni,
                    phone, address, dob, gender, emergencyPhone,
                    role: 'TELLER', // valeur de départ sûre, reconfigurée à l'étape "Droits d'Accès"
                    branchId: undefined
                })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            setLastCreated(name);
            setEmail(''); setName(''); setPassword(''); setMatricule(''); setCni('');
            setPhone(''); setAddress(''); setDob(''); setGender('MALE'); setEmergencyPhone('');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="1. Créer un Utilisateur" subtitle="Identité et dossier RH uniquement — le rôle et l'agence se configurent ensuite sur des pages dédiées." />
            </div>

            {lastCreated && (
                <div style={{ padding: 16, background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 10, marginBottom: 24, fontWeight: 600, fontSize: 14 }}>
                    ✓ {lastCreated} a été créé(e) (statut « En attente »). Rendez-vous sur <strong>« 2. Affecter à une Agence »</strong> pour la suite.
                </div>
            )}

            <div className="card" style={{ padding: 30 }}>
                <form onSubmit={handleCreateStaff}>
                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginBottom: 15, marginTop: 0 }}>Identité & État Civil</h4>
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
                            <select value={gender} onChange={e => setGender(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                                <option value="MALE">Homme</option>
                                <option value="FEMALE">Femme</option>
                            </select>
                        </div>
                    </div>

                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginTop: 20, marginBottom: 15 }}>Contact & Confidentialité</h4>
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

                    <h4 style={{ borderBottom: '1px solid var(--border)', paddingBottom: 5, color: 'var(--accent)', marginTop: 20, marginBottom: 15 }}>Documentation</h4>
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

                    <div style={{ marginBottom: 25 }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Mot de Passe Provisoire</label>
                        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Mot de passe provisoire" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }} required minLength={6} />
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>L'utilisateur devra le changer à sa première connexion.</p>
                    </div>

                    <button type="submit" disabled={actionLoading} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15 }}>
                        <UserPlus size={18} /> {actionLoading ? 'Création...' : "Créer l'utilisateur"}
                    </button>
                </form>
            </div>
        </div>
    );
}
