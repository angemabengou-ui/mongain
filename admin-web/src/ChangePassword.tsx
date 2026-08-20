import { useState } from 'react';
import { API_URL } from './config';

export default function ChangePassword({ token, onLogout }: { token: string, onLogout: () => void }) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (newPassword.length < 8) {
            setError('Le nouveau mot de passe doit contenir au moins 8 caractères.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('La confirmation ne correspond pas au nouveau mot de passe.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/corp/change-password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Échec du changement de mot de passe.');
            // Le backend révoque immédiatement l'ancien token (jwtVersion incrémenté) — le
            // conserver et continuer sur la même session laisserait l'admin sur une appli
            // cassée (401 sur le premier appel API suivant). On force une reconnexion propre
            // avec le nouveau mot de passe, qui émettra un token valide.
            alert('Mot de passe modifié avec succès. Merci de vous reconnecter.');
            onLogout();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            background: 'linear-gradient(160deg, var(--sidebar-bg) 0%, #0A2226 55%, var(--sidebar-bg) 100%)'
        }}>
            <div className="card" style={{ width: '420px', padding: '40px', boxShadow: 'var(--shadow-float)' }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <div style={{
                        width: 52, height: 52, background: 'var(--accent)', color: 'white', borderRadius: 12,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800,
                        fontFamily: 'var(--font-heading)', margin: '0 auto 18px', boxShadow: '0 8px 20px rgba(12, 133, 153, 0.35)'
                    }}>
                        M.
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-heading)', letterSpacing: '-0.3px' }}>Changement de mot de passe requis</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: 14 }}>
                        Pour des raisons de sécurité, vous devez définir un mot de passe personnel avant de continuer.
                    </p>
                </div>

                {error && (
                    <div style={{
                        color: 'var(--danger)', marginBottom: 20, fontSize: 14, textAlign: 'center',
                        background: 'var(--danger-bg)', padding: '12px 16px', borderRadius: 8,
                        border: '1px solid var(--danger)'
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Mot de passe temporaire (fourni par la Direction)</label>
                        <input
                            value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                            type="password" autoComplete="current-password" required
                            style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', outline: 'none' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Nouveau mot de passe</label>
                        <input
                            value={newPassword} onChange={e => setNewPassword(e.target.value)}
                            type="password" autoComplete="new-password" required minLength={8}
                            style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', outline: 'none' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Confirmer le nouveau mot de passe</label>
                        <input
                            value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                            type="password" autoComplete="new-password" required minLength={8}
                            style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '14px', outline: 'none' }}
                        />
                    </div>

                    <button type="submit" disabled={loading} style={{
                        width: '100%', padding: '14px', background: 'var(--accent)', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: 15,
                        cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, marginTop: '4px'
                    }}>
                        {loading ? 'Mise à jour...' : 'Valider le nouveau mot de passe'}
                    </button>
                    <button type="button" onClick={onLogout} style={{
                        width: '100%', padding: '10px', background: 'none', color: 'var(--text-muted)',
                        border: 'none', fontSize: 13, cursor: 'pointer'
                    }}>
                        Se déconnecter
                    </button>
                </form>
            </div>
        </div>
    );
}
