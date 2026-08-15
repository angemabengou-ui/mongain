import { useState } from 'react';
import { API_URL } from './config';

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, identifier: string) => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/corp/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), password })
            });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Identifiants invalides.');
            }

            if (!data.user || !data.user.role) {
                throw new Error('Réponse serveur invalide.');
            }

            const allowedRoles = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER', 'TELLER'];
            if (!allowedRoles.includes(data.user.role)) {
                throw new Error(`Accès refusé. Expulsé par le portail Corporate.`);
            }

            // We pass the email back as the "identifier" (formerly phone)
            setToken(data.token, data.user.role, data.user.name, data.user.email);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" style={{ width: '400px', padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <div style={{ width: 48, height: 48, background: 'var(--accent)', color: 'white', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 'bold', margin: '0 auto 15px' }}>
                        M.
                    </div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>Mongain Corporate</h2>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '8px', fontSize: 14 }}>Portail d'Authentification Interne</p>
                </div>

                {error && (
                    <div style={{
                        color: 'var(--danger)', marginBottom: 20, fontSize: 14, textAlign: 'center',
                        background: 'var(--danger-bg)', padding: '12px 16px', borderRadius: 8,
                        border: '1px solid rgba(220, 38, 38, 0.2)'
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Email Professionnel</label>
                        <input
                            type="email"
                            value={email} onChange={e => setEmail(e.target.value)}
                            placeholder="prenom.nom@mongain.com" autoComplete="username"
                            required
                            style={{
                                width: '100%', padding: '12px 16px', borderRadius: '8px',
                                border: '1px solid var(--border)', fontSize: '14px',
                                outline: 'none', transition: 'border-color 0.2s'
                            }}
                        />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Mot de Passe Administrateur</label>
                        <input
                            value={password} onChange={e => setPassword(e.target.value)}
                            type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                            autoComplete="current-password" required
                            style={{
                                width: '100%', padding: '12px 44px 12px 16px', borderRadius: '8px',
                                border: '1px solid var(--border)', fontSize: '14px',
                                outline: 'none', transition: 'border-color 0.2s'
                            }}
                        />
                        <button
                            type="button" onClick={() => setShowPassword(v => !v)}
                            style={{ position: 'absolute', right: 12, top: 32, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16 }}
                        >
                            {showPassword ? '🙈' : '👁️'}
                        </button>
                    </div>

                    <button type="submit" disabled={loading || !email || !password} style={{
                        width: '100%', padding: '14px', background: 'var(--accent)', color: 'white',
                        border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: 15,
                        cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                        opacity: loading || !email || !password ? 0.7 : 1, transition: 'opacity 0.2s', marginTop: '10px'
                    }}>
                        {loading ? 'Vérification Habilitation...' : 'Accéder au Portail'}
                    </button>
                </form>
            </div>
        </div>
    );
}
