import { Trash2, UserCog, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, canManageTeam, ENDPOINTS, getPortalRole, type PortalRole } from './api';
import { pickString } from './utils/format';

type Role = PortalRole;

const ROLE_OPTIONS: { value: Role; label: string }[] = [
    { value: 'ADMIN', label: 'Admin (tous les droits)' },
    { value: 'MANAGER', label: "Manager (tout sauf gérer l'équipe)" },
    { value: 'OPERATOR', label: 'Opérateur (paiements et retraits)' },
    { value: 'AUDITOR', label: 'Auditeur (lecture seule)' },
];

type TeamMember = {
    id: string;
    name?: string;
    phone?: string;
    role: Role;
    isActive: boolean;
    createdAt?: string;
};

// Membres d'équipe — GET/POST/PATCH/DELETE /api/merchant-portal/team, développées EN PARALLÈLE
// par l'agent backend. À la date d'écriture de cet écran, ces routes acceptent encore
// uniquement 'ADMIN'|'VIEWER' (vérifié dans backend/src/routes/merchant-portal.ts) : l'agent
// backend doit encore les faire évoluer vers les 4 rôles documentés ci-dessous, en parallèle de
// ce travail front. On développe donc contre la forme cible (4 rôles) ; normalizeMember reste
// défensif sur toute valeur inattendue (repli sur 'AUDITOR', le plus restrictif).
function normalizeMember(raw: any): TeamMember {
    const rawRole = raw.role;
    const role: Role = (rawRole === 'ADMIN' || rawRole === 'MANAGER' || rawRole === 'OPERATOR' || rawRole === 'AUDITOR')
        ? rawRole
        : 'AUDITOR'; // valeur inconnue (ou ancien 'VIEWER' pas encore migré) -> le plus restrictif, jamais ADMIN par défaut
    return {
        id: raw.id,
        name: pickString(raw, ['name']),
        phone: pickString(raw, ['phone']),
        role,
        isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
        createdAt: raw.createdAt,
    };
}

function RoleBadge({ role }: { role: Role }) {
    switch (role) {
        case 'ADMIN': return <span className="status-pill success">Admin</span>;
        case 'MANAGER': return <span className="status-pill info">Manager</span>;
        case 'OPERATOR': return <span className="status-pill warning">Opérateur</span>;
        default: return <span className="status-pill neutral">Auditeur</span>;
    }
}

export default function Team({ onSessionExpired }: { onSessionExpired: () => void }) {
    // Seul un ADMIN gère l'équipe (inviter, changer de rôle, désactiver, supprimer) — MANAGER,
    // OPERATOR et AUDITOR voient tous la liste en lecture seule, quels que soient leurs autres
    // droits par ailleurs (ex: un MANAGER peut exécuter des paiements mais pas gérer l'équipe).
    const canManage = canManageTeam();
    // Bandeau "lecture seule" : QUE pour AUDITOR, jamais pour MANAGER/OPERATOR — ceux-ci ont des
    // droits d'exécution ailleurs dans le portail, ce serait trompeur de les qualifier de
    // "connectés en lecture seule" simplement parce qu'ils ne gèrent pas l'équipe.
    const isAuditor = getPortalRole() === 'AUDITOR';

    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState<Role>('AUDITOR');
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
            setRole('AUDITOR');
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
            {isAuditor && (
                <div className="banner info mb-8">
                    Vous êtes connecté en lecture seule. Seul un Admin peut gérer l'équipe.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: canManage ? '360px 1fr' : '1fr', gap: 32, alignItems: 'start' }}>
                {canManage && (
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
                                {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
                                {canManage && <th style={{ textAlign: 'right' }}>Actions</th>}
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
                                    {canManage && (
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
                                                <select
                                                    value={m.role}
                                                    disabled={busyId === m.id}
                                                    onChange={e => handleRoleChange(m.id, e.target.value as Role)}
                                                    style={{ width: 'auto', padding: '8px 10px', fontSize: 12 }}
                                                >
                                                    {ROLE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
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
                                <tr><td colSpan={canManage ? 4 : 3} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun membre d'équipe pour le moment.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
