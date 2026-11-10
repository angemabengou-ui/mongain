import { Activity, CheckCircle, Code2, Copy, Globe, Key, RefreshCw, Save, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, canManageDevelopers, ENDPOINTS } from './api';

export default function Developers({ onSessionExpired }: { onSessionExpired: () => void }) {
    const isAdmin = canManageDevelopers();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    const [integrations, setIntegrations] = useState<any[]>([]);
    const [deliveries, setDeliveries] = useState<any[]>([]);
    
    const [generating, setGenerating] = useState(false);
    const [newSecret, setNewSecret] = useState<{ secret: string, webhookSigningSecret: string } | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editWebhookUrl, setEditWebhookUrl] = useState('');
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        if (isAdmin) {
            fetchData();
        } else {
            setLoading(false);
        }
    }, [isAdmin]);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const keysRes = await apiRequest(ENDPOINTS.gatewayKeys);
            setIntegrations(Array.isArray(keysRes) ? keysRes : (keysRes.data || keysRes.keys || []));
            
            try {
                const logsRes = await apiRequest(ENDPOINTS.gatewayWebhookDeliveries);
                setDeliveries(Array.isArray(logsRes) ? logsRes : (logsRes.data || logsRes.deliveries || []));
            } catch (err) {
                // Not blocking if logs fail
                console.warn("Failed to fetch webhook deliveries", err);
            }
        } catch (err: any) {
            if (err?.name === 'SessionExpiredError') { onSessionExpired(); return; }
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setError('');
        setSuccess('');
        setNewSecret(null);
        try {
            // Demande le nom via prompt pour simplifier
            const name = window.prompt("Nom de l'intégration (ex: Site E-commerce) :");
            if (!name) {
                setGenerating(false);
                return;
            }

            const res = await apiRequest(ENDPOINTS.gatewayKeyGenerate, {
                method: 'POST',
                body: JSON.stringify({ name })
            });
            
            // Le backend renvoie typiquement l'objet créé + le secret en clair
            const data = res.data || res;
            setNewSecret({
                secret: data.secret || data.rawSecret,
                webhookSigningSecret: data.webhookSigningSecret || data.rawWebhookSigningSecret
            });
            setSuccess("Nouvelle clé générée avec succès.");
            await fetchData();
        } catch (err: any) {
            if (err?.name === 'SessionExpiredError') { onSessionExpired(); return; }
            setError(err.message);
        } finally {
            setGenerating(false);
        }
    };

    const startEditing = (integration: any) => {
        setEditingId(integration.id);
        setEditWebhookUrl(integration.webhookUrl || '');
    };

    const handleUpdateWebhook = async (id: string) => {
        setUpdating(true);
        setError('');
        setSuccess('');
        try {
            await apiRequest(ENDPOINTS.gatewayKeyUpdate(id), {
                method: 'PATCH',
                body: JSON.stringify({ webhookUrl: editWebhookUrl.trim() || null })
            });
            setSuccess("Configuration Webhook mise à jour.");
            setEditingId(null);
            await fetchData();
        } catch (err: any) {
            if (err?.name === 'SessionExpiredError') { onSessionExpired(); return; }
            setError(err.message);
        } finally {
            setUpdating(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert("Copié dans le presse-papiers !");
    };

    if (!isAdmin) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <div className="banner info">
                    L'Espace Développeur (API Mongain Connect) est réservé à l'administrateur principal (Gérant).
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><Code2 size={22} /></div>
                    Espace Développeurs (API)
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                    Générez vos clés d'API pour intégrer Mongain Pay sur votre site e-commerce et configurez vos Webhooks.
                </p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {success && <div className="banner success mb-8">{success}</div>}

            {newSecret && (
                <div className="card" style={{ marginBottom: 32, border: '2px solid var(--success)', background: 'rgba(34, 197, 94, 0.05)' }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 16px', color: 'var(--success)' }}>⚠️ Clés générées avec succès !</h2>
                    <p style={{ fontSize: 13, marginBottom: 16 }}>Copiez ces clés immédiatement. Elles ne seront plus jamais affichées pour des raisons de sécurité.</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Clé Secrète API (Authorization: Bearer ...)</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input type="text" readOnly value={newSecret.secret} style={{ flex: 1, fontFamily: 'monospace' }} />
                                <button onClick={() => copyToClipboard(newSecret.secret)} className="btn-secondary"><Copy size={16} /></button>
                            </div>
                        </div>
                        {newSecret.webhookSigningSecret && (
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Secret de signature Webhook (Mongain-Signature)</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <input type="text" readOnly value={newSecret.webhookSigningSecret} style={{ flex: 1, fontFamily: 'monospace' }} />
                                    <button onClick={() => copyToClipboard(newSecret.webhookSigningSecret)} className="btn-secondary"><Copy size={16} /></button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="card" style={{ marginBottom: 32 }}>
                <div className="flex-between" style={{ marginBottom: 16 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Key size={18} /> Vos Intégrations API
                    </h2>
                    <button onClick={handleGenerate} disabled={generating || loading} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
                        {generating ? 'Génération...' : '+ Nouvelle Intégration'}
                    </button>
                </div>

                {loading ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}><RefreshCw className="spin" size={24} /></div>
                ) : integrations.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 12 }}>
                        Aucune intégration API configurée.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {integrations.map((intg: any) => (
                            <div key={intg.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-secondary)' }}>
                                <div className="flex-between" style={{ marginBottom: 12 }}>
                                    <div style={{ fontWeight: 800, fontSize: 16 }}>{intg.name || 'Intégration'}</div>
                                    <span className={`status-pill ${intg.isActive ? 'success' : 'error'}`}>
                                        {intg.isActive ? 'Active' : 'Désactivée'}
                                    </span>
                                </div>
                                
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                                    Créée le {new Date(intg.createdAt).toLocaleDateString('fr-FR')}
                                </div>

                                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontWeight: 700, fontSize: 13 }}>
                                        <Globe size={16} /> Configuration Webhook
                                    </div>
                                    
                                    {editingId === intg.id ? (
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input 
                                                type="url" 
                                                value={editWebhookUrl} 
                                                onChange={(e) => setEditWebhookUrl(e.target.value)} 
                                                placeholder="https://votre-site.com/webhooks/mongain" 
                                                style={{ flex: 1, padding: '8px 12px' }} 
                                            />
                                            <button onClick={() => handleUpdateWebhook(intg.id)} disabled={updating} className="btn-primary" style={{ padding: '8px 12px' }}>
                                                <Save size={16} />
                                            </button>
                                            <button onClick={() => setEditingId(null)} className="btn-secondary" style={{ padding: '8px 12px' }}>
                                                Annuler
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex-between">
                                            <span style={{ fontSize: 13, fontFamily: 'monospace', color: intg.webhookUrl ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                                {intg.webhookUrl || 'Aucune URL configurée'}
                                            </span>
                                            <button onClick={() => startEditing(intg)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}>
                                                Modifier
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="card">
                <div className="flex-between" style={{ marginBottom: 16 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Activity size={18} /> Logs de Webhooks (Derniers envois)
                    </h2>
                    <button onClick={fetchData} className="btn-secondary" style={{ padding: '6px 12px' }}><RefreshCw size={14} /></button>
                </div>

                {deliveries.length === 0 ? (
                    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        Aucun webhook envoyé récemment.
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                    <th style={{ padding: '12px 8px' }}>Date</th>
                                    <th style={{ padding: '12px 8px' }}>Évènement</th>
                                    <th style={{ padding: '12px 8px' }}>Statut HTTP</th>
                                    <th style={{ padding: '12px 8px' }}>Tentatives</th>
                                </tr>
                            </thead>
                            <tbody>
                                {deliveries.map((del: any) => (
                                    <tr key={del.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '12px 8px' }}>{new Date(del.createdAt).toLocaleString('fr-FR')}</td>
                                        <td style={{ padding: '12px 8px', fontWeight: 600 }}>{del.eventType || 'PAYMENT_SUCCESS'}</td>
                                        <td style={{ padding: '12px 8px' }}>
                                            {del.success ? (
                                                <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14}/> {del.httpStatus || 200}</span>
                                            ) : (
                                                <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14}/> {del.httpStatus || 'Échec'}</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px 8px' }}>{del.attempts}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

