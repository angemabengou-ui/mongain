import { Store, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, canExecutePayments, ENDPOINTS } from './api';
import { pickString } from './utils/format';

type Till = {
    id: string;
    name?: string;
    phone?: string;
    isActive: boolean;
    createdAt?: string;
};

// Guichets — GET/POST/DELETE /api/merchant-portal/tills, développées EN PARALLÈLE par l'agent
// backend (absentes de backend/src/routes/merchant-portal.ts au moment de l'écriture de cet
// écran, forme construite sur la spécification transmise). Un guichet est un point
// d'encaissement physique (caisse ou agent au comptoir) qui se connecte avec son propre
// téléphone et code PIN à 4 chiffres — PAS un accès à ce portail web, qui reste réservé aux
// membres d'équipe gérés depuis l'écran "Équipe". DELETE désactive (soft-delete, même pattern
// que le répertoire d'employés) plutôt que de supprimer réellement.
function normalizeTill(raw: any): Till {
    return {
        id: raw.id,
        name: pickString(raw, ['name']),
        phone: pickString(raw, ['phone']),
        isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
        createdAt: raw.createdAt,
    };
}

export default function Tills({ onSessionExpired }: { onSessionExpired: () => void }) {
    // Lecture ouverte à tous les rôles ; écriture (créer/désactiver) pour tout rôle SAUF AUDITOR
    // — même prédicat que paiements/retraits/employés (voir canExecutePayments() dans api.ts,
    // dont le commentaire inclut déjà explicitement les guichets dans son périmètre).
    const canWrite = canExecutePayments();

    const [tills, setTills] = useState<Till[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [busyId, setBusyId] = useState<string | null>(null);

    const handleAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.tills);
            const list = Array.isArray(res) ? res : (res.tills || res.data || []);
            setTills((Array.isArray(list) ? list : []).map(normalizeTill));
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const pinValid = /^\d{4}$/.test(pin);
    const isValid = name.trim().length > 0 && phone.trim().length > 0 && pinValid && pin === pinConfirm;

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !isValid) return;
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            // 409 (téléphone déjà pris) remonte via apiRequest comme une Error normale
            // (data.error) — affichée telle quelle dans le bandeau, pas de traitement spécial.
            await apiRequest(ENDPOINTS.tills, {
                method: 'POST',
                body: JSON.stringify({ name: name.trim(), phone: phone.trim(), pin }),
            });
            setName('');
            setPhone('');
            setPin('');
            setPinConfirm('');
            setMessage('Guichet créé avec succès.');
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeactivate = async (till: Till) => {
        if (!window.confirm(`Désactiver le guichet "${till.name || till.phone}" ? Il ne pourra plus se connecter.`)) return;
        setBusyId(till.id);
        setError('');
        try {
            await apiRequest(ENDPOINTS.tillById(till.id), { method: 'DELETE' });
            setMessage('Guichet désactivé.');
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
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><Store size={22} /></div>
                    Guichets
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                    Points d'encaissement physiques (caisse ou agent au comptoir) qui se connectent avec leur propre téléphone et code PIN, indépendamment des membres ayant accès à ce portail web.
                </p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {message && <div className="banner success mb-8">{message}</div>}
            {!canWrite && (
                <div className="banner info mb-8">
                    Vous êtes connecté en lecture seule. Seuls Admin, Manager et Opérateur peuvent créer ou désactiver un guichet.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: canWrite ? '360px 1fr' : '1fr', gap: 32, alignItems: 'start' }}>
                {canWrite && (
                    <form onSubmit={handleAdd} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Créer un guichet</h2>
                        <div>
                            <label>Nom</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Caisse 1" />
                        </div>
                        <div>
                            <label>Téléphone</label>
                            <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ex: 074XXXXXX" />
                        </div>
                        <div>
                            <label>Code PIN (4 chiffres)</label>
                            <input
                                type="password" inputMode="numeric" maxLength={4} value={pin}
                                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                placeholder="••••"
                            />
                        </div>
                        <div>
                            <label>Confirmer le PIN</label>
                            <input
                                type="password" inputMode="numeric" maxLength={4} value={pinConfirm}
                                onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                placeholder="••••"
                            />
                            {pinConfirm.length === 4 && pin !== pinConfirm && (
                                <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>Les deux codes PIN ne correspondent pas.</p>
                            )}
                        </div>
                        <button type="submit" disabled={submitting || !isValid} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <UserPlus size={18} /> {submitting ? 'Création...' : 'Créer le guichet'}
                        </button>
                    </form>
                )}

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Guichet</th>
                                <th>Téléphone</th>
                                <th>Statut</th>
                                {canWrite && <th style={{ textAlign: 'right' }}>Actions</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {tills.map(t => (
                                <tr key={t.id}>
                                    <td style={{ fontWeight: 700 }}>{t.name || 'Guichet'}</td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{t.phone || '—'}</td>
                                    <td>
                                        <span className={`status-pill ${t.isActive ? 'success' : 'neutral'}`}>{t.isActive ? 'Actif' : 'Inactif'}</span>
                                    </td>
                                    {canWrite && (
                                        <td style={{ textAlign: 'right' }}>
                                            {t.isActive && (
                                                <button className="btn-danger" disabled={busyId === t.id} onClick={() => handleDeactivate(t)}>
                                                    <Trash2 size={14} style={{ marginRight: 4 }} /> {busyId === t.id ? '...' : 'Désactiver'}
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {!loading && tills.length === 0 && (
                                <tr><td colSpan={canWrite ? 4 : 3} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun guichet pour le moment.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
