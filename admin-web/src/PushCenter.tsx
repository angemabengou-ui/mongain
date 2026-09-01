import { useState } from 'react';

export default function PushCenter({ token: _token }: { token: string }) {
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [target, setTarget] = useState('ALL');

    return (
        <div style={{ padding: 40, animation: 'fadeIn 0.5s ease-out' }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, background: 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Centre de Notifications (V6 Phase 2)
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Diffusez des campagnes Push vers les terminaux mobiles enregistrés (Expo Notifications).</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 2fr) minmax(300px, 1fr)', gap: 24 }}>
                <div className="card" style={{ padding: 32 }}>
                    <h3 style={{ fontSize: 16, marginBottom: 24, fontWeight: 600 }}>Nouvelle Campagne</h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>Cible de diffusion</label>
                            <select value={target} onChange={e => setTarget(e.target.value)} style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', outline: 'none' }}>
                                <option value="ALL">Tous les utilisateurs (Global Broadcast)</option>
                                <option value="AGENTS">Agents / Tellers uniquement</option>
                                <option value="FROZEN">Comptes suspendus (Rappel)</option>
                            </select>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>Titre de la notification</label>
                            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex: Nouveauté Mongain V6" style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', outline: 'none' }} />
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>Message (Corps)</label>
                            <textarea value={message} onChange={e => setMessage(e.target.value)} placeholder="Texte affiché sur le téléphone..." rows={4} style={{ padding: '12px 16px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', outline: 'none', resize: 'vertical' }} />
                        </div>

                        <button style={{ marginTop: 8, padding: '14px', background: 'linear-gradient(135deg, var(--accent) 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: (title && message) ? 'pointer' : 'not-allowed', opacity: (title && message) ? 1 : 0.5, boxShadow: '0 8px 24px rgba(12, 133, 153, 0.25)' }}>
                            Déclencher l'envoi Push
                        </button>
                    </div>
                </div>

                <div className="card" style={{ padding: 32, background: 'var(--bg-secondary)' }}>
                    <h3 style={{ fontSize: 16, marginBottom: 24, fontWeight: 600 }}>Aperçu Mobile</h3>

                    <div style={{ background: '#111', borderRadius: 24, padding: 16, border: '4px solid #333', height: 400, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ width: '40%', height: 20, background: '#000', borderRadius: '0 0 10px 10px', alignSelf: 'center', marginBottom: 20 }}></div>

                        {(title || message) ? (
                            <div style={{ background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', padding: 16, borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <div style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--accent)' }}></div>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Mongain</span>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 4 }}>{title || 'Titre de Notification'}</div>
                                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', lineHeight: 1.4 }}>{message || 'Le message apparaîtra ici...'}</div>
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center' }}>
                                Remplissez le formulaire<br />pour prévisualiser l'alerte
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
