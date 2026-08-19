import { Archive, DoorClosed, LockKeyhole, Store, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function BranchDashboard({ token }: { token: string }) {
    const [branch, setBranch] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [sessionActionLoading, setSessionActionLoading] = useState(false);
    const [initialCash, setInitialCash] = useState('');
    const [finalCash, setFinalCash] = useState('');
    const [closeReason, setCloseReason] = useState('');

    const fetchBranchInfo = async () => {
        try {
            const resp = await fetch(API_URL + '/api/agency/info', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) setBranch(data);
            else throw new Error(data.error);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBranchInfo();
    }, [token]);

    const handleOpenSession = async (e: React.FormEvent) => {
        e.preventDefault();
        setSessionActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/agency/sessions/open`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ initialCash: parseFloat(initialCash) || 0 })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            setInitialCash('');
            fetchBranchInfo();
            alert('Session ouverte avec succès. Le guichet est prêt à opérer.');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSessionActionLoading(false);
        }
    };

    const handleCloseSession = async (e: React.FormEvent) => {
        e.preventDefault();
        setSessionActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/agency/sessions/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ finalCash: parseFloat(finalCash) || 0, reason: closeReason })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);
            setFinalCash('');
            setCloseReason('');
            fetchBranchInfo();
            const discrep = data.session.discrepancy;
            alert(`Session clôturée. Écart calculé : ${discrep} FCFA.`);
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSessionActionLoading(false);
        }
    };

    if (loading) return <div>Chargement sécurisé de l'agence...</div>;
    if (error) return <div style={{ color: 'red' }}>Erreur critique : {error}</div>;

    const myActiveSession = branch?.sessions?.find((s: any) => s.status === 'OPEN');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: 1200, margin: '0 auto', paddingBottom: 50 }}>
            <div>
                <h2 style={{ fontSize: '28px', marginBottom: '8px' }}>Tableau de Bord Agence ({branch.name})</h2>
                <p style={{ color: 'var(--text-secondary)' }}>Espace isolé et sécurisé. Liquidité physique en agence : {branch.balance.toLocaleString('fr-FR')} FCFA.</p>
            </div>

            <div className="stats-grid">
                <div className="stat-card" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.05))', borderLeft: '4px solid var(--success)' }}>
                    <div className="stat-icon" style={{ background: 'var(--success)', color: 'white' }}>
                        <Archive size={24} />
                    </div>
                    <div className="stat-value">{branch.balance.toLocaleString('fr-FR')} FCFA</div>
                    <div className="stat-label">Coffre Physique (Espèces)</div>
                </div>
                <div className="stat-card" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(99,102,241,0.05))', borderLeft: '4px solid var(--accent)' }}>
                    <div className="stat-icon revenue">
                        <Store size={24} />
                    </div>
                    <div className="stat-value">{branch.wallet?.balance?.toLocaleString('fr-FR') || 0} FCFA</div>
                    <div className="stat-label">E-Liquidité (Réserves Trésorerie)</div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon users">
                        <Users size={24} />
                    </div>
                    <div className="stat-value">{branch.staff?.length || 0}</div>
                    <div className="stat-label">Agents et Caissiers affectés</div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Module de Session Caisse Actuelle */}
                <div className="card" style={{ padding: 30 }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: 18, borderBottom: '1px solid var(--border)', paddingBottom: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <LockKeyhole size={20} /> Votre Session de Caisse
                    </h3>

                    {!myActiveSession ? (
                        <form onSubmit={handleOpenSession} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                            <div style={{ padding: '15px', background: 'rgba(245,158,11,0.1)', color: 'var(--warning)', borderRadius: 8, fontSize: 14 }}>
                                Le guichet est fermé. Ouvrez une session pour autoriser des Cash-In et Cash-Out.
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 600 }}>Caisse initiale (Espèces du matin)</label>
                                <input type="number" required value={initialCash} onChange={e => setInitialCash(e.target.value)} placeholder="0 FCFA" style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }} />
                            </div>
                            <button type="submit" disabled={sessionActionLoading} style={{ width: '100%', padding: 15, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                                Ouvrir le Guichet
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleCloseSession} style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                            <div style={{ padding: '15px', background: 'rgba(16,185,129,0.1)', color: 'var(--success)', borderRadius: 8, fontSize: 14 }}>
                                Guichet <strong>OUVERT</strong> depuis le {new Date(myActiveSession.openedAt).toLocaleString('fr-FR')}.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: 'var(--bg-secondary)', padding: 15, borderRadius: 8 }}>
                                <div><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cash-In Total:</span> <strong style={{ display: 'block' }}>+{myActiveSession.totalCashInValue.toLocaleString('fr-FR')} F</strong></div>
                                <div><span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cash-Out Total:</span> <strong style={{ display: 'block' }}>-{myActiveSession.totalCashOutValue.toLocaleString('fr-FR')} F</strong></div>
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 600 }}>Espèces comptées en fin de journée</label>
                                <input type="number" required value={finalCash} onChange={e => setFinalCash(e.target.value)} placeholder="Bordereau physique (FCFA)" style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 600 }}>Justification (si écart prévu)</label>
                                <input type="text" value={closeReason} onChange={e => setCloseReason(e.target.value)} placeholder="Erreur de rendu monnaie, Fraude détectée..." style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }} />
                            </div>
                            <button type="submit" disabled={sessionActionLoading} style={{ width: '100%', padding: 15, background: 'var(--danger)', color: 'white', border: 'none', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
                                Clôturer et Rapprocher
                            </button>
                        </form>
                    )}
                </div>

                {/* Historique Sessions */}
                <div className="card" style={{ padding: 30, display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: 18, borderBottom: '1px solid var(--border)', paddingBottom: 15, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <DoorClosed size={20} /> Historique des Sessions
                    </h3>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {branch.sessions?.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>Aucune session passée.</p> : branch.sessions?.map((s: any) => (
                            <div key={s.id} style={{ padding: 15, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{new Date(s.openedAt).toLocaleDateString('fr-FR')} • {s.teller?.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Status: {s.status === 'CLOSED' ? `Clos le ${new Date(s.closedAt).toLocaleTimeString('fr-FR')}` : 'En cours'}</div>
                                </div>
                                {s.status === 'CLOSED' && (
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: s.discrepancy === 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 800, fontSize: 14 }}>
                                            Écart: {s.discrepancy > 0 ? '+' : ''}{s.discrepancy} F
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ============================== NOUVEAU ============================== */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {/* Module DEMANDE DE FINANCEMENT (FUNDING REQUEST) */}
                <div className="card" style={{ padding: 30 }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: 18, borderBottom: '1px solid var(--border)', paddingBottom: 15 }}>
                        Demande de Financement
                    </h3>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 15 }}>
                        Demandez au siège d'allouer de la liquidité électronique à l'agence.
                    </p>
                    <FundingForm token={token} onRefresh={fetchBranchInfo} />
                </div>

                {/* HISTORIQUE ALLOCATIONS DU SIÈGE */}
                <div className="card" style={{ padding: 30 }}>
                    <h3 style={{ margin: '0 0 20px 0', fontSize: 18, borderBottom: '1px solid var(--border)', paddingBottom: 15 }}>
                        Dernières Allocations (Siège ➔ Agence)
                    </h3>
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                        {branch.targetTreasuryRequests?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucune demande d'allocation.</p> : branch.targetTreasuryRequests?.map((a: any) => (
                            <div key={a.id} style={{ padding: '10px 0', borderBottom: '1px outset var(--border)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                    <span style={{ fontWeight: 600 }}>{a.reference}</span>
                                    <span style={{ color: a.status === 'APPROVED' ? 'var(--success)' : a.status === 'PENDING' ? 'var(--warning)' : 'var(--danger)', fontWeight: 'bold' }}>
                                        {a.status === 'APPROVED' ? 'Approuvée' : a.status === 'PENDING' ? 'En attente' : a.status === 'REJECTED' ? 'Rejetée' : a.status}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                                    <span>{a.amount.toLocaleString()} FCFA</span>
                                    <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* RAPPORT DE RECONCILIATION */}
            <ReconciliationReport token={token} />

        </div>
    );
}

// ─────────────────────────────────────────────────────────────────
// COMPOSANT ADDITIONNEL : FUNDING FORM
// ─────────────────────────────────────────────────────────────────
function FundingForm({ token, onRefresh }: { token: string, onRefresh: () => void }) {
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const r = await fetch(API_URL + '/api/agency/treasury-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ amount: parseFloat(amount), reason })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            alert('Demande envoyée avec succès au Siège Central.');
            setAmount('');
            setReason('');
            onRefresh();
        } catch (e: any) { alert(e.message); } finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}>Montant demandé (FCFA)</label>
                <input type="number" required value={amount} onChange={e => setAmount(e.target.value)}
                    style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }} />
            </div>
            <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 'bold' }}>Motif (Justification pour le HQ)</label>
                <input type="text" required value={reason} onChange={e => setReason(e.target.value)}
                    placeholder="Ex: Demande importante de retraits prévus ce jour..."
                    style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }} />
            </div>
            <button type="submit" disabled={loading} style={{ padding: 12, background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer', marginTop: 10 }}>
                {loading ? 'Soumission...' : 'Envoyer au Trésorier HQ'}
            </button>
        </form>
    );
}

// ─────────────────────────────────────────────────────────────────
// COMPOSANT ADDITIONNEL : RECONCILIATION REPORT (Ecarts Caisse)
// ─────────────────────────────────────────────────────────────────
function ReconciliationReport({ token }: { token: string }) {
    const [report, setReport] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchReport = async () => {
        setLoading(true);
        try {
            const r = await fetch(API_URL + '/api/agency/reconciliation', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const d = await r.json();
            if (r.ok) setReport(d.discrepancyReport);
            // Réservé au Manager côté serveur (agency.ts) — un TELLER cliquant ici recevait
            // un 403 silencieux, bouton perçu comme cassé.
            else alert(d.error || 'Impossible de générer le rapport.');
        } catch (e: any) { alert('Erreur réseau lors de la génération du rapport.'); console.error('Reconciliation fetch err', e); } finally { setLoading(false); }
    }

    if (!report.length && !loading) {
        return (
            <div className="card" style={{ padding: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Opérations & Réconciliation (Expected vs Declared)</h3>
                <button onClick={fetchReport} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' }}>Générer le rapport consolidé</button>
            </div>
        )
    }

    return (
        <div className="card" style={{ padding: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h3 style={{ margin: 0, fontSize: 18 }}>Rapprochement Comptable des Sessions (Active)</h3>
                <button onClick={fetchReport} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>Rafraîchir</button>
            </div>

            {loading ? <p>Analyse des caisses en cours...</p> : (
                <table style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>Caissier</th>
                            <th>Cash Initial</th>
                            <th>Cash In (Entrant)</th>
                            <th>Cash Out (Sortant)</th>
                            <th>Cash Attendu (Expected)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {report?.map((r, i) => (
                            <tr key={i}>
                                <td style={{ fontWeight: 'bold' }}>{r.tellerName}</td>
                                <td>{r.initialCash.toLocaleString()}</td>
                                <td style={{ color: 'var(--success)' }}>+{r.cashIn.toLocaleString()}</td>
                                <td style={{ color: 'var(--danger)' }}>-{r.cashOut.toLocaleString()}</td>
                                <td style={{ fontWeight: 800 }}>{r.expectedCash.toLocaleString()} FCFA</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}
