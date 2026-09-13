import { Trash2, UserCog, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, ENDPOINTS, isPortalViewer } from './api';
import { pickString } from './utils/format';

type Role = 'ADMIN' | 'VIEWER';

type TeamMember = {
    id: string;
    name?: string;
    phone?: string;
    role: Role;
    isActive: boolean;
    createdAt?: string;
};

// Membres d'équipe — GET/POST/PATCH/DELETE /api/merchant-portal/team, développées EN PARALLÈLE
// par l'agent backend (voir le commentaire au-dessus de ENDPOINTS.team dans api.ts : ces routes
// n'existent pas encore dans backend/src/routes/merchant-portal.ts au moment de l'écriture de
// cet écran). Un membre 'ADMIN' a les mêmes droits que le géant ; un 'VIEWER' est en lecture
// seule — le serveur renverrait 403 sur toute écriture tentée par un VIEWER, donc cet écran
// masque entièrement les actions d'écriture pour lui plutôt que de les afficher désactivées.
function normalizeMember(raw: any): TeamMember {
    return {
        id: raw.id,
        name: pickString(raw, ['name']),
        phone: pickString(raw, ['phone']),
        role: raw.role === 'ADMIN' ? 'ADMIN' : 'VIEWER',
        isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
        createdAt: raw.createdAt,
    };
}

function RoleBadge({ role }: { role: Role }) {
    return role === 'ADMIN'
        ? <span className="status-pill success">Admin</span>
        : <span className="status-pill neutral">Lecture seule</span>;
}

export default function Team({ onSessionExpired }: { onSessionExpired: () => void }) {
    const viewer = isPortalViewer();

    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState<Role>('VIEWER');
    const [submitting, setSubmitting] = useState(false);

    // Ligne en cours de modification (changement de rôle / activation / suppression) — désactive
    // ses propres boutons le temps de la requête, sans bloquer les autres lignes.
    const [busyId, setBusyId] = useState<string | null>(null);

    const handleAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.team);
            const list = Array.isArray(res) ? res : (res.members || res.data || res.team || []);
            setMembers((Array.isArray(list) ? list : []).map(normalizeMember));
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !name.trim() || !phone.trim()) return;
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            // 409 (téléphone déjà pris) remonte via apiRequest comme une Error normale
            // (data.error) — affichée telle quelle dans le bandeau, pas de traitement spécial.
            await apiRequest(ENDPOINTS.team, {
                method: 'POST',
                body: JSON.stringify({ name: name.trim(), phone: phone.trim(), role }),
            });
            setName('');
            setPhone('');
            setRole('VIEWER');
            setMessage('Membre invité avec succès.');
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleRoleChange = async (id: string, newRole: Role) => {
        setBusyId(id);
        setError('');
        try {
            await apiRequest(ENDPOINTS.teamById(id), { method: 'PATCH', body: JSON.stringify({ role: newRole }) });
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const handleToggleActive = async (member: TeamMember) => {
        setBusyId(member.id);
        setError('');
        try {
            await apiRequest(ENDPOINTS.teamById(member.id), { method: 'PATCH', body: JSON.stringify({ isActive: !member.isActive }) });
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("Supprimer ce membre de l'équipe ? Il perdra immédiatement l'accès au portail.")) return;
        setBusyId(id);
        setError('');
        try {
            await apiRequest(ENDPOINTS.teamById(id), { method: 'DELETE' });
            setMessage('Membre supprimé.');
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><UserCog size={22} /></div>
                    Équipe
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Membres ayant accès à ce portail avec votre compte marchand géant.</p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {message && <div className="banner success mb-8">{message}</div>}
            {viewer && (
                <div className="banner info mb-8">
                    Vous êtes connecté en lecture seule. Seul le géant principal ou un membre Admin peut gérer l'équipe.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: viewer ? '1fr' : '360px 1fr', gap: 32, alignItems: 'start' }}>
                {!viewer && (
                    <form onSubmit={handleAdd} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Inviter un membre</h2>
                        <div>
                            <label>Nom</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Jean Ondo" />
                        </div>
                        <div>
                            <label>Téléphone</label>
                            <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 074XXXXXX" />
                        </div>
                        <div>
                            <label>Rôle</label>
                            <select value={role} onChange={e => setRole(e.target.value as Role)}>
                                <option value="VIEWER">Lecture seule</option>
                                <option value="ADMIN">Admin (mêmes droits que vous)</option>
                            </select>
                        </div>
                        <button type="submit" disabled={submitting || !name.trim() || !phone.trim()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <UserPlus size={18} /> {submitting ? 'Envoi...' : 'Inviter'}
                        </button>
                    </form>
                )}

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Membre</th>
                                <th>Rôle</th>
                                <th>Statut</th>
                                {!viewer && <th style={{ textAlign: 'right' }}>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {members.map(m => (
                                <tr key={m.id}>
                                    <td>
                                        <div style={{ fontWeight: 700 }}>{m.name || 'Membre'}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.phone || '—'}</div>
                                    </td>
                                    <td><RoleBadge role={m.role} /></td>
                                    <td>
                                        <span className={`status-pill ${m.isActive ? 'success' : 'neutral'}`}>{m.isActive ? 'Actif' : 'Inactif'}</span>
                                    </td>
                                    {!viewer && (
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
                                                <select
                                                    value={m.role}
                                                    disabled={busyId === m.id}
                                                    onChange={e => handleRoleChange(m.id, e.target.value as Role)}
                                                    style={{ width: 'auto', padding: '8px 10px', fontSize: 12 }}
                                                >
                                                    <option value="VIEWER">Lecture seule</option>
                                                    <option value="ADMIN">Admin</option>
                                                </select>
                                                <button className="btn-secondary" disabled={busyId === m.id} onClick={() => handleToggleActive(m)} style={{ padding: '8px 14px', fontSize: 12 }}>
                                                    {m.isActive ? 'Désactiver' : 'Réactiver'}
                                                </button>
                                                <button className="btn-danger" disabled={busyId === m.id} onClick={() => handleDelete(m.id)}>
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {!loading && members.length === 0 && (
                                <tr><td colSpan={viewer ? 3 : 4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun membre d'équipe pour le moment.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
