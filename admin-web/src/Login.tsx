import { useState } from 'react';
import { API_URL } from './config';

export default function Login({ setToken }: { setToken: (token: string, role: string, name: string, phone: string) => void }) {
    const [phone, setPhone] = useState('+241');
    const [pin, setPin] = useState('1234');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, pin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

            if (data.user.role !== 'ADMIN' && data.user.role !== 'AGENT' && data.user.role !== 'MERCHANT') {
                throw new Error('Vous n\'avez pas les droits d\'accès à cette plateforme.');
            }

            setToken(data.token, data.user.role, data.user.name, phone);
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
                    <p>Connectez-vous avec un compte Corporate.</p>
                </div>
                {error && <div style={{ color: 'var(--danger)', marginBottom: 20, fontSize: 14, textAlign: 'center' }}>{error}</div>}
                <form onSubmit={submit}>
                    <div className="input-group">
                        <label>Numéro Entreprise</label>
                        <input value={phone} onChange={e => setPhone(e.target.value)} />
                    </div>
                    <div className="input-group">
                        <label>Code PIN secret</label>
                        <input value={pin} onChange={e => setPin(e.target.value)} type="password" />
                    </div>
                    <button className="btn-primary" type="submit" disabled={loading}>
                        {loading ? 'Connexion...' : 'Accéder au Dashboard'}
                    </button>
                </form>
            </div>
        </div>
    );
}
