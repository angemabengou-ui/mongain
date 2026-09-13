import { Banknote, Clock, Landmark, RefreshCw, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ENDPOINTS, isPortalViewer } from './api';
import { fmtFCFA, parseAmountInput } from './utils/format';

type PayoutRequest = {
    id: string;
    sourceAccount: string;
    amount: number;
    note?: string | null;
    status: string; // PENDING, EXECUTED, REJECTED
    rejectionReason?: string | null;
    createdAt: string;
    executedAt?: string | null;
};

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'EXECUTED':
            return <span className="status-pill success">Exécuté</span>;
        case 'REJECTED':
            return <span className="status-pill danger">Rejeté</span>;
        default:
            return <span className="status-pill warning">En attente</span>;
    }
}

// Retrait vers agence — vérifié directement dans backend/src/routes/merchant-portal.ts :
// POST/GET /api/merchant-portal/withdraw-to-agency réutilisent createMerchantPayoutRequest()
// (factorée hors de routes/b2b.ts). Ce n'est PAS un code de retrait instantané comme sur
// mobile (wallet.ts /generate-withdraw-code) : ça crée une MerchantPayoutRequest au statut
// PENDING, exécutée manuellement plus tard par un membre du staff Mongain. Pas de PIN — le
// serveur ne débite rien à la création, seulement à l'exécution manuelle côté staff.
export default function AgencyWithdrawal({ onSessionExpired }: { onSessionExpired: () => void }) {
    // Le serveur (requirePortalAdmin, voir routes/merchant-portal.ts POST /withdraw-to-agency)
    // renvoie 403 à un membre VIEWER — masqué ici plutôt que désactivé, même principe que
    // EmployeePayouts.tsx/Team.tsx/Affiliations.tsx : un VIEWER ne doit jamais voir un bouton
    // qui échouera de toute façon.
    const viewer = isPortalViewer();
    const [sourceAccount, setSourceAccount] = useState<'SALES' | 'COMMISSION'>('SALES');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [requests, setRequests] = useState<PayoutRequest[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [historyError, setHistoryError] = useState('');

    // Le serveur ne déduplique pas encore explicitement sur une clé d'idempotence pour cette
    // route précise (createMerchantPayoutRequest ne lit que sourceAccount/amount/note) — la
    // protection réelle contre le double-clic ici est donc le bouton désactivé pendant l'envoi.
    // On génère quand même une clé, envoyée en plus du corps attendu : elle ne coûte rien, reste
    // cohérente avec le reste du portail, et sera immédiatement utile si une déduplication
    // serveur est ajoutée plus tard sur cette route.
    const idempotencyKey = useRef<string>(crypto.randomUUID());

    const handleAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const loadHistory = async () => {
        setLoadingHistory(true);
        setHistoryError('');
        try {
            const res = await apiRequest(ENDPOINTS.agencyWithdrawal);
            const list = Array.isArray(res) ? res : (res.data || res.payouts || []);
            setRequests(Array.isArray(list) ? list : []);
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setHistoryError(err.message);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => { loadHistory(); }, []);

    const parsedAmount = parseAmountInput(amount);
    const isValid = (parsedAmount || 0) > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !isValid) return;
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            await apiRequest(ENDPOINTS.agencyWithdrawal, {
                method: 'POST',
                body: JSON.stringify({
                    sourceAccount,
                    amount: parsedAmount, // FCFA entier, jamais de décimales
                    note: note.trim() || undefined,
                    idempotencyKey: idempotencyKey.current,
                }),
            });

            setSuccess("Demande de retrait enregistrée. Elle sera traitée par un membre de l'équipe Mongain — vous serez notifié une fois les espèces disponibles en agence.");
            setAmount('');
            setNote('');
            idempotencyKey.current = crypto.randomUUID();
            loadHistory();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><Landmark size={22} /></div>
                    Retrait vers Agence
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                    Demandez un retrait d'espèces. Votre demande est traitée manuellement par notre équipe, elle n'est pas instantanée.
                </p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {success && <div className="banner success mb-8">{success}</div>}
            {viewer && (
                <div className="banner info mb-8">
                    Vous êtes connecté en lecture seule. Seul le géant principal ou un membre Admin peut soumettre une demande de retrait.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: viewer ? '1fr' : '1fr 1fr', gap: 32, alignItems: 'start' }}>
                {!viewer && (
                    <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Nouvelle demande</h2>

                        <div>
                            <label>Compte source</label>
                            <select value={sourceAccount} onChange={e => setSourceAccount(e.target.value as 'SALES' | 'COMMISSION')}>
                                <option value="SALES">Solde principal (ventes)</option>
                                <option value="COMMISSION">Solde commissions</option>
                            </select>
                        </div>

                        <div>
                            <label>Montant à retirer (FCFA)</label>
                            <input type="number" min={1} step={1} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Ex: 500000" />
                            {parsedAmount !== null && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{fmtFCFA(parsedAmount)}</p>}
                        </div>

                        <div>
                            <label>Note (optionnel)</label>
                            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Motif du retrait" />
                        </div>

                        <button
                            type="submit"
                            disabled={submitting || !isValid}
                            className="btn-primary"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                            <Banknote size={18} /> {submitting ? 'Envoi...' : 'Soumettre la demande'}
                        </button>
                    </form>
                )}

                <div className="card" style={{ padding: 28 }}>
                    <div className="flex-between" style={{ marginBottom: 20 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Historique des demandes</h2>
                        <button onClick={loadHistory} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12 }}>
                            <RefreshCw size={14} className={loadingHistory ? 'spin' : ''} /> Actualiser
                        </button>
                    </div>
                    {historyError && <div className="banner error mb-8" style={{ fontSize: 13 }}>{historyError}</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto' }}>
                        {requests.map(req => (
                            <div key={req.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-secondary)' }}>
                                <div className="flex-between">
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: 15 }}>{fmtFCFA(req.amount)}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                            {req.sourceAccount === 'COMMISSION' ? 'Solde commissions' : 'Solde principal'}
                                        </div>
                                    </div>
                                    <StatusBadge status={req.status} />
                                </div>
                                {req.note && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>{req.note}</div>}
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Clock size={12} /> {new Date(req.createdAt).toLocaleString('fr-FR')}
                                </div>
                                {req.status === 'REJECTED' && req.rejectionReason && (
                                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <XCircle size={12} /> {req.rejectionReason}
                                    </div>
                                )}
                                {req.status === 'EXECUTED' && req.executedAt && (
                                    <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 8 }}>
                                        Exécuté le {new Date(req.executedAt).toLocaleString('fr-FR')}
                                    </div>
                                )}
                            </div>
                        ))}
                        {!loadingHistory && requests.length === 0 && !historyError && (
                            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Aucune demande de retrait pour le moment.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
