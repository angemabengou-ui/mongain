import { useState } from 'react';
import { API_URL } from './config';

const MAX_ATTEMPTS = 3;

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, phone: string) => void }) {
    // Step 1 states
    const [identifier, setIdentifier] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);

    // Step 2 states
    const [requireOtp, setRequireOtp] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [actualPhone, setActualPhone] = useState('');

    // Shared states
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
    const [isLocked, setIsLocked] = useState(false);

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLocked) return;
        setError('');
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: identifier.trim(), pin })
            });
            const data = await res.json();

            if (!res.ok) {
                const msg: string = data.error || 'Identifiants incorrects.';
                if (res.status === 403 || msg.toLowerCase().includes('bloqué') || msg.toLowerCase().includes('sécurisé')) {
                    setIsLocked(true);
                    setAttemptsLeft(0);
                    setError(msg);
                    return;
                }
                const match = msg.match(/(\d+)/);
                if (match) {
                    const remaining = parseInt(match[1], 10);
                    setAttemptsLeft(remaining);
                    if (remaining === 0) setIsLocked(true);
                } else {
                    setAttemptsLeft(prev => prev !== null ? Math.max(0, prev - 1) : MAX_ATTEMPTS - 1);
                }
                throw new Error(msg);
            }

            if (data.requireOtp) {
                // Backend requires OTP step
                setRequireOtp(true);
                setActualPhone(identifier.trim()); // We'll use what the user typed to verify
                setAttemptsLeft(null);
                setIsLocked(false);
            } else {
                // If it bypasses OTP (old flow, shouldn't happen with current backend)
                processUserToken(data);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleOtpSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/auth/verify-login-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: actualPhone, otpCode })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Code OTP invalide.');

            processUserToken(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const processUserToken = (data: any) => {
        if (!data.user || !data.user.role) {
            throw new Error('Réponse serveur invalide.');
        }

        const allowedRoles = ['ADMIN', 'AGENT', 'MERCHANT'];
        if (!allowedRoles.includes(data.user.role)) {
            throw new Error(`Accès refusé. Le rôle ${data.user.role} n'est pas autorisé sur l'Admin Web.`);
        }

        setToken(data.token, data.user.role, data.user.name, data.user.phone || actualPhone);
    };

    const attemptsColor = attemptsLeft === null ? undefined
        : attemptsLeft <= 1 ? '#EF4444'
            : attemptsLeft === 2 ? '#F59E0B'
                : '#10B981';

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-title">
                    <h2>Mongain Admin</h2>
                    <p>{requireOtp ? 'Vérification de sécurité' : 'Connectez-vous avec votre compte Corporate.'}</p>
                </div>

                {error && (
                    <div style={{
                        color: isLocked ? '#FCA5A5' : 'var(--danger)', marginBottom: 16, fontSize: 14, textAlign: 'center',
                        background: isLocked ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
                        padding: '10px 16px', borderRadius: 8,
                        border: `1px solid ${isLocked ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)'}`,
                        fontWeight: isLocked ? 'bold' : 'normal'
                    }}>
                        {isLocked ? '🔒 ' : '⚠️ '}{error}
                    </div>
                )}

                {attemptsLeft !== null && !isLocked && !requireOtp && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 13, color: attemptsColor, fontWeight: 'bold' }}>
                        {[...Array(MAX_ATTEMPTS)].map((_, i) => (
                            <span key={i} style={{
                                width: 10, height: 10, borderRadius: '50%',
                                backgroundColor: i < attemptsLeft ? attemptsColor : 'rgba(239,68,68,0.2)',
                                display: 'inline-block', transition: 'background 0.3s'
                            }} />
                        ))}
                        <span style={{ marginLeft: 4 }}>
                            {attemptsLeft} tentative{attemptsLeft > 1 ? 's' : ''} restante{attemptsLeft > 1 ? 's' : ''}
                        </span>
                    </div>
                )}

                {!requireOtp ? (
                    <form onSubmit={handleLoginSubmit}>
                        <div className="input-group">
                            <label>Téléphone, Pseudo ou Email</label>
                            <input
                                value={identifier} onChange={e => setIdentifier(e.target.value)}
                                placeholder="+241... ou votre pseudo ou email" autoComplete="username"
                                disabled={isLocked} required
                            />
                        </div>
                        <div className="input-group" style={{ position: 'relative' }}>
                            <label>Code PIN secret</label>
                            <input
                                value={pin} onChange={e => setPin(e.target.value)}
                                type={showPin ? 'text' : 'password'} placeholder="••••"
                                autoComplete="current-password" maxLength={4} disabled={isLocked} required
                                style={{ paddingRight: 44 }}
                            />
                            <button
                                type="button" onClick={() => setShowPin(v => !v)}
                                style={{ position: 'absolute', right: 12, top: 36, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18 }}
                            >
                                {showPin ? '🙈' : '👁️'}
                            </button>
                        </div>
                        <button className="btn-primary" type="submit" disabled={loading || !identifier || !pin || isLocked} style={{ opacity: isLocked ? 0.5 : 1, cursor: isLocked ? 'not-allowed' : 'pointer' }}>
                            {loading ? 'Connexion en cours...' : isLocked ? '🔒 Compte bloqué (15 min)' : 'Continuer'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleOtpSubmit}>
                        <p style={{ textAlign: 'center', marginBottom: 20, color: 'var(--text-secondary)', fontSize: 14 }}>
                            Un code OTP a été envoyé au numéro lié à ce compte. <br /> (En mode développeur, le code est <strong>1234</strong>)
                        </p>
                        <div className="input-group">
                            <label>Code OTP (4 chiffres)</label>
                            <input
                                value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                placeholder="1234" maxLength={4} required
                                style={{ textAlign: 'center', fontSize: 24, letterSpacing: '8px' }}
                            />
                        </div>
                        <button className="btn-primary" type="submit" disabled={loading || otpCode.length < 4} style={{ marginBottom: 12 }}>
                            {loading ? 'Vérification...' : 'Accéder au Dashboard'}
                        </button>
                        <button type="button" onClick={() => { setRequireOtp(false); setOtpCode(''); }} className="btn-secondary" style={{ width: '100%', padding: '12px', background: 'transparent', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
                            ← Revenir en arrière
                        </button>
                    </form>
                )}

                <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Réservé aux comptes Admin, Agent et Marchand.
                </p>
            </div>
        </div>
    );
}
