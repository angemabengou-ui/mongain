import { useState } from 'react';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, identifier: string, mustChangePassword: boolean) => void }) {
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
            const data = await apiFetch(API_URL + '/api/corp/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), password })
            });

            if (!data.user || !data.user.role) {
                throw new Error('Réponse serveur invalide.');
            }

            const allowedRoles = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER', 'TELLER'];
            if (!allowedRoles.includes(data.user.role)) {
                throw new Error(`Accès refusé. Expulsé par le portail Corporate.`);
            }

            // We pass the email back as the "identifier" (formerly phone)
            setToken(data.token, data.user.role, data.user.name, data.user.email, !!data.user.mustChangePassword);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            backgroundColor: '#050505',
            backgroundImage: 'radial-gradient(circle at 50% -20%, rgba(12, 133, 153, 0.15), #050505 70%), url("https://www.transparenttextures.com/patterns/stardust.png")',
            color: '#fff'
        }}>
            <div style={{
                width: '420px',
                padding: '48px 40px',
                borderRadius: '24px',
                background: 'rgba(255, 255, 255, 0.02)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '36px' }}>
                    <div style={{
                        width: 56, height: 56,
                        background: 'linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%)',
                        color: 'white', borderRadius: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 28, fontWeight: 900,
                        fontFamily: 'var(--font-heading)', margin: '0 auto 20px',
                        boxShadow: '0 12px 24px rgba(12, 133, 153, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.3)'
                    }}>
                        M.
                    </div>
                    <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-heading)', letterSpacing: '-0.5px' }}>Mongain Corporate</h2>
                    <p style={{ color: 'rgba(255, 255, 255, 0.5)', marginTop: '8px', fontSize: 14, fontWeight: 500 }}>Portail d'Authentification Interne</p>
                </div>

                {error && (
                    <div style={{
                        color: '#f87171', marginBottom: 24, fontSize: 13, textAlign: 'center',
                        background: 'rgba(248, 113, 113, 0.1)', padding: '12px 16px', borderRadius: 12,
                        border: '1px solid rgba(248, 113, 113, 0.2)', fontWeight: 500
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Email Professionnel</label>
                        <input
                            type="email"
                            value={email} onChange={e => setEmail(e.target.value)}
                            placeholder="prenom.nom@mongain.com" autoComplete="username"
                            required
                            style={{
                                width: '100%', padding: '14px 16px', borderRadius: '12px',
                                background: 'rgba(0, 0, 0, 0.2)',
                                border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '15px', color: '#fff',
                                outline: 'none', transition: 'border-color 0.2s, background 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Mot de Passe</label>
                        <input
                            value={password} onChange={e => setPassword(e.target.value)}
                            type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                            autoComplete="current-password" required
                            style={{
                                width: '100%', padding: '14px 44px 14px 16px', borderRadius: '12px',
                                background: 'rgba(0, 0, 0, 0.2)',
                                border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '15px', color: '#fff',
                                outline: 'none', transition: 'border-color 0.2s, background 0.2s'
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)'}
                        />
                        <button
                            type="button" onClick={() => setShowPassword(v => !v)}
                            style={{ position: 'absolute', right: 14, top: 35, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 18, transition: 'color 0.2s' }}
                            onMouseOver={e => e.currentTarget.style.color = 'rgba(255,255,255,0.8)'}
                            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                        >
                            {showPassword ? '🙈' : '👁️'}
                        </button>
                    </div>

                    <button type="submit" disabled={loading || !email || !password} style={{
                        width: '100%', padding: '16px',
                        background: 'linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%)',
                        color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: 15,
                        cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
                        opacity: loading || !email || !password ? 0.5 : 1, transition: 'all 0.2s', marginTop: '12px',
                        boxShadow: '0 8px 24px rgba(12, 133, 153, 0.25)'
                    }}>
                        {loading ? 'Vérification Habilitation...' : 'Accéder au Portail'}
                    </button>
                </form>
            </div>
        </div>
    );
}
