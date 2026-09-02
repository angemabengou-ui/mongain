import { Activity, Calculator, CheckCircle, Clock, Copy, Database, Eye, Globe, Key, Lock, Power, RefreshCw, Shield, Smartphone, UserCheck, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import Modal from './components/Modal';
import PageHeader from './components/PageHeader';
import TabBar from './components/TabBar';
import { API_URL } from './config';

// ─── API MANAGEMENT TAB ────────────────────────────────────────────────────
function ApiManagementTab({ token }: { token: string }) {
    const [integrations, setIntegrations] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    // Generate form
    const [showGenModal, setShowGenModal] = useState(false);
    const [genForm, setGenForm] = useState({ merchantPhone: '', appName: '', environment: 'TEST', permissions: 'PAYMENTS', webhookUrl: '', description: '' });
    // One-time secret reveal
    const [oneTimeSecret, setOneTimeSecret] = useState<{ rawSecret: string; publicKey: string; appName: string } | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const r = await fetch(`${API_URL}/api/admin/api-integrations`, { headers: { Authorization: `Bearer ${token}` } });
            const d = await r.json();
            if (r.ok) setIntegrations(d.data || []);
            else setError(d.error || 'Erreur chargement');
        } catch { setError('Erreur réseau'); } finally { setLoading(false); }
    };

    useEffect(() => { load(); }, []);

    const handleGenerate = async () => {
        if (!genForm.merchantPhone || !genForm.appName) { setError('Téléphone et nom d\'app requis.'); return; }
        setLoading(true); setError(''); setMessage('');
        try {
            const r = await fetch(`${API_URL}/api/admin/api-integrations`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(genForm)
            });
            const d = await r.json();
            if (r.ok) {
                setOneTimeSecret({ rawSecret: d.data.rawSecret, publicKey: d.data.publicKey, appName: d.data.appName });
                setShowGenModal(false);
                setGenForm({ merchantPhone: '', appName: '', environment: 'TEST', permissions: 'PAYMENTS', webhookUrl: '', description: '' });
                load();
            } else setError(d.error);
        } catch { setError('Erreur réseau'); } finally { setLoading(false); }
    };

    const handleToggle = async (id: string, isActive: boolean) => {
        try {
            const r = await fetch(`${API_URL}/api/admin/api-integrations/${id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !isActive })
            });
            const d = await r.json();
            if (r.ok) { setMessage(`Intégration ${!isActive ? 'activée' : 'désactivée'}.`); load(); }
            else setError(d.error);
        } catch { setError('Erreur réseau'); }
    };

    const handleRotate = async (id: string) => {
        if (!window.confirm('Êtes-vous sûr ? L\'ancien secret sera immédiatement invalidé.')) return;
        try {
            const r = await fetch(`${API_URL}/api/admin/api-integrations/${id}/rotate`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const d = await r.json();
            if (r.ok) { setOneTimeSecret({ rawSecret: d.data.rawSecret, publicKey: 'N/A (inchangée)', appName: 'Secret Régénéré' }); load(); }
            else setError(d.error);
        } catch { setError('Erreur réseau'); }
    };

    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); };

    const envBadge = (env: string) => (
        <span style={{ padding: '2px 10px', borderRadius: 6, background: env === 'LIVE' ? 'var(--success-bg)' : 'var(--warning-bg)', color: env === 'LIVE' ? 'var(--success)' : 'var(--warning)', fontWeight: 700, fontSize: 12 }}>{env}</span>
    );

    return (
        <div>
            {error && <div style={{ padding: 12, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, marginBottom: 16, border: '1px solid var(--danger)' }}>✕ {error}</div>}
            {message && <div style={{ padding: 12, background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 8, marginBottom: 16, border: '1px solid var(--success)' }}>✓ {message}</div>}

            {/* One-time secret reveal */}
            {oneTimeSecret && (
                <div style={{ padding: 24, background: '#1e293b', color: 'white', borderRadius: 12, marginBottom: 24, border: '2px solid var(--warning)' }}>
                    <h3 style={{ margin: '0 0 8px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 8 }}><Eye size={18} /> Secret généré — Copiez-le maintenant !</h3>
                    <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 16px' }}>Ce secret ne sera JAMAIS affiché à nouveau. Il est haché en base de données.</p>
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ color: '#94a3b8', fontSize: 12 }}>App Name</label>
                        <div style={{ fontWeight: 800, color: 'white', fontSize: 16 }}>{oneTimeSecret.appName}</div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <label style={{ color: '#94a3b8', fontSize: 12 }}>Public Key (pk_)</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <code style={{ flex: 1, padding: '8px 12px', background: '#0f172a', borderRadius: 8, fontSize: 13, wordBreak: 'break-all' }}>{oneTimeSecret.publicKey}</code>
                            <button onClick={() => copyToClipboard(oneTimeSecret.publicKey)} style={{ padding: '8px 12px', background: '#334155', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}><Copy size={14} /></button>
                        </div>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                        <label style={{ color: 'var(--warning)', fontSize: 12, fontWeight: 800 }}>🔑 SECRET KEY (sk_) — UNE SEULE FOIS</label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <code style={{ flex: 1, padding: '8px 12px', background: '#0f172a', borderRadius: 8, fontSize: 13, color: 'var(--warning)', wordBreak: 'break-all' }}>{oneTimeSecret.rawSecret}</code>
                            <button onClick={() => copyToClipboard(oneTimeSecret.rawSecret)} style={{ padding: '8px 12px', background: 'var(--warning)', color: 'black', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800 }}><Copy size={14} /></button>
                        </div>
                    </div>
                    <button onClick={() => setOneTimeSecret(null)} style={{ width: '100%', padding: 12, background: 'var(--danger)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 800 }}>J'ai copié le secret — Fermer</button>
                </div>
            )}

            <div style={{ marginBottom: 20 }}>
                <PageHeader
                    title="Gestion des API"
                    subtitle="Gérer les clés d'accès API pour les marchands et partenaires tiers. Secrets stockés uniquement en hash bcrypt."
                    action={
                        <button onClick={() => setShowGenModal(true)} style={{ padding: '10px 20px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Key size={16} /> Générer une clé
                        </button>
                    }
                />
            </div>

            {/* Generate Modal */}
            {showGenModal && (
                <Modal
                    onClose={() => setShowGenModal(false)}
                    title="Nouvelle intégration API"
                    footer={<>
                        <button onClick={() => setShowGenModal(false)} style={{ flex: 1, padding: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Annuler</button>
                        <button onClick={handleGenerate} disabled={loading} style={{ flex: 2, padding: 12, background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                            {loading ? '...' : 'Générer (Le secret ne sera affiché qu\'une fois)'}
                        </button>
                    </>}
                >
                    <div style={{ display: 'grid', gap: 14 }}>
                        <div><label>Téléphone Marchand / Agent *</label><input className="input" value={genForm.merchantPhone} onChange={e => setGenForm({ ...genForm, merchantPhone: e.target.value })} placeholder="+24100000000" /></div>
                        <div><label>Nom de l'application *</label><input className="input" value={genForm.appName} onChange={e => setGenForm({ ...genForm, appName: e.target.value })} placeholder="Mon App E-Commerce" /></div>
                        <div><label>Environnement</label>
                            <select className="input" value={genForm.environment} onChange={e => setGenForm({ ...genForm, environment: e.target.value })}>
                                <option value="TEST">TEST (Sandbox)</option>
                                <option value="LIVE">LIVE (Production)</option>
                            </select>
                        </div>
                        <div><label>Permissions</label>
                            <select className="input" value={genForm.permissions} onChange={e => setGenForm({ ...genForm, permissions: e.target.value })}>
                                <option value="PAYMENTS">PAYMENTS</option>
                                <option value="PAYMENTS,REFUNDS">PAYMENTS, REFUNDS</option>
                                <option value="PAYMENTS,REFUNDS,REPORTS">PAYMENTS, REFUNDS, REPORTS</option>
                            </select>
                        </div>
                        <div><label>Webhook URL (optionnel)</label><input className="input" value={genForm.webhookUrl} onChange={e => setGenForm({ ...genForm, webhookUrl: e.target.value })} placeholder="https://monapp.com/webhook" /></div>
                        <div><label>Description</label><input className="input" value={genForm.description} onChange={e => setGenForm({ ...genForm, description: e.target.value })} /></div>
                    </div>
                </Modal>
            )}

            {/* Integrations Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Chargement...</div> :
                    integrations.length === 0 ? <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Aucune intégration API configurée.</div> :
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-secondary)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                                    {['App / Marchand', 'Environnement', 'Public Key', 'Secret', 'Permissions', 'Statut', 'Actions'].map((h, i) => (
                                        <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {integrations.map(intg => (
                                    <tr key={intg.id} style={{ borderBottom: '1px solid var(--border)', opacity: intg.isActive ? 1 : 0.5, transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{intg.appName}</div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{intg.merchant?.name} — {intg.merchant?.phone}</div>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>{envBadge(intg.environment)}</td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <code style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--text-primary)' }}>{intg.publicKey?.substring(0, 24)}...</code>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <code style={{ fontSize: 12, color: 'var(--text-muted)' }}>••••••••••••••••</code>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <span style={{ fontSize: 11, background: '#eff6ff', color: '#3b82f6', padding: '4px 10px', borderRadius: 6, fontWeight: 700 }}>{intg.permissions}</span>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <span style={{ padding: '4px 10px', borderRadius: 6, background: intg.isActive ? 'var(--success-bg)' : 'var(--danger-bg)', color: intg.isActive ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 11, letterSpacing: '0.05em' }}>
                                                {intg.isActive ? 'ACTIVE' : 'INACTIVE'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <button onClick={() => handleToggle(intg.id, intg.isActive)} style={{ padding: '6px 12px', background: intg.isActive ? 'var(--danger-bg)' : 'var(--success-bg)', color: intg.isActive ? 'var(--danger)' : 'var(--success)', border: `1px solid ${intg.isActive ? 'var(--danger)' : '#6ee7b7'}`, borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                                                    {intg.isActive ? 'Désactiver' : 'Activer'}
                                                </button>
                                                <button onClick={() => handleRotate(intg.id)} style={{ padding: '6px 12px', background: 'var(--warning-bg)', color: '#92400e', border: '1px solid var(--warning)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                                                    Rotation
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                }
            </div>
        </div>
    );
}

export default function PlatformConfig({ token, hasPerm, staffId }: { token: string; hasPerm?: (perms: string[]) => boolean; staffId?: string }) {
    const [activeTab, setActiveTab] = useState('general');

    const [settings, setSettings] = useState<any>({});
    const [requests, setRequests] = useState<any[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [reason, setReason] = useState('');

    const [drafts, setDrafts] = useState<any>({});

    // FEE PREVIEW STATE
    const [sim, setSim] = useState({ amount: 100000, type: 'CASH_OUT_AGENCE', kyc: 'TIER1' });

    // Restriction IP du portail (voir tab 'network' ci-dessous)
    const [myIp, setMyIp] = useState<string | null>(null);
    const [newIpInput, setNewIpInput] = useState('');

    useEffect(() => { loadAll(); }, []);

    useEffect(() => {
        fetch(API_URL + '/api/settings/my-ip', { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.json()).then(d => setMyIp(d.ip || null)).catch(() => { });
    }, [token]);

    const fetchSettings = async () => {
        try {
            const resp = await fetch(API_URL + '/api/settings');
            const data = await resp.json();
            if (resp.ok) { setSettings(data); setDrafts(data); }
        } catch (e) { console.error(e); }
    };
    const fetchRequests = async () => {
        try {
            const resp = await fetch(API_URL + '/api/settings/requests', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await resp.json();
            if (resp.ok) setRequests(data);
        } catch (e) { }
    };
    const fetchHistory = async () => {
        try {
            const resp = await fetch(API_URL + '/api/settings/history', { headers: { 'Authorization': `Bearer ${token}` } });
            const data = await resp.json();
            if (resp.ok) setHistory(data);
        } catch (e) { }
    };
    const loadAll = async () => { setLoading(true); await Promise.all([fetchSettings(), fetchRequests(), fetchHistory()]); setLoading(false); };

    const handleFieldChange = (key: string, value: any) => setDrafts((prev: any) => ({ ...prev, [key]: value }));

    // Champs de taux : affichés en % (valeur * 100) mais stockés en décimal en base (0.015 pour
    // 1.5%). `drafts` doit TOUJOURS contenir la forme décimale, comme les valeurs jamais
    // touchées chargées depuis l'API — sinon dès la première frappe `drafts[k]` contenait le
    // pourcentage brut tapé (ex: "2"), réaffiché comme `2 * 100 = 200`, et `handleSaveGroup`
    // divisait en plus par 100 TOUTES les clés du groupe (y compris celles jamais éditées,
    // déjà en décimal), les écrasant à 1/100e de leur valeur réelle à la moindre sauvegarde.
    const handlePercentFieldChange = (key: string, value: string) =>
        setDrafts((prev: any) => ({ ...prev, [key]: value === '' ? 0 : parseFloat(value) / 100 }));

    const submitRequest = async (actionDesc: string, targetPayload: any, customReason?: string) => {
        setError(''); setMessage('');
        const finalReason = customReason || reason || window.prompt('Motif obligatoire pour la Piste d\'Audit :');
        if (!finalReason) { setError('Raison obligatoire ignorée.'); return; }

        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/settings/request', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: actionDesc, payload: targetPayload, reason: finalReason })
            });
            const data = await resp.json();
            if (resp.ok) { setMessage(data.message); setReason(''); loadAll(); }
            else setError(data.error);
        } catch (e) { setError('Erreur Réseau'); } finally { setLoading(false); }
    };

    // Champs secrets affichés en type="password" avec un placeholder masqué (••••XXXX) au lieu
    // de la vraie valeur — un champ jamais touché et un champ vidé par erreur (focus + Ctrl-A +
    // Suppr) sont donc VISUELLEMENT IDENTIQUES (input vide, même placeholder grisé). Sans cette
    // garde, soumettre le groupe après un vidage accidentel enverrait une chaîne vide, que le
    // backend n'a aucun moyen de distinguer d'un "nouveau secret vide" — et écraserait le secret
    // réel en base dès l'approbation Checker. On traite donc "vide" comme "non modifié" pour ces
    // clés : on omet la clé du payload plutôt que d'y mettre une chaîne vide.
    const MASKED_SECRET_KEYS = ['pvitSecretKey', 'pvitWebhookSecret', 'airtelApiKey', 'moovApiKey'];

    // `overrides` sert au cas où une valeur vient tout juste d'être basculée dans le même geste
    // (ex: bouton Circuit Breaker) : `handleFieldChange` programme une mise à jour de `drafts`
    // via setState, qui n'est pas encore appliquée au moment où ce même clic appelle
    // `handleSaveGroup` — lire `drafts[k]` renverrait donc l'ANCIENNE valeur, pas celle qu'on
    // vient de choisir. `overrides` permet de fournir la valeur réelle sans attendre le re-render.
    const handleSaveGroup = (groupAction: string, keys: string[], overrides: Record<string, any> = {}) => {
        const payload: any = {};
        keys.forEach(k => {
            let val = k in overrides ? overrides[k] : drafts[k];
            // `!val` seul ne suffit pas : un champ jamais touché contient encore le placeholder
            // masqué renvoyé par GET (ex: "••••••••ABCD"), une chaîne non-vide — le serveur le
            // rejette déjà silencieusement à l'approbation (settings.ts), mais laissé ici il
            // apparaît à tort comme un "changement proposé" dans la boîte de confirmation et la
            // file d'approbation, trompant le Checker sur ce qui est réellement modifié.
            if (MASKED_SECRET_KEYS.includes(k) && (!val || val.startsWith('••••••••'))) return;
            if (k.toLowerCase().includes('tax') || k.toLowerCase().includes('fee') || k.toLowerCase().includes('reward')) {
                // `drafts[k]` contient déjà la forme décimale correcte, qu'il s'agisse d'une
                // valeur jamais éditée (chargée telle quelle depuis l'API) ou éditée via
                // handlePercentFieldChange (qui reconvertit le % tapé en décimal à la volée) —
                // ne PAS diviser par 100 ici, ce qui écraserait toute clé du groupe.
                payload[k] = parseFloat(val);
            } else if (k.toLowerCase().includes('limit') || k.toLowerCase().includes('threshold') || k.toLowerCase().includes('hours') || k.toLowerCase().includes('count')) {
                payload[k] = parseFloat(val);
            } else {
                payload[k] = val;
            }
        });

        if (Object.keys(payload).length === 0) { setError('Aucune modification à soumettre.'); return; }

        let confirmMsg = `Vous allez soumettre les paramètres suivants à validation:\n\n`;
        Object.keys(payload).forEach(k => confirmMsg += `- ${k}: ${payload[k]}\n`);
        if (!window.confirm(confirmMsg)) return;

        submitRequest(groupAction, payload);
    };

    // Dédié plutôt que handleSaveGroup générique : ajoute un avertissement immédiat côté
    // client si l'IP détectée du Maker lui-même n'est pas dans la liste proposée — le
    // serveur refuse de toute façon à l'approbation (voir settings.ts, même garde côté
    // Checker), mais prévenir ici évite de déposer une demande manifestement bloquante.
    const submitIpAllowlist = () => {
        const enabled = drafts.adminIpAllowlistEnabled;
        const list: string[] = drafts.adminIpAllowlist || [];

        if (enabled && list.length === 0) {
            setError('Impossible de déposer une activation avec une liste vide — cela bloquerait tout le personnel.');
            return;
        }
        if (enabled && myIp && !list.includes(myIp)) {
            if (!window.confirm(`Attention : votre IP actuelle (${myIp}) n'est pas dans la liste. Un Checker devra ajouter la sienne pour pouvoir approuver, sans quoi la demande restera bloquée. Continuer quand même ?`)) return;
        }

        handleSaveGroup('UPDATE_ADMIN_IP_ALLOWLIST', ['adminIpAllowlistEnabled', 'adminIpAllowlist']);
    };

    const handleApprove = async (id: string) => {
        if (!window.confirm('Valider cette modification de politique ? Il impactera immédiatement le système.')) return;

        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/settings/approve/' + id, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
            const data = await resp.json();
            if (resp.ok) { setMessage('Modifications appliquées.'); loadAll(); }
            else setError(data.error);
        } catch (e) { setError('Erreur'); } finally { setLoading(false); }
    };

    const handleReject = async (id: string) => {
        if (!window.confirm('Rejeter cette demande de modification ? Elle ne sera jamais appliquée.')) return;

        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/settings/requests/' + id, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            const data = await resp.json();
            if (resp.ok) { setMessage('Requête rejetée.'); loadAll(); }
            else setError(data.error);
        } catch (e) { setError('Erreur'); } finally { setLoading(false); }
    };

    const simulateFee = () => {
        const amt = parseFloat(sim.amount as any) || 0;
        // Un dépôt (Cash-In) est toujours gratuit, en agence comme chez un commerçant —
        // voir backend CashOperationService.executeCashIn, qui ne prélève plus aucun frais
        // quelle que soit la configuration. taxCashIn n'a donc plus aucun effet ; ignoré ici
        // pour que ce simulateur reflète fidèlement ce que le client paiera réellement.
        if (sim.type === 'CASH_IN') return 0;
        // Retrait Agence (guichet Staff / réseau d'agents) : gratuit jusqu'au seuil, puis
        // un taux marginal sur le seul dépassement — pas sur le montant entier une fois le
        // seuil franchi (voir backend CashOperationService.ts / wallet.ts qr-cash-out,
        // corrigés pour appliquer exactement cette formule).
        if (sim.type === 'CASH_OUT_AGENCE') {
            const threshold = settings.agencyWithdrawThreshold || 500000;
            if (amt <= threshold) return 0;
            return (amt - threshold) * (settings.agencyTaxWithdraw || 0);
        }
        // Retrait chez un Marchand : taux fixe, aucun seuil gratuit — distinct du retrait
        // Agence ci-dessus (voir wallet.ts /client-initiated-withdraw).
        if (sim.type === 'CASH_OUT_MARCHAND') return amt * (settings.taxWithdraw || 0);
        if (sim.type === 'P2P') return amt * (settings.taxP2P || 0);
        return 0;
    };

    const tabs = [
        { id: 'general', label: 'Général', icon: <Globe size={18} /> },
        { id: 'fees', label: 'Politique de Frais (Taxes)', icon: <Activity size={18} /> },
        { id: 'treasury', label: 'Trésorerie & Liquidité', icon: <Wallet size={18} /> },
        { id: 'limits', label: 'Plafonds & KYC', icon: <Shield size={18} /> },
        { id: 'antifraud', label: 'Anti-Fractionnement', icon: <UserCheck size={18} /> },
        { id: 'integrations', label: 'Intégrations (API)', icon: <Database size={18} /> },
        { id: 'gateways', label: 'Passerelles de Paiement', icon: <Smartphone size={18} /> },
        // Rouge assumé, y compris inactif : coupe-circuit du système de paiement, pas un
        // onglet comme les autres — le signal visuel d'alerte est intentionnel (voir TabBar.tsx).
        { id: 'breaker', label: 'Circuit Breaker', icon: <Power size={18} />, activeBg: 'var(--danger)', activeColor: 'var(--btn-dark-text)' },
        { id: 'network', label: 'Sécurité Réseau', icon: <Lock size={18} /> },
        { id: 'approvals', label: 'Approbation (Checker) ' + (requests.filter(r => r.status === 'PENDING').length ? `(${requests.filter(r => r.status === 'PENDING').length})` : ''), icon: <CheckCircle size={18} /> },
        { id: 'history', label: 'Historique', icon: <Clock size={18} /> }
    ];

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ marginBottom: 20 }}>
                <PageHeader
                    title="Gouvernance V18"
                    subtitle="Gestion centralisée instantanée. Les Super Admins valident sans attente (Auto-Approve)."
                    action={
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Environnement Actif</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--success)' }}>{settings.platformName || 'Mongain V6'} — PRODUCTION</div>
                        </div>
                    }
                />
            </div>

            {message && <div style={{ padding: 15, background: 'var(--success-bg)', color: 'var(--success)', borderRadius: 8, marginBottom: 20, border: '1px solid var(--success)', fontWeight: 600 }}>✓ {message}</div>}
            {error && <div style={{ padding: 15, background: 'var(--danger-bg)', color: 'var(--danger)', borderRadius: 8, marginBottom: 20, border: '1px solid var(--danger)', fontWeight: 600 }}>✕ {error}</div>}

            <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

            {loading ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><Activity size={24} className="spin" /></div> : (
                <div style={{ display: 'flex', gap: 24 }}>
                    <div style={{ flex: 1 }}>

                        {/* TAB: GENERAL */}
                        {activeTab === 'general' && (
                            <div className="card" style={{ padding: 24 }}>
                                <h3>Informations Globales</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    <div><label>Nom de la plateforme</label><input className="input" value={drafts.platformName || ''} onChange={e => handleFieldChange('platformName', e.target.value)} /></div>
                                    <div><label>Monnaie</label><input className="input" value={drafts.currency || ''} onChange={e => handleFieldChange('currency', e.target.value)} /></div>
                                    <div><label>Email Support</label><input className="input" value={drafts.supportEmail || ''} onChange={e => handleFieldChange('supportEmail', e.target.value)} /></div>
                                    <div><label>Téléphone Support</label><input className="input" value={drafts.supportPhone || ''} onChange={e => handleFieldChange('supportPhone', e.target.value)} /></div>
                                </div>
                                <button className="btn" style={{ marginTop: 24, padding: '14px 24px', background: '#4F46E5', borderRadius: 12 }} onClick={() => handleSaveGroup('UPDATE_GENERAL', ['platformName', 'currency', 'supportEmail', 'supportPhone'])}>💾 Enregistrer les Modifications</button>
                            </div>
                        )}

                        {/* TAB: FEES */}
                        {activeTab === 'fees' && (
                            <div>
                                <div className="card" style={{ padding: 24, marginBottom: 24 }}>
                                    <h3>Frais de Transactions (Taxes)</h3>
                                    <div style={{ display: 'flex', overflowX: 'auto', gap: 24, paddingBottom: 16 }}>
                                        <div style={{ minWidth: 280, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                            <h4 style={{ margin: '0 0 12px', color: 'var(--accent)' }}>Retrait Agence (guichet)</h4>
                                            <div><label>Seuil de Retrait Gratuit (FCFA)</label><input className="input" type="number" value={drafts.agencyWithdrawThreshold || 0} onChange={e => handleFieldChange('agencyWithdrawThreshold', e.target.value)} /></div>
                                            <div style={{ marginTop: 12 }}><label>Taux au-delà du seuil, sur le dépassement (%)</label><input className="input" type="number" step="0.01" value={(drafts.agencyTaxWithdraw || 0) * 100} onChange={e => handlePercentFieldChange('agencyTaxWithdraw', e.target.value)} /></div>
                                        </div>
                                        <div style={{ minWidth: 280, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                            <h4 style={{ margin: '0 0 12px', color: '#f59e0b' }}>Retrait Marchand</h4>
                                            <div><label>Taux fixe, sans seuil (%)</label><input className="input" type="number" step="0.01" value={(drafts.taxWithdraw || 0) * 100} onChange={e => handlePercentFieldChange('taxWithdraw', e.target.value)} /></div>
                                            <div style={{ marginTop: 12 }}><label>Commission reversée au marchand (%)</label><input className="input" type="number" step="0.01" value={(drafts.rewardMerchant || 0) * 100} onChange={e => handlePercentFieldChange('rewardMerchant', e.target.value)} /></div>
                                        </div>
                                        <div style={{ minWidth: 280, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                            <h4 style={{ margin: '0 0 12px', color: 'var(--success)' }}>Dépôt (Cash-In) & P2P</h4>
                                            <div>
                                                <label>Dépôt — Agence &amp; Marchand</label>
                                                <div style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--success-bg, rgba(16,185,129,0.1))', color: 'var(--success)', fontWeight: 700, fontSize: 13 }}>
                                                    Toujours 100% gratuit — non configurable
                                                </div>
                                            </div>
                                            <div style={{ marginTop: 12 }}><label>Taux P2P (%)</label><input className="input" type="number" step="0.01" value={(drafts.taxP2P || 0) * 100} onChange={e => handlePercentFieldChange('taxP2P', e.target.value)} /></div>
                                        </div>
                                        <div style={{ minWidth: 280, padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)', borderTop: '4px solid #8B5CF6' }}>
                                            <h4 style={{ margin: '0 0 12px', color: '#8B5CF6' }}>V18: Credit & Forex</h4>
                                            <div><label>Intérêt Micro-Crédit (BNPL)</label><input className="input" type="number" step="0.1" value={(drafts.bnplInterest || 0) * 100} onChange={e => handlePercentFieldChange('bnplInterest', e.target.value)} /></div>
                                            <div style={{ marginTop: 12 }}><label>FX Remise (Cross Border)</label><input className="input" type="number" step="0.1" value={(drafts.forexMarkup || 0) * 100} onChange={e => handlePercentFieldChange('forexMarkup', e.target.value)} /></div>
                                            <div style={{ marginTop: 12 }}><label>Plafond Absolu KYC</label><input className="input" type="number" value={drafts.kycReqAmount || 2000000} onChange={e => handleFieldChange('kycReqAmount', e.target.value)} /></div>
                                        </div>
                                    </div>
                                    <button className="btn" style={{ marginTop: 24, padding: '14px 24px', background: '#059669', borderRadius: 12 }} onClick={() => handleSaveGroup('UPDATE_FEES', ['taxWithdraw', 'agencyWithdrawThreshold', 'agencyTaxWithdraw', 'rewardMerchant', 'taxP2P', 'bnplInterest', 'forexMarkup', 'kycReqAmount'])}>💾 Enregistrer les Taxes & Limites V18</button>
                                </div>

                                <div className="card" style={{ padding: 24, background: '#1e293b', color: 'white' }}>
                                    <h3 style={{ borderBottom: '1px solid #334155', paddingBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}><Calculator size={20} /> FEE PREVIEW / Simulateur</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 16 }}>
                                        <div><label style={{ color: '#94a3b8' }}>Type d'Opération</label><select className="input" style={{ width: 'auto', flex: '1 1 150px', background: '#0f172a', color: 'white', border: '1px solid #334155' }} value={sim.type} onChange={e => setSim({ ...sim, type: e.target.value })}><option value="CASH_OUT_AGENCE">Retrait Agence (guichet)</option><option value="CASH_OUT_MARCHAND">Retrait Marchand</option><option value="CASH_IN">Cash-In (Dépôt)</option><option value="P2P">Transfert (End-to-End)</option></select></div>
                                        <div><label style={{ color: '#94a3b8' }}>Niveau Client</label><select className="input" style={{ width: 'auto', flex: '1 1 150px', background: '#0f172a', color: 'white', border: '1px solid #334155' }} value={sim.kyc} onChange={e => setSim({ ...sim, kyc: e.target.value })}><option value="TIER0">Non-Vérifié (Tier 0)</option><option value="TIER1">Vérifié (Tier 1)</option></select></div>
                                        <div><label style={{ color: '#94a3b8' }}>Montant</label><input className="input" type="number" style={{ background: '#0f172a', color: 'white', border: '1px solid #334155', fontSize: 18, fontWeight: 800 }} value={sim.amount} onChange={e => setSim({ ...sim, amount: Number(e.target.value) })} /></div>
                                    </div>
                                    <div style={{ marginTop: 24, padding: 16, background: '#0f172a', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #334155' }}>
                                        <div><div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>Frais Estimés (Selon politique actuelle)</div><div style={{ fontSize: 24, fontWeight: 900, color: 'var(--success)' }}>{simulateFee().toLocaleString('fr-GA')} FCFA</div></div>
                                        <div style={{ textAlign: 'right' }}><div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 700 }}>Total à payer ou déduire</div><div style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>{(sim.amount + simulateFee()).toLocaleString('fr-GA')} FCFA</div></div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB: TREASURY */}
                        {activeTab === 'treasury' && (
                            <div className="card" style={{ padding: 24, marginBottom: 24 }}>
                                <h3>Seuils de Trésorerie & Liquidité</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                                    <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                        <h4 style={{ margin: '0 0 12px', color: 'var(--accent)' }}>Réserve Centrale (Siège)</h4>
                                        <div><label>Plafond Création (Mint Amount)</label><input className="input" type="number" value={drafts.maxMintAmount || 0} onChange={e => handleFieldChange('maxMintAmount', e.target.value)} /></div>
                                        <div style={{ marginTop: 12 }}><label>Seuil d'Approbation Super Admin</label><input className="input" type="number" value={drafts.treasuryApprovalThreshold || 0} onChange={e => handleFieldChange('treasuryApprovalThreshold', e.target.value)} /></div>
                                    </div>
                                    <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                        <h4 style={{ margin: '0 0 12px', color: '#ec4899' }}>Liquidité Succursales (E-Wallets)</h4>
                                        <div><label>Alerte Liquidité Faible (LOW)</label><input className="input" type="number" value={drafts.agencyLowLiquidityThreshold || 0} onChange={e => handleFieldChange('agencyLowLiquidityThreshold', e.target.value)} /></div>
                                        <div style={{ marginTop: 12 }}><label>Alerte Liquidité Critique (CRITICAL)</label><input className="input" type="number" value={drafts.agencyCriticalLiquidity || 0} onChange={e => handleFieldChange('agencyCriticalLiquidity', e.target.value)} /></div>
                                    </div>
                                </div>
                                <button className="btn" style={{ marginTop: 24, padding: '14px 24px', background: '#3B82F6', borderRadius: 12 }} onClick={() => handleSaveGroup('UPDATE_TREASURY_POLICIES', ['maxMintAmount', 'treasuryApprovalThreshold', 'agencyLowLiquidityThreshold', 'agencyCriticalLiquidity'])}>💾 Appliquer aux Coffres Forts</button>
                            </div>
                        )}

                        {/* TAB: LIMITS */}
                        {activeTab === 'limits' && (
                            <div className="card" style={{ padding: 24 }}>
                                <h3>Plafonds d'Activité KYC</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 1fr 1fr', gap: 16 }}>
                                    <div style={{ fontWeight: 800, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>Tier 0 (Non-Vérifié)</div>
                                    <div><label>Journalier</label><input className="input" type="number" value={drafts.dailyLimitTier0} onChange={e => handleFieldChange('dailyLimitTier0', e.target.value)} /></div>
                                    <div><label>Par transaction</label><input className="input" type="number" value={drafts.perTxLimitTier0} onChange={e => handleFieldChange('perTxLimitTier0', e.target.value)} /></div>

                                    <div style={{ fontWeight: 800, padding: 16, background: '#dbeafe', color: '#1e40af', borderRadius: 8 }}>Tier 1 (Vérifié Standard)</div>
                                    <div><label>Journalier</label><input className="input" type="number" value={drafts.dailyLimitTier1} onChange={e => handleFieldChange('dailyLimitTier1', e.target.value)} /></div>
                                    <div><label>Par transaction</label><input className="input" type="number" value={drafts.perTxLimitTier1} onChange={e => handleFieldChange('perTxLimitTier1', e.target.value)} /></div>
                                </div>
                                <button className="btn" style={{ marginTop: 24, width: '100%' }} onClick={() => handleSaveGroup('UPDATE_LIMITS', ['dailyLimitTier0', 'perTxLimitTier0', 'dailyLimitTier1', 'perTxLimitTier1'])}>Déposer Changement (Maker)</button>
                            </div>
                        )}

                        {/* TAB: ANTI-FRACTIONING */}
                        {activeTab === 'antifraud' && (
                            <div className="card" style={{ padding: 24 }}>
                                <h3>Moteur d'Anti-Fractionnement (Limites Globales d'Escive)</h3>
                                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>Règle : "Empêcher un client de fractionner un gros retrait en petites sommes dans plusieurs agences sur une fenêtre courte pour éviter des frais."</p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    <div><label>Fenêtre de Cumul (Heures)</label><input className="input" type="number" value={drafts.antiFractioningWindowHours} onChange={e => handleFieldChange('antiFractioningWindowHours', e.target.value)} /></div>
                                    <div><label>Seuil d'Alerte (Montant Cumulé)</label><input className="input" type="number" value={drafts.antiFractioningMaxAmount} onChange={e => handleFieldChange('antiFractioningMaxAmount', e.target.value)} /></div>
                                    <div><label>Nombre Max d'Opérations avant sanction</label><input className="input" type="number" value={drafts.antiFractioningMaxCount} onChange={e => handleFieldChange('antiFractioningMaxCount', e.target.value)} /></div>
                                    <div><label>Action Automatique à prendre</label>
                                        <select className="input" value={drafts.antiFractioningAction} onChange={e => handleFieldChange('antiFractioningAction', e.target.value)}>
                                            <option value="ALLOW">Observer / Télémétrie</option>
                                            <option value="APPLY_FEE">Appliquer les gros frais de force</option>
                                            <option value="BLOCK">Bloquer la énième transaction</option>
                                        </select>
                                    </div>
                                </div>
                                <button className="btn" style={{ marginTop: 24, width: '100%' }} onClick={() => handleSaveGroup('UPDATE_ANTIFRAUD', ['antiFractioningWindowHours', 'antiFractioningMaxAmount', 'antiFractioningMaxCount', 'antiFractioningAction'])}>Déposer Changement (Maker)</button>

                                <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                                    <h3>Pénalité de Retard — Tontine</h3>
                                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                                        Pourcentage de la cotisation prélevé, en plus de celle-ci, à tout participant n'ayant pas complété son versement à l'échéance du tour. Désactivée tant que le taux reste à 0 — aucun utilisateur ne doit se voir prélever une pénalité qu'il n'a jamais acceptée sans qu'un opérateur l'active explicitement ici.
                                    </p>
                                    <div style={{ maxWidth: 320 }}>
                                        <label>Taux de pénalité (%)</label>
                                        <input className="input" type="number" step="0.01" min="0" max="100" value={(drafts.tontineLatePenaltyRate || 0) * 100} onChange={e => handlePercentFieldChange('tontineLatePenaltyRate', e.target.value)} />
                                    </div>
                                    <button className="btn" style={{ marginTop: 16, width: '100%' }} onClick={() => handleSaveGroup('UPDATE_TONTINE_PENALTY', ['tontineLatePenaltyRate'])}>Déposer Changement (Maker)</button>
                                </div>
                            </div>
                        )}


                        {/* TAB: INTEGRATIONS — API MANAGEMENT */}
                        {activeTab === 'integrations' && <ApiManagementTab token={token} />}

                        {/* TAB: PASSERELLES DE PAIEMENT — PVit (Dépôt Mobile Money) */}
                        {activeTab === 'gateways' && (
                            <div>
                                <div className="card" style={{ padding: 24, marginBottom: 24 }}>
                                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Power size={20} /> Activer / Désactiver les Canaux</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: -8, marginBottom: 20 }}>
                                        Coupe-circuit par opérateur — désactive l'option correspondante dans l'app mobile, indépendamment des identifiants PVit configurés plus bas. Utile pour couper un canal en maintenance ou pendant les tests, sans toucher aux identifiants.
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        {[
                                            { key: 'airtelEnabled', label: 'Airtel Money', color: '#EF4444' },
                                            { key: 'moovEnabled', label: 'Moov Africa', color: '#3B82F6' },
                                        ].map(({ key, label, color }) => {
                                            const isOn = drafts[key] !== undefined ? drafts[key] : settings[key];
                                            return (
                                                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                        <Smartphone size={18} color={color} />
                                                        <span style={{ fontWeight: 700 }}>{label}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleFieldChange(key, !isOn)}
                                                        style={{
                                                            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                                                            background: isOn ? 'var(--success-bg)' : 'var(--danger-bg)',
                                                            color: isOn ? 'var(--success)' : 'var(--danger)',
                                                        }}
                                                    >
                                                        {isOn ? 'ACTIVÉ' : 'DÉSACTIVÉ'}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <button className="btn" style={{ marginTop: 20, width: '100%' }} onClick={() => handleSaveGroup('TOGGLE_MOBILE_MONEY_CHANNELS', ['airtelEnabled', 'moovEnabled'])}>Déposer Changement (Maker)</button>
                                </div>

                                <div className="card" style={{ padding: 24 }}>
                                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={20} /> PVit — Dépôt Mobile Money (Airtel/Moov)</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: -8, marginBottom: 20 }}>
                                        Identifiants de l'agrégateur de paiement PVit (mypvit.pro), utilisés par le backend pour initier un dépôt Mobile Money réel. Valeurs disponibles dans ton tableau de bord PVit : Paramétrages → APIs (clé secrète, code URL "REST"), Comptes (compte d'opération), Urls (code de callback).
                                    </p>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        <div>
                                            <label>Clé secrète (X-Secret)</label>
                                            <input className="input" type="password" placeholder={settings.pvitSecretKey || 'Non configurée'} value={drafts.pvitSecretKey === settings.pvitSecretKey ? '' : (drafts.pvitSecretKey || '')} onChange={e => handleFieldChange('pvitSecretKey', e.target.value)} />
                                        </div>
                                        <div>
                                            <label>Code URL de paiement (endpoint REST)</label>
                                            <input className="input" value={drafts.pvitCodeUrlPayment || ''} onChange={e => handleFieldChange('pvitCodeUrlPayment', e.target.value)} placeholder="ex: 5OPBYBDCK1ZGH681" />
                                        </div>
                                        <div>
                                            <label>Compte d'opération marchand</label>
                                            <input className="input" value={drafts.pvitMerchantOperationAccountCode || ''} onChange={e => handleFieldChange('pvitMerchantOperationAccountCode', e.target.value)} placeholder="ex: ACC_XXXXXXXXXXXX" />
                                        </div>
                                        <div>
                                            <label>Code de l'URL de callback</label>
                                            <input className="input" value={drafts.pvitCallbackUrlCode || ''} onChange={e => handleFieldChange('pvitCallbackUrlCode', e.target.value)} placeholder="ex: GW7O6" />
                                        </div>
                                    </div>

                                    <div style={{ marginTop: 20 }}>
                                        <label>Clé de webhook (à mettre dans l'URL enregistrée sur PVit)</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input className="input" type="password" style={{ flex: 1 }} placeholder={settings.pvitWebhookSecret || 'Non configurée'} value={drafts.pvitWebhookSecret === settings.pvitWebhookSecret ? '' : (drafts.pvitWebhookSecret || '')} onChange={e => handleFieldChange('pvitWebhookSecret', e.target.value)} />
                                            <button
                                                type="button"
                                                onClick={() => handleFieldChange('pvitWebhookSecret', Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join(''))}
                                                style={{ padding: '0 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                            >
                                                <RefreshCw size={14} /> Générer
                                            </button>
                                        </div>
                                    </div>

                                    {drafts.pvitWebhookSecret && drafts.pvitWebhookSecret !== settings.pvitWebhookSecret && (
                                        <div style={{ marginTop: 16, padding: 14, background: 'var(--accent-bg)', borderRadius: 10, border: '1px solid var(--accent)' }}>
                                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>URL À ENREGISTRER SUR PVIT (section "Urls") UNE FOIS CE CHANGEMENT DÉPOSÉ ET APPROUVÉ</div>
                                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                                <code style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, fontSize: 12, wordBreak: 'break-all' }}>
                                                    https://mongain-backend.onrender.com/api/webhooks/pvit-status?key={drafts.pvitWebhookSecret}
                                                </code>
                                                <button type="button" onClick={() => navigator.clipboard.writeText(`https://mongain-backend.onrender.com/api/webhooks/pvit-status?key=${drafts.pvitWebhookSecret}`)} style={{ padding: '8px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: 'pointer' }}><Copy size={14} /></button>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ marginTop: 20, padding: 14, background: 'var(--bg-secondary)', borderRadius: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
                                        Statut actuel : {settings.pvitSecretKey && settings.pvitCodeUrlPayment && settings.pvitMerchantOperationAccountCode && settings.pvitCallbackUrlCode
                                            ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>✓ Configuré — le dépôt Mobile Money est actif.</span>
                                            : <span style={{ color: 'var(--warning)', fontWeight: 700 }}>⚠ Incomplet — le dépôt Mobile Money reste désactivé tant que les 4 champs ci-dessus ne sont pas remplis.</span>}
                                    </div>

                                    <button className="btn" style={{ marginTop: 20, width: '100%' }} onClick={() => handleSaveGroup('CONFIGURE_PVIT', ['pvitSecretKey', 'pvitCodeUrlPayment', 'pvitMerchantOperationAccountCode', 'pvitCallbackUrlCode', 'pvitWebhookSecret'])}>Déposer Changement (Maker)</button>
                                </div>
                            </div>
                        )}

                        {/* TAB: CIRCUIT BREAKER */}
                        {activeTab === 'breaker' && (
                            <div className="card" style={{ padding: 32, border: '2px solid var(--danger)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--danger-bg)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Power size={32} /></div>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: 24, color: 'var(--danger)' }}>CIRCUIT BREAKER (Kill Switch)</h3>
                                        <p style={{ margin: '4px 0 0', color: 'var(--text-muted)' }}>Bloque IMMÉDIATEMENT toutes les transactions financières (Cash-In, Cash-Out, P2P) de toute la plateforme Mongain.</p>
                                    </div>
                                </div>
                                <div style={{ padding: 20, background: 'var(--bg-secondary)', borderRadius: 12, marginBottom: 24, fontWeight: 700, fontSize: 16 }}>
                                    Statut Actuel : {settings.circuitBreaker ? <span style={{ color: 'var(--danger)' }}>ACTIVÉ (BLOCKING)</span> : <span style={{ color: 'var(--success)' }}>DÉSACTIVÉ (OPERATIONAL)</span>}
                                </div>
                                <button onClick={() => {
                                    const next = !settings.circuitBreaker;
                                    handleFieldChange('circuitBreaker', next);
                                    handleSaveGroup('CIRCUIT_BREAKER_TOGGLE', ['circuitBreaker'], { circuitBreaker: next });
                                }} style={{ width: '100%', padding: 24, background: settings.circuitBreaker ? '#f1f5f9' : 'var(--danger)', color: settings.circuitBreaker ? 'black' : 'white', borderRadius: 12, border: 'none', fontWeight: 900, fontSize: 20, cursor: 'pointer' }}>
                                    {settings.circuitBreaker ? 'DÉSACTIVER (Restore Services)' : "DÉCLENCHER LE CIRCUIT BREAKER (Maker)"}
                                </button>
                            </div>
                        )}

                        {/* TAB: NETWORK — restriction IP du portail personnel */}
                        {activeTab === 'network' && (
                            <div className="card" style={{ padding: 24 }}>
                                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Lock size={20} /> Restriction IP du Portail</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: -8, marginBottom: 20 }}>
                                    Équivalent applicatif d'un VPN entre l'admin-web et le backend : une fois activée, seules les adresses IP listées ci-dessous peuvent atteindre les routes réservées au personnel (connexion, gestion des clients, trésorerie, etc.) — l'application mobile des clients n'est jamais concernée. Désactivée par défaut.
                                </p>

                                <div style={{ padding: 14, background: 'var(--accent-bg)', borderRadius: 10, marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                    <div style={{ fontSize: 13 }}>Votre adresse IP détectée : <code style={{ fontWeight: 800 }}>{myIp || 'détection en cours…'}</code></div>
                                    {myIp && (
                                        <button type="button" onClick={() => {
                                            const list: string[] = drafts.adminIpAllowlist || [];
                                            if (!list.includes(myIp)) handleFieldChange('adminIpAllowlist', [...list, myIp]);
                                        }} style={{ padding: '6px 14px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                                            + Ajouter mon IP à la liste
                                        </button>
                                    )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-secondary)', marginBottom: 20 }}>
                                    <div>
                                        <div style={{ fontWeight: 700 }}>Restriction activée</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Statut actuel : {settings.adminIpAllowlistEnabled ? <span style={{ color: 'var(--success)', fontWeight: 700 }}>ACTIVÉE</span> : <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>DÉSACTIVÉE</span>}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleFieldChange('adminIpAllowlistEnabled', !(drafts.adminIpAllowlistEnabled !== undefined ? drafts.adminIpAllowlistEnabled : settings.adminIpAllowlistEnabled))}
                                        style={{
                                            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                                            background: (drafts.adminIpAllowlistEnabled !== undefined ? drafts.adminIpAllowlistEnabled : settings.adminIpAllowlistEnabled) ? 'var(--success-bg)' : 'var(--danger-bg)',
                                            color: (drafts.adminIpAllowlistEnabled !== undefined ? drafts.adminIpAllowlistEnabled : settings.adminIpAllowlistEnabled) ? 'var(--success)' : 'var(--danger)',
                                        }}
                                    >
                                        {(drafts.adminIpAllowlistEnabled !== undefined ? drafts.adminIpAllowlistEnabled : settings.adminIpAllowlistEnabled) ? 'ACTIVÉE' : 'DÉSACTIVÉE'}
                                    </button>
                                </div>

                                <label>Adresses IP autorisées</label>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                    <input
                                        className="input" placeholder="ex: 203.0.113.5" value={newIpInput}
                                        onChange={e => setNewIpInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key !== 'Enter' || !newIpInput.trim()) return;
                                            const list: string[] = drafts.adminIpAllowlist || [];
                                            if (!list.includes(newIpInput.trim())) handleFieldChange('adminIpAllowlist', [...list, newIpInput.trim()]);
                                            setNewIpInput('');
                                        }}
                                    />
                                    <button type="button" onClick={() => {
                                        if (!newIpInput.trim()) return;
                                        const list: string[] = drafts.adminIpAllowlist || [];
                                        if (!list.includes(newIpInput.trim())) handleFieldChange('adminIpAllowlist', [...list, newIpInput.trim()]);
                                        setNewIpInput('');
                                    }} style={{ padding: '0 18px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Ajouter</button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                                    {(drafts.adminIpAllowlist || []).length === 0 ? (
                                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>Aucune IP dans la liste.</div>
                                    ) : (drafts.adminIpAllowlist || []).map((ip: string) => (
                                        <div key={ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 8 }}>
                                            <code style={{ fontWeight: 700 }}>{ip}{myIp === ip && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>(vous)</span>}</code>
                                            <button type="button" onClick={() => handleFieldChange('adminIpAllowlist', (drafts.adminIpAllowlist || []).filter((x: string) => x !== ip))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', display: 'flex', alignItems: 'center' }}>
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                <button className="btn" style={{ width: '100%' }} onClick={submitIpAllowlist}>Déposer Changement (Maker)</button>
                            </div>
                        )}

                        {/* TAB: APPROVALS */}
                        {activeTab === 'approvals' && (
                            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                <div style={{ padding: 24, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>Centre d'Approbation (Checker)</h3></div>
                                {requests.filter(r => r.status === 'PENDING').length === 0 ? (
                                    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Aucun paramètre en attente d'approbation.</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                                {['Maker', 'Action', 'Motif', 'Actions Checker'].map((h, i) => (
                                                    <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {requests.filter(r => r.status === 'PENDING').map(r => {
                                                const canApprove = hasPerm ? hasPerm(['perm_system_settings_approve']) : true;
                                                const isSuperAdmin = hasPerm ? hasPerm(['perm_staff_permissions_edit']) : false;
                                                const isOwnRequest = !!staffId && r.maker?.id === staffId && !isSuperAdmin;

                                                return (
                                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                        <td style={{ padding: '16px 20px' }}>
                                                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{r.maker.name}</div>
                                                            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.maker.role}</div>
                                                        </td>
                                                        <td style={{ padding: '16px 20px', fontWeight: 800, color: 'var(--text-primary)' }}>{r.action}</td>
                                                        <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>{r.reason}</td>
                                                        <td style={{ padding: '16px 20px' }}>
                                                            {!canApprove ? (
                                                                <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>En attente d'approbation...</span>
                                                            ) : isOwnRequest ? (
                                                                <span style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: 12 }} title="Vous ne pouvez pas approuver votre propre demande.">Votre propre demande (Bloqué)</span>
                                                            ) : (
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    <button onClick={() => handleApprove(r.id)} style={{ padding: '8px 16px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>Valider</button>
                                                                    <button onClick={() => handleReject(r.id)} style={{ padding: '8px 16px', background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 12 }}>Rejeter</button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                        {/* TAB: HISTORY */}
                        {activeTab === 'history' && (
                            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                                <div style={{ padding: 24, borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>Historique des Modifications Système</h3>
                                    <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>Piste d'audit de chaque changement de paramètre majeur.</p>
                                </div>
                                {history.length === 0 ? (
                                    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Aucune modification enregistrée.</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                        <thead>
                                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                                {['Date', 'Paramètre', 'Changement', 'Auteurs'].map((h, i) => (
                                                    <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {history.map(h => (
                                                <tr key={h.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                    <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 600 }}>{new Date(h.createdAt).toLocaleString()}</td>
                                                    <td style={{ padding: '16px 20px', fontWeight: 800, color: 'var(--text-primary)' }}>{h.parameter}</td>
                                                    <td style={{ padding: '16px 20px', fontSize: 13 }}>
                                                        <div style={{ color: 'var(--danger)', textDecoration: 'line-through', marginBottom: 2 }}>{h.oldValue || '∅'}</div>
                                                        <div style={{ color: 'var(--success)', fontWeight: 700 }}>{h.newValue || '∅'}</div>
                                                        <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>"{h.reason}"</div>
                                                    </td>
                                                    <td style={{ padding: '16px 20px', fontSize: 12 }}>
                                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Maker : <span style={{ fontWeight: 600 }}>{h.author?.name || 'Inconnu'}</span></div>
                                                        <div style={{ fontWeight: 700, color: 'var(--success)', marginTop: 4 }}>Validé par : <span style={{ fontWeight: 600 }}>{h.checker?.name || 'Inconnu'}</span></div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
