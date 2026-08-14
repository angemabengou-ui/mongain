import { useState } from 'react';
import { API_URL } from './config';

const MAX_ATTEMPTS = 3;

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, phone: string) => void }) {
    const [identifier, setIdentifier] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPin, setShowPin] = useState(false);
    const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
    const [isLocked, setIsLocked] = useState(false);

    const submit = async (e: React.FormEvent) => {
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
                // Parse remaining attempts from backend error message
                const msg: string = data.error || 'Identifiants incorrects.';

                if (res.status === 403 || msg.toLowerCase().includes('bloqué') || msg.toLowerCase().includes('sécurisé')) {
                    setIsLocked(true);
                    setAttemptsLeft(0);
                    setError(msg);
                    return;
                }

                // Extract "Tentatives restantes : X" from backend message
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

            // Success — reset counters
            setAttemptsLeft(null);
            setIsLocked(false);

            if (!data.user || !data.user.role) throw new Error('Réponse serveur invalide.');

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

    const attemptsColor = attemptsLeft === null ? undefined
        : attemptsLeft <= 1 ? '#EF4444'
            : attemptsLeft === 2 ? '#F59E0B'
                : '#10B981';

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-title">
                    <h2>Mongain Admin</h2>
                    <p>Connectez-vous avec votre compte Corporate.</p>
                </div>

                {/* Error banner */}
                {error && (
                    <div style={{
                        color: isLocked ? '#FCA5A5' : 'var(--danger)',
                        marginBottom: 16,
                        fontSize: 14,
                        textAlign: 'center',
                        background: isLocked ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
                        padding: '10px 16px',
                        borderRadius: 8,
                        border: `1px solid ${isLocked ? 'rgba(239,68,68,0.5)' : 'rgba(239,68,68,0.3)'}`,
                        fontWeight: isLocked ? 'bold' : 'normal'
                    }}>
                        {isLocked ? '🔒 ' : '⚠️ '}{error}
                    </div>
                )}

                {/* Attempts counter */}
                {attemptsLeft !== null && !isLocked && (
                    <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 12,
                        fontSize: 13,
                        color: attemptsColor,
                        fontWeight: 'bold'
                    }}>
                        {[...Array(MAX_ATTEMPTS)].map((_, i) => (
                            <span key={i} style={{
                                width: 10, height: 10,
                                borderRadius: '50%',
                                backgroundColor: i < attemptsLeft ? attemptsColor : 'rgba(239,68,68,0.2)',
                                display: 'inline-block',
                                transition: 'background 0.3s'
                            }} />
                        ))}
                        <span style={{ marginLeft: 4 }}>
                            {attemptsLeft} tentative{attemptsLeft > 1 ? 's' : ''} restante{attemptsLeft > 1 ? 's' : ''}
                        </span>
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
                            disabled={isLocked}
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
                            disabled={isLocked}
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
                    <button
                        className="btn-primary"
                        type="submit"
                        disabled={loading || !identifier || !pin || isLocked}
                        style={{ opacity: isLocked ? 0.5 : 1, cursor: isLocked ? 'not-allowed' : 'pointer' }}
                    >
                        {loading ? 'Connexion en cours...'
                            : isLocked ? '🔒 Compte bloqué (15 min)'
                                : 'Accéder au Dashboard'}
                    </button>
                </form>
                <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Réservé aux comptes Admin, Agent et Marchand.
                </p>
            </div>
        </div>
    );
}
