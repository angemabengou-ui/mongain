import axios from 'axios';
import { Check, Code, Copy, ExternalLink, Key, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { API_URL } from './config';

export default function DevPortal({ token }: { token: string }) {
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    const generateKey = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await axios.post(`${API_URL}/api/gateway/keys/generate`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setApiKey(res.data.apiKey);
            setCopied(false);
        } catch (e: any) {
            setError(e.response?.data?.error || "Erreur de génération des clés. Vérifiez vos permissions Marchand.");
        }
        setLoading(false);
    };

    const copyToClipboard = () => {
        if (apiKey) {
            navigator.clipboard.writeText(apiKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 3000);
        }
    };

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ marginBottom: 32 }}>
                <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 12, borderRadius: 12 }}><Code size={28} /></div>
                    Mongain Developer Portal
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Intégrez la puissance de Mongain Connect directement dans vos applications tierces.</p>
            </div>

            {error && (
                <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 16, borderRadius: 12, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12, fontWeight: 500 }}>
                    <ShieldCheck size={20} />
                    {error}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) minmax(400px, 1fr)', gap: 32 }}>
                <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Key size={24} color="var(--accent)" /> API Keys (Secrets)
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.6 }}>
                        Générez une clé d'API <code style={{ background: 'var(--bg-primary)', padding: '2px 6px', borderRadius: 4 }}>sk_live_...</code> pour lier votre boutique e-commerce.
                        <b style={{ color: 'var(--danger)' }}> Attention: Elle ne sera affichée qu'une seule fois !</b>
                    </p>

                    {!apiKey ? (
                        <button
                            onClick={generateKey}
                            disabled={loading}
                            className="btn-primary"
                            style={{ marginTop: 'auto', width: '100%', padding: '16px', fontSize: 16 }}
                        >
                            {loading ? "Génération en cours..." : "Révéler la Clé de Production"}
                        </button>
                    ) : (
                        <div style={{ background: 'var(--bg-primary)', padding: 16, borderRadius: 12, border: '1px solid var(--border)' }}>
                            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, display: 'block' }}>SECRET KEY (PRODUCTION)</label>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
                                <code style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 14, wordBreak: 'break-all', color: 'var(--text-primary)' }}>{apiKey}</code>
                                <button onClick={copyToClipboard} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                                    {copied ? <Check size={20} color="var(--success)" /> : <Copy size={20} color="var(--text-secondary)" />}
                                </button>
                            </div>
                            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 12, fontWeight: 600 }}>Stockez cette clé dans un endroit sécurisé. Vous ne pourrez plus la revoir.</p>
                        </div>
                    )}
                </div>

                <div className="card" style={{ background: 'linear-gradient(135deg, #0F2E33, #08171A)', color: 'white', border: 'none' }}>
                    <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, color: 'white' }}>
                        <ExternalLink size={24} color="var(--accent-light)" /> Documentation Rapide
                    </h2>
                    <p style={{ color: '#B9D6DA', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
                        Utilisez l'API <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>/api/gateway/charge</code> pour initier un paiement sur le téléphone de vos clients.
                    </p>

                    <div style={{ background: 'rgba(0,0,0,0.4)', padding: 20, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', fontFamily: 'monospace', fontSize: 13, color: '#B9D6DA', overflowX: 'auto' }}>
                        <span style={{ color: '#3FBE76', fontWeight: 700 }}>POST</span> https://api.mongain.com/api/gateway/charge<br /><br />
                        <span style={{ color: '#9CA39D' }}>Headers:</span><br />
                        Authorization: Bearer <span style={{ color: '#D9A64E' }}>sk_live_...</span><br /><br />
                        <span style={{ color: '#9CA39D' }}>Body:</span><br />
                        <pre style={{ margin: 0, fontFamily: 'monospace' }}>
                            {`{
  "customerPhone": "074XXXXX",
  "amount": 15000,
  "orderId": "SHOP_102"
}`}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}
