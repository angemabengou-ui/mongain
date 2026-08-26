import { ArrowLeft, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import PageHeader from './components/PageHeader';
import { ToastHost, useToast } from './components/useToast';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Marchands — jusqu'ici aucune vue de supervision n'existait (le solde ventes et le
// solde commission n'étaient visibles qu'au marchand lui-même via l'app mobile, et
// aucune demande de retrait ne pouvait être traitée puisque ce flux n'existait pas).
// Même structure que Vaults.tsx/Tontines.tsx : liste+détail, pas de TabBar séparée.
const PAYOUT_STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', EXECUTED: 'Exécuté', REJECTED: 'Rejeté' };
const SOURCE_LABELS: Record<string, string> = { SALES: 'Ventes', COMMISSION: 'Commission' };

const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status, labels }: { status: string; labels: Record<string, string> }) {
    const colors: Record<string, { bg: string; color: string }> = {
        PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
        EXECUTED: { bg: 'var(--success-bg)', color: 'var(--success)' },
        REJECTED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    };
    const c = colors[status] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{labels[status] || status}</span>;
}

function ActionButton({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            style={{ padding: '5px 10px', background: danger ? 'var(--danger-bg)' : 'var(--accent-bg)', color: danger ? 'var(--danger)' : 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}
        >
            {children}
        </button>
    );
}

type ConfirmState = { type: 'approve' | 'reject'; payoutId: string; amount: number; sourceAccount: string };

export default function Merchants({ token, hasPerm, initialSelectedId }: { token: string; hasPerm: (perms: string[]) => boolean; initialSelectedId?: string }) {
    const [merchants, setMerchants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

    const { toasts, push } = useToast();
    const canManage = hasPerm(['perm_merchant_manage']);

    useEffect(() => { if (initialSelectedId) setSelectedId(initialSelectedId); }, [initialSelectedId]);

    const fetchList = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/merchants`, { headers: { Authorization: `Bearer ${token}` } });
            setMerchants(data.merchants || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchDetail = async (id: string) => {
        setDetailLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/merchants/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            setDetail(data.merchant);
            setTransactions(data.transactions || []);
        } catch (e: any) {
            setError(e.message);
            setSelectedId(null);
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => { fetchList(); }, []);
    useEffect(() => { if (selectedId) fetchDetail(selectedId); else { setDetail(null); setTransactions([]); } }, [selectedId]);

    const runAction = async (path: string, body: any, successMessage: string) => {
        try {
            await apiFetch(`${API_URL}/api/admin${path}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            });
            push(successMessage, 'success');
            setConfirmState(null);
            if (selectedId) fetchDetail(selectedId);
            fetchList();
        } catch (e: any) {
            push(e.message, 'error');
        }
    };

    if (selectedId) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <ToastHost toasts={toasts} />
                <button onClick={() => setSelectedId(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux marchands
                </button>

                {detailLoading || !detail ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : (
                    <>
                        <PageHeader title={detail.name} subtitle={detail.phone} />

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0 28px' }}>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 240px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Solde Ventes / Paiements</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(detail.wallet?.balance || 0)}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 240px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Solde Commission</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(detail.commissionWallet?.balance || 0)}</div>
                            </div>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Transactions ({transactions.length})</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Date</th><th>Montant</th><th>Contrepartie</th><th>Référence</th><th>Statut</th></tr></thead>
                                <tbody>
                                    {transactions.length === 0 ? (
                                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune transaction.</td></tr>
                                    ) : transactions.map((tx: any) => {
                                        const isCredit = tx.receiverWallet?.user && (tx.receiverWallet.user.phone === detail.phone);
                                        const counterparty = isCredit ? tx.senderWallet?.user : tx.receiverWallet?.user;
                                        return (
                                            <tr key={tx.id}>
                                                <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                                <td style={{ fontWeight: 700, color: isCredit ? 'var(--success)' : 'var(--text-primary)' }}>{isCredit ? '+' : '-'}{fmt(tx.amount)}</td>
                                                <td>{counterparty?.name || '—'}</td>
                                                <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{tx.reference || '—'}</td>
                                                <td><StatusPill status={tx.status} labels={{ COMPLETED: 'Terminée', PENDING: 'En attente', FAILED: 'Échouée' }} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Demandes de retrait ({detail.merchantPayoutRequests?.length || 0})</h3>
                        <div className="table-container">
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Date</th><th>Compte source</th><th>Montant</th><th>Note</th><th>Statut</th><th>Traité par</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {(detail.merchantPayoutRequests || []).length === 0 ? (
                                        <tr><td colSpan={canManage ? 7 : 6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune demande de retrait.</td></tr>
                                    ) : detail.merchantPayoutRequests.map((p: any) => (
                                        <tr key={p.id}>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(p.createdAt)}</td>
                                            <td>{SOURCE_LABELS[p.sourceAccount] || p.sourceAccount}</td>
                                            <td style={{ fontWeight: 700 }}>{fmt(p.amount)}</td>
                                            <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={p.note || ''}>{p.note || '—'}</td>
                                            <td><StatusPill status={p.status} labels={PAYOUT_STATUS_LABELS} /></td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{p.processedBy?.name || '—'}</td>
                                            {canManage && (
                                                <td>
                                                    {p.status === 'PENDING' && (
                                                        <div style={{ display: 'flex', gap: 6 }}>
                                                            <ActionButton onClick={() => setConfirmState({ type: 'approve', payoutId: p.id, amount: p.amount, sourceAccount: p.sourceAccount })}>Approuver</ActionButton>
                                                            <ActionButton danger onClick={() => setConfirmState({ type: 'reject', payoutId: p.id, amount: p.amount, sourceAccount: p.sourceAccount })}>Rejeter</ActionButton>
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {confirmState?.type === 'approve' && (
                    <ConfirmDialog
                        title="Approuver ce retrait marchand"
                        subtitle={`${fmt(confirmState.amount)} depuis le compte ${SOURCE_LABELS[confirmState.sourceAccount] || confirmState.sourceAccount}. ${confirmState.sourceAccount === 'COMMISSION' ? 'La commission sera consolidée dans le solde ventes/paiements du marchand.' : 'Cette exécution suppose que le versement externe (agence/banque) a bien eu lieu.'}`}
                        confirmLabel="Confirmer l'approbation"
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/merchants/${selectedId}/payouts/${confirmState.payoutId}/approve`, {}, 'Retrait approuvé et exécuté.')}
                    />
                )}
                {confirmState?.type === 'reject' && (
                    <ConfirmDialog
                        title="Rejeter ce retrait marchand"
                        subtitle={`${fmt(confirmState.amount)} — aucun mouvement de fonds n'aura lieu.`}
                        confirmLabel="Confirmer le rejet"
                        danger
                        requireReason
                        reasonLabel="Motif du rejet"
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/merchants/${selectedId}/payouts/${confirmState.payoutId}/reject`, { reason }, 'Retrait rejeté.')}
                    />
                )}
            </div>
        );
    }

    const filteredMerchants = merchants.filter(m => {
        if (!search) return true;
        const s = search.toLowerCase();
        return m.name?.toLowerCase().includes(s) || m.phone?.includes(s);
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <ToastHost toasts={toasts} />
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Marchands" subtitle={canManage ? "Comptes marchands — soldes ventes/commission séparés, traitement des demandes de retrait." : "Comptes marchands — lecture seule."} />
            </div>

            <input
                placeholder="🔍 Rechercher un marchand…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 360, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}
            />

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button onClick={fetchList} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Réessayer</button>
                </div>
            )}

            <div className="table-container">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                    <thead>
                        <tr>
                            <th>Marchand</th><th>Téléphone</th><th>Solde Ventes</th><th>Solde Commission</th><th>Retraits en attente</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : filteredMerchants.length === 0 ? (
                            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{merchants.length === 0 ? "Aucun compte marchand pour l'instant." : 'Aucun marchand ne correspond à la recherche.'}</td></tr>
                        ) : filteredMerchants.map(m => (
                            <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(m.id)}>
                                <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                                    <Store size={14} color="var(--accent)" /> {m.name}
                                </td>
                                <td style={{ color: 'var(--text-secondary)' }}>{m.phone}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(m.wallet?.balance || 0)}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(m.commissionWallet?.balance || 0)}</td>
                                <td>
                                    {m._count?.merchantPayoutRequests > 0 ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                                            {m._count.merchantPayoutRequests} en attente
                                        </span>
                                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
