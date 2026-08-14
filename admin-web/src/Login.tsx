import { useState } from 'react';
import { API_URL } from './config';

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, phone: string) => void }) {
    const [identifier, setIdentifier] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPin, setShowPin] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send identifier as "phone" — backend already handles phone/username/email via OR query
                body: JSON.stringify({ phone: identifier.trim(), pin })
            });
            const data = await res.json();

            // Guard: backend returned an error
            if (!res.ok) throw new Error(data.error || 'Identifiants incorrects.');

            // Guard: user object missing in response
            if (!data.user || !data.user.role) throw new Error('Réponse serveur invalide. Contactez l\'administrateur.');

            // Guard: unauthorized role
            const allowedRoles = ['ADMIN', 'AGENT', 'MERCHANT'];
            if (!allowedRoles.includes(data.user.role)) {
                throw new Error('Accès refusé. Seuls les comptes Corporate peuvent accéder à cette plateforme.');
            }

            setToken(data.token, data.user.role, data.user.name, data.user.phone || identifier.trim());
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-title">
                    <h2>Mongain Admin</h2>
                    <p>Connectez-vous avec votre compte Corporate.</p>
                </div>
                {error && (
                    <div style={{ color: 'var(--danger)', marginBottom: 20, fontSize: 14, textAlign: 'center', background: 'rgba(239,68,68,0.1)', padding: '10px 16px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
                        {error}
                    </div>
                )}
                <form onSubmit={submit}>
                    <div className="input-group">
                        <label>Téléphone, Pseudo ou Email</label>
                        <input
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            placeholder="+241... ou votre pseudo ou email"
                            autoComplete="username"
                            required
                        />
                    </div>
                    <div className="input-group" style={{ position: 'relative' }}>
                        <label>Code PIN secret</label>
                        <input
                            value={pin}
                            onChange={e => setPin(e.target.value)}
                            type={showPin ? 'text' : 'password'}
                            placeholder="••••"
                            autoComplete="current-password"
                            maxLength={4}
                            required
                            style={{ paddingRight: 44 }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPin(v => !v)}
                            style={{ position: 'absolute', right: 12, top: 36, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}
                            aria-label={showPin ? 'Masquer le PIN' : 'Afficher le PIN'}
                        >
                            {showPin ? '🙈' : '👁️'}
                        </button>
                    </div>
                    <button className="btn-primary" type="submit" disabled={loading || !identifier || !pin}>
                        {loading ? 'Connexion en cours...' : 'Accéder au Dashboard'}
                    </button>
                </form>
                <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Réservé aux comptes Admin, Agent et Marchand.
                </p>
            </div>
        </div>
    );
}
