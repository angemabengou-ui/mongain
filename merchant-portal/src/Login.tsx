import { useState } from 'react';
import { apiRequest, ENDPOINTS, saveSession, type PortalUser } from './api';

export default function Login({ onLogin }: { onLogin: (user: PortalUser) => void }) {
    const [phone, setPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');

    // Connexion à deux étapes : téléphone -> OTP envoyé par SMS -> vérification. Le backend ne
    // délivre le token qu'après vérification du code (POST /auth/login n'envoie que l'OTP).
    const [step, setStep] = useState<'phone' | 'otp'>('phone');

    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const [loading, setLoading] = useState(false);
    const [resendCooldown, setResendCooldown] = useState(0);

    const startCooldown = () => {
        setResendCooldown(30);
        const interval = setInterval(() => {
            setResendCooldown(v => {
                if (v <= 1) { clearInterval(interval); return 0; }
                return v - 1;
            });
        }, 1000);
    };

    const requestOtp = async (isResend: boolean) => {
        setError('');
        setInfo('');
        setLoading(true);
        try {
            await apiRequest(ENDPOINTS.login, {
                method: 'POST',
                body: JSON.stringify({ phone: phone.trim() }),
            }, { auth: false });

            setStep('otp');
            startCooldown();
            if (isResend) setInfo('Un nouveau code a été envoyé par SMS.');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handlePhoneSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!phone.trim()) return;
        await requestOtp(false);
    };

    const handleOtpSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await apiRequest(ENDPOINTS.verifyOtp, {
                method: 'POST',
                body: JSON.stringify({ phone: phone.trim(), otpCode }),
            }, { auth: false });

            if (!data.token) {
                throw new Error("Réponse du serveur inattendue. Réessayez, et si le problème persiste, contactez le support Mongain.");
            }

            saveSession(data.token, data.refreshToken, data.user);
            onLogin(data.user || {});
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
            backgroundImage: 'radial-gradient(circle at 50% -20%, rgba(12, 133, 153, 0.15), #050505 70%)',
            color: '#fff'
        }}>
            <div style={{
                width: '420px',
                maxWidth: '100%',
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
                        background: 'linear-gradient(135deg, #0C8599 0%, #06b6d4 100%)',
                        color: 'white', borderRadius: 16,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 28, fontWeight: 900,
                        fontFamily: 'var(--font-heading)', margin: '0 auto 20px',
                        boxShadow: '0 12px 24px rgba(12, 133, 153, 0.4), inset 0 2px 0 rgba(255, 255, 255, 0.3)'
                    }}>
                        M.
                    </div>
                    <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: 'var(--font-heading)', letterSpacing: '-0.5px' }}>Mongain Partenaires</h2>
                    <p style={{ color: 'rgba(255, 255, 255, 0.5)', marginTop: '8px', fontSize: 14, fontWeight: 500 }}>Portail Marchands Géants</p>
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
                {info && (
                    <div style={{
                        color: '#5AC5D4', marginBottom: 24, fontSize: 13, textAlign: 'center',
                        background: 'rgba(90, 197, 212, 0.1)', padding: '12px 16px', borderRadius: 12,
                        border: '1px solid rgba(90, 197, 212, 0.2)', fontWeight: 500
                    }}>
                        {info}
                    </div>
                )}

                {step === 'phone' ? (
                    <form onSubmit={handlePhoneSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Numéro de téléphone</label>
                            <input
                                type="tel"
                                inputMode="tel"
                                value={phone} onChange={e => setPhone(e.target.value)}
                                placeholder="Ex: 074XXXXXX" autoComplete="tel" autoFocus
                                required
                                style={{
                                    width: '100%', padding: '14px 16px', borderRadius: '12px',
                                    background: 'rgba(0, 0, 0, 0.2)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '15px', color: '#fff',
                                    outline: 'none'
                                }}
                            />
                            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>
                                Réservé aux comptes marchands géants (mairies, administrations, grandes entreprises).
                            </p>
                        </div>

                        <button type="submit" disabled={loading || !phone.trim()} style={{
                            width: '100%', padding: '16px',
                            background: 'linear-gradient(135deg, #0C8599 0%, #06b6d4 100%)',
                            color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: 15,
                            cursor: loading || !phone.trim() ? 'not-allowed' : 'pointer',
                            opacity: loading || !phone.trim() ? 0.5 : 1, marginTop: '12px',
                            boxShadow: '0 8px 24px rgba(12, 133, 153, 0.25)'
                        }}>
                            {loading ? 'Envoi du code...' : 'Recevoir le code par SMS'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleOtpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'rgba(255, 255, 255, 0.6)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Code de sécurité</label>
                            <p style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: 13, marginBottom: 12 }}>
                                Un code a été envoyé par SMS au {phone}.
                            </p>
                            <input
                                value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                                inputMode="numeric" placeholder="0000" maxLength={4} autoFocus
                                style={{
                                    width: '100%', padding: '14px 16px', borderRadius: '12px',
                                    background: 'rgba(0, 0, 0, 0.2)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '24px', fontWeight: 700, color: '#fff',
                                    textAlign: 'center', letterSpacing: 8,
                                    outline: 'none'
                                }}
                            />
                        </div>

                        <button type="submit" disabled={loading || otpCode.length !== 4} style={{
                            width: '100%', padding: '16px',
                            background: 'linear-gradient(135deg, #0C8599 0%, #06b6d4 100%)',
                            color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: 15,
                            cursor: loading || otpCode.length !== 4 ? 'not-allowed' : 'pointer',
                            opacity: loading || otpCode.length !== 4 ? 0.5 : 1, marginTop: '4px',
                            boxShadow: '0 8px 24px rgba(12, 133, 153, 0.25)'
                        }}>
                            {loading ? 'Vérification...' : 'Confirmer'}
                        </button>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={() => { setStep('phone'); setOtpCode(''); setError(''); setInfo(''); }}
                                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}
                            >
                                ← Changer de numéro
                            </button>
                            <button
                                type="button"
                                disabled={resendCooldown > 0 || loading}
                                onClick={() => requestOtp(true)}
                                style={{
                                    background: 'none', border: 'none', fontSize: 13,
                                    color: resendCooldown > 0 ? 'rgba(255,255,255,0.3)' : '#5AC5D4',
                                    cursor: resendCooldown > 0 || loading ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {resendCooldown > 0 ? `Renvoyer (${resendCooldown}s)` : 'Renvoyer le code'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
