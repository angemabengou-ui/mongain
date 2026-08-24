import { AlertTriangle, CheckCircle, Download, LogIn, LogOut, RefreshCw, Search, Upload, User, XCircle, ZoomIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';
import ImageLightbox from './components/ImageLightbox';

const fmt = (n: number) => n.toLocaleString('fr-GA') + ' FCFA';

export default function TellerTerminal({ token, userName }: { token: string; userName: string }) {
    const [session, setSession] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    // Vérification d'identité en agence : jusqu'ici, l'identification client (lookup par
    // téléphone) ne remontait ni ne montrait aucune photo — impossible pour le caissier de
    // comparer la personne en face de lui à la pièce d'identité au dossier.
    const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

    // Forms & Modals
    const [openForm, setOpenForm] = useState({ initialCash: '' });
    const [closeForm, setCloseForm] = useState({ countedCash: '' });
    const [showCloseModal, setShowCloseModal] = useState(false);

    // Operation State
    const [opType, setOpType] = useState(''); // 'CASH_IN' | 'CASH_OUT'
    const [phone, setPhone] = useState('');
    const [amount, setAmount] = useState('');
    const [clientInfo, setClientInfo] = useState<any>(null);
    const [step, setStep] = useState(1); // 1: Input, 2: Confirm, 3: Success

    // Loading states
    const [clientLoading, setClientLoading] = useState(false);
    const [opLoading, setOpLoading] = useState(false);

    // Result state
    const [opResult, setOpResult] = useState<{ amount: number; fee: number; reference: string; type: string } | null>(null);

    // Idempotency
    const [idempotencyKey, setIdempotencyKey] = useState('');

    // Retrait par Code Secret
    const [codeValue, setCodeValue] = useState('');

    const fetchSession = async () => {
        setLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/agency/sessions`, { headers: { Authorization: `Bearer ${token}` } });
            const data = await resp.json();
            if (resp.ok) setSession(Array.isArray(data) ? data.find((s: any) => s.status === 'OPEN') ?? null : null);
        } catch (e: any) { alert(e.message); } finally { setLoading(false); }
    };

    useEffect(() => { fetchSession(); }, []);

    // 1. Ouvrir Session
    const handleOpenShift = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/agency/sessions/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ initialCash: parseFloat(openForm.initialCash) })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            setSession(data.session);
        } catch (e: any) { alert(e.message); } finally { setLoading(false); }
    };

    // 2. Clôturer Session
    const handleCloseShift = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/agency/sessions/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ finalCash: parseFloat(closeForm.countedCash) })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            const { discrepancy } = data.session;
            if (discrepancy !== 0) {
                alert(`Session clôturée avec un écart de ${fmt(Math.abs(discrepancy))} (${discrepancy > 0 ? 'Excédent' : 'Déficit'}) ! Une alerte a été générée.`);
            } else {
                alert('Caisse clôturée avec succès, rapprochement parfait.');
            }
            setSession(null);
            setShowCloseModal(false);
        } catch (e: any) { alert(e.message); } finally { setLoading(false); }
    };

    // 3. Chercher Client — retourne le client trouvé (ou null) plutôt que de ne faire que
    // poser l'état, pour pouvoir être ré-utilisé de façon synchrone par proceedToConfirm.
    const fetchClient = async (): Promise<any> => {
        if (phone.length < 9) { alert('Numéro invalide'); return null; }
        setClientLoading(true);
        try {
            const r = await fetch(`${API_URL}/api/admin/teller/lookup/${encodeURIComponent(phone)}`, { headers: { Authorization: `Bearer ${token}` } });
            const d = await r.json();
            if (r.ok) { setClientInfo(d); return d; }
            alert(d.error || 'Client introuvable');
            return null;
        } catch (e: any) { alert(e.message); return null; } finally { setClientLoading(false); }
    };

    // 4. Passer à l'étape 2 (Confirmation) — identifie le client automatiquement si l'agent a
    // tapé le numéro mais oublié de cliquer sur la loupe, au lieu de juste bloquer avec une
    // alerte : "Continuer" fait le nécessaire plutôt que d'exiger une étape cachée.
    const proceedToConfirm = async () => {
        if (!opType) return alert('Sélectionnez un type d\'opération');
        if (!amount || parseFloat(amount) <= 0) return alert('Montant invalide');
        const client = clientInfo || await fetchClient();
        if (!client) return;
        setIdempotencyKey(`OP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`);
        setStep(2);
    };

    // 5. Exécuter Opération (Etape 2 -> 3)
    const executeOperation = async () => {
        setOpLoading(true);
        const endpoint = opType === 'CASH_IN' ? 'cash-in' : 'cash-out';
        try {
            const r = await fetch(`${API_URL}/api/agency/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ clientPhone: phone, amount: parseFloat(amount), idempotencyKey })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);

            setOpResult({ amount: parseFloat(amount), fee: d.transaction?.fee || 0, reference: d.transaction?.reference || 'T-' + Date.now(), type: opType });
            setStep(3);
            fetchSession(); // Update session totals
        } catch (e: any) { alert(e.message); setStep(1); } finally { setOpLoading(false); }
    };

    // 5bis. Exécuter un Retrait par Code Secret (le montant est porté par le code, pas saisi)
    const executeCodeOperation = async () => {
        if (phone.length < 9) return alert('Numéro de téléphone client invalide.');
        if (codeValue.length !== 6) return alert('Le code doit contenir 6 chiffres.');
        setOpLoading(true);
        try {
            const r = await fetch(`${API_URL}/api/agency/cash-out-code`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ clientPhone: phone, code: codeValue, idempotencyKey: `OP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}` })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);

            setOpResult({ amount: d.transaction?.amount || 0, fee: d.fee || 0, reference: d.transaction?.reference || 'T-' + Date.now(), type: 'CASH_OUT' });
            setStep(3);
            fetchSession(); // Update session totals
        } catch (e: any) { alert(e.message); } finally { setOpLoading(false); }
    };

    // 6. Reset (Etape 3 -> 1)
    const resetOperation = () => {
        setStep(1);
        setOpType('');
        setPhone('');
        setAmount('');
        setClientInfo(null);
        setOpResult(null);
        setIdempotencyKey('');
        setCodeValue('');
    };

    if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><RefreshCw size={24} className="spin" color="var(--text-muted)" /></div>;

    // ────────────────────────────────────────────────────────
    // ECRAN 1: OUVERTURE DE CAISSE
    // ────────────────────────────────────────────────────────
    if (!session) {
        return (
            <div style={{ maxWidth: 480, margin: '80px auto' }}>
                <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--text-secondary)' }}><LogIn size={32} /></div>
                    <h2 style={{ margin: '0 0 8px', fontWeight: 800 }}>Ouverture de Caisse</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>Bonjour <b>{userName}</b>. Veuillez déclarer votre fond de caisse initial pour ouvrir votre session.</p>
                    <form onSubmit={handleOpenShift} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ position: 'relative' }}>
                            <input type="number" required placeholder="0" value={openForm.initialCash} onChange={e => setOpenForm({ initialCash: e.target.value })} style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 24, fontWeight: 700, textAlign: 'center' }} />
                            <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: 'var(--text-muted)' }}>FCFA</span>
                        </div>
                        <button type="submit" style={{ padding: '14px', background: 'black', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: 'pointer', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            Ouvrir la Caisse
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // ────────────────────────────────────────────────────────
    // ECRAN 2: TERMINAL OPÉRATIONNEL
    // ────────────────────────────────────────────────────────
    return (
        <div style={{ paddingBottom: 60 }}>
            {/* HEADER CAISSE */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>Session Caisse Active <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }}></span></h2>
                    <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 14 }}>Caissier : <b>{userName}</b> • Ouvert à {new Date(session.openedAt).toLocaleTimeString('fr-GA', { timeStyle: 'short' })}</p>
                </div>
                <button onClick={() => setShowCloseModal(true)} style={{ padding: '10px 20px', background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LogOut size={16} /> Clôturer la caisse
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1fr) 300px', gap: 24, alignItems: 'start' }}>

                {/* COLONNE GAUCHE: TERMINAL OPERATION */}
                <div className="card" style={{ padding: 32 }}>
                    {step === 1 && (
                        <>
                            <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 800 }}>Nouvelle Opération</h3>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
                                <button onClick={() => setOpType('CASH_IN')} style={{ padding: 20, borderRadius: 12, border: `2px solid ${opType === 'CASH_IN' ? 'var(--success)' : 'var(--border)'}`, background: opType === 'CASH_IN' ? 'var(--success-bg)' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: '0.2s' }}>
                                    <Download size={28} color={opType === 'CASH_IN' ? 'var(--success)' : 'var(--text-muted)'} />
                                    <span style={{ fontWeight: 700, color: opType === 'CASH_IN' ? 'var(--success)' : 'var(--text-secondary)' }}>CASH-IN (Dépôt)</span>
                                </button>
                                <button onClick={() => setOpType('CASH_OUT')} style={{ padding: 20, borderRadius: 12, border: `2px solid ${opType === 'CASH_OUT' ? 'var(--danger)' : 'var(--border)'}`, background: opType === 'CASH_OUT' ? 'var(--danger-bg)' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: '0.2s' }}>
                                    <Upload size={28} color={opType === 'CASH_OUT' ? 'var(--danger)' : 'var(--text-muted)'} />
                                    <span style={{ fontWeight: 700, color: opType === 'CASH_OUT' ? 'var(--danger)' : 'var(--text-secondary)' }}>CASH-OUT (Retrait)</span>
                                </button>
                                <button onClick={() => { setOpType('CASH_OUT_CODE'); setClientInfo(null); }} style={{ padding: 20, borderRadius: 12, border: `2px solid ${opType === 'CASH_OUT_CODE' ? 'var(--accent)' : 'var(--border)'}`, background: opType === 'CASH_OUT_CODE' ? 'var(--accent-bg)' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, transition: '0.2s' }}>
                                    <XCircle size={28} color={opType === 'CASH_OUT_CODE' ? 'var(--accent)' : 'var(--text-muted)'} style={{ transform: 'rotate(45deg)' }} />
                                    <span style={{ fontWeight: 700, color: opType === 'CASH_OUT_CODE' ? 'var(--accent)' : 'var(--text-secondary)', textAlign: 'center' }}>CODE SECRET (Retrait)</span>
                                </button>
                            </div>

                            {opType === 'CASH_OUT_CODE' ? (
                                <>
                                    <div style={{ marginBottom: 20 }}>
                                        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Téléphone du Client</label>
                                        <input placeholder="Numéro de téléphone (+241...)" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 15 }} />
                                    </div>
                                    <div style={{ marginBottom: 30 }}>
                                        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Code Secret (6 chiffres)</label>
                                        <input placeholder="000000" value={codeValue} onChange={e => setCodeValue(e.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} style={{ width: '100%', padding: '16px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: 6, textAlign: 'center' }} />
                                        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Le montant est porté par le code : le client le génère depuis son application avant de se présenter au guichet.</p>
                                    </div>
                                    <button onClick={executeCodeOperation} disabled={opLoading} style={{ width: '100%', padding: '16px', background: 'var(--accent)', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', border: 'none' }}>
                                        {opLoading ? 'Validation...' : 'Valider le Retrait'}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <div style={{ marginBottom: 20 }}>
                                        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Identification Client</label>
                                        <div style={{ display: 'flex', gap: 10 }}>
                                            <input placeholder="Numéro de téléphone (+241...)" value={phone} onChange={e => setPhone(e.target.value)} disabled={!!clientInfo} style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 15 }} />
                                            {!clientInfo ? (
                                                <button onClick={fetchClient} disabled={clientLoading} aria-label="Identifier le client" style={{ padding: '0 20px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
                                                    {clientLoading ? <RefreshCw size={18} className="spin" /> : <Search size={18} />}
                                                </button>
                                            ) : (
                                                <button onClick={() => { setClientInfo(null); setPhone(''); }} style={{ padding: '0 20px', background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)', borderRadius: 10, cursor: 'pointer' }}>
                                                    <XCircle size={18} />
                                                </button>
                                            )}
                                        </div>
                                        {clientInfo && (
                                            <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)' }}>
                                                {clientInfo.selfie ? (
                                                    <img
                                                        src={clientInfo.selfie} alt={`Selfie — ${clientInfo.name}`}
                                                        onClick={() => setLightbox({ src: clientInfo.selfie, alt: `Selfie — ${clientInfo.name}` })}
                                                        style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', cursor: 'zoom-in', border: '1px solid var(--border)' }}
                                                    />
                                                ) : (
                                                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={20} color="var(--text-secondary)" /></div>
                                                )}
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: 700, fontSize: 15 }}>{clientInfo.name}</div>
                                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{clientInfo.phone} • Rôle: {clientInfo.role}</div>
                                                </div>
                                                {(clientInfo.idCardFront || clientInfo.idCardBack) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setLightbox({ src: clientInfo.idCardFront || clientInfo.idCardBack, alt: `Pièce d'identité — ${clientInfo.name}` })}
                                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}
                                                    >
                                                        <ZoomIn size={14} /> Voir la CNI
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ marginBottom: 30 }}>
                                        <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Montant (FCFA)</label>
                                        <input type="number" placeholder="25000" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '16px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }} />
                                    </div>

                                    <button onClick={proceedToConfirm} disabled={clientLoading} style={{ width: '100%', padding: '16px', background: 'black', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: clientLoading ? 'not-allowed' : 'pointer', border: 'none', opacity: clientLoading ? 0.7 : 1 }}>
                                        {clientLoading ? 'Identification du client...' : 'Continuer'}
                                    </button>
                                </>
                            )}
                        </>
                    )}

                    {step === 2 && clientInfo && (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ width: 56, height: 56, borderRadius: '50%', background: opType === 'CASH_IN' ? 'var(--success-bg)' : 'var(--danger-bg)', color: opType === 'CASH_IN' ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                                <AlertTriangle size={28} />
                            </div>
                            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>Confirmer l'opération</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Veuillez vérifier les informations avec le client avant validation.</p>

                            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, textAlign: 'left', marginBottom: 24 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Type</span>
                                    <span style={{ fontWeight: 800 }}>{opType === 'CASH_IN' ? 'DÉPÔT EN CAISSE' : 'RETRAIT GUICHET'}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Client</span>
                                    <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{clientInfo.name}</div><div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{clientInfo.phone}</div></div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Montant Net</span>
                                    <span style={{ fontWeight: 900, fontSize: 20, color: opType === 'CASH_IN' ? 'var(--success)' : 'var(--danger)' }}>{fmt(parseFloat(amount))}</span>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: 12 }}>
                                <button onClick={() => setStep(1)} disabled={opLoading} style={{ flex: 1, padding: '16px', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Retour</button>
                                <button onClick={executeOperation} disabled={opLoading} style={{ flex: 2, padding: '16px', background: opType === 'CASH_IN' ? 'var(--success)' : 'var(--danger)', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                    {opLoading ? 'Traitement...' : opType === 'CASH_IN' ? 'Confirmer Dépôt' : 'Autoriser Retrait'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 3 && opResult && (
                        <div style={{ textAlign: 'center', padding: '20px 0' }}>
                            <CheckCircle size={64} color="var(--success)" style={{ margin: '0 auto 20px' }} />
                            <h3 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800 }}>Opération Réussie</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 24 }}>La transaction a été validée et enregistrée.</p>

                            <div style={{ background: 'var(--bg-secondary)', padding: 20, borderRadius: 12, marginBottom: 30 }}>
                                <div style={{ fontWeight: 800, fontSize: 28, color: 'var(--success)', marginBottom: 4 }}>{fmt(opResult.amount)}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Réf: {opResult.reference}</div>
                                {opResult.fee > 0 && <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '6px', borderRadius: 6, fontWeight: 600 }}>Taxes/Frais: {fmt(opResult.fee)}</div>}
                            </div>

                            <button onClick={resetOperation} style={{ width: '100%', padding: '16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                                Nouvelle Transaction
                            </button>
                        </div>
                    )}
                </div>

                {/* COLONNE DROITE: ETAT DE LA CAISSE */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div className="card" style={{ padding: 20 }}>
                        <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Solde Physique Estimé</h4>
                        <div style={{ fontSize: 32, fontWeight: 900, color: 'var(--text-primary)' }}>
                            {fmt(session.initialCash + session.totalCashInValue - session.totalCashOutValue)}
                        </div>
                    </div>

                    <div className="card" style={{ padding: 20 }}>
                        <h4 style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Synthèse du Shift</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Mise Initiale</span>
                                <span style={{ fontWeight: 600 }}>{fmt(session.initialCash)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'var(--text-muted)' }}>Entrées (Cash-In)</span>
                                <span style={{ fontWeight: 700, color: 'var(--success)' }}>+ {fmt(session.totalCashInValue)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                                <span style={{ color: 'var(--text-muted)' }}>Sorties (Cash-Out)</span>
                                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>- {fmt(session.totalCashOutValue)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
                                <span style={{ fontWeight: 700 }}>Total Attendu</span>
                                <span style={{ fontWeight: 800 }}>{fmt(session.initialCash + session.totalCashInValue - session.totalCashOutValue)}</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            {/* MODAL CLOTURE CAISSE */}
            {showCloseModal && (
                <div style={{ position: 'fixed', inset: 0, background: '#0008', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div className="card" style={{ padding: 32, width: '100%', maxWidth: 440 }}>
                        <h3 style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 20 }}>Clôturer la session</h3>
                        <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>Comptez les espèces physiquement présentes dans votre tiroir-caisse et saisissez le montant total ci-dessous. Le système calculera l'écart éventuel.</p>
                        <form onSubmit={handleCloseShift} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>Espèces comptées (FCFA)</label>
                                <input type="number" required placeholder="Ex: 500000" value={closeForm.countedCash} onChange={e => setCloseForm({ countedCash: e.target.value })} style={{ width: '100%', padding: '14px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 20, fontWeight: 700 }} />
                            </div>
                            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                                <button type="button" onClick={() => setShowCloseModal(false)} style={{ flex: 1, padding: '14px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
                                <button type="submit" disabled={loading} style={{ flex: 1, padding: '14px', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700 }}>
                                    {loading ? 'Clôture...' : 'Valider Clôture'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
        </div>
    );
}

