import { CheckCircle2, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import PageHeader from './components/PageHeader';
import { ToastHost, useToast } from './components/useToast';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Supervision des séquestres marketplace C2C (backend/src/routes/admin.market.ts) —
// jusqu'ici sans aucun écran : ni pour consulter les séquestres bloqués, ni pour trancher
// un litige (l'acheteur ne confirmant jamais, le vendeur ne livrant jamais). Même schéma
// que Vaults.tsx (force-resolve) : ConfirmDialog avec motif obligatoire, perm_market_manage
// pour l'action, perm_market_view pour la lecture (déjà vérifié côté serveur).
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        LOCKED: { bg: 'var(--warning-bg)', color: 'var(--warning)', label: 'Bloqué' },
        RELEASED: { bg: 'var(--success-bg)', color: 'var(--success)', label: 'Livré au vendeur' },
        REFUNDED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: 'Remboursé' },
        DISPUTED: { bg: 'var(--danger-bg)', color: 'var(--danger)', label: 'Litige' },
    };
    const s = map[status] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: status };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

type ConfirmState = { decision: 'RELEASE_TO_SELLER' | 'REFUND_BUYER'; escrowId: string; amount: number } | null;

export default function Marketplace({ token, hasPerm }: { token: string; hasPerm: (perms: string[]) => boolean }) {
    const [escrows, setEscrows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [onlyLocked, setOnlyLocked] = useState(true);
    const [confirmState, setConfirmState] = useState<ConfirmState>(null);

    const { toasts, push } = useToast();
    const canManage = hasPerm(['perm_market_manage']);

    const fetchList = async () => {
        setLoading(true);
        try {
            const qs = onlyLocked ? '?status=LOCKED' : '';
            const data = await apiFetch(`${API_URL}/api/admin/market/escrow${qs}`, { headers: { Authorization: `Bearer ${token}` } });
            setEscrows(data.escrows || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchList(); }, [onlyLocked]);

    const resolve = async (reason: string) => {
        if (!confirmState) return;
        try {
            await apiFetch(`${API_URL}/api/admin/market/escrow/${confirmState.escrowId}/resolve`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ decision: confirmState.decision, reason }),
            });
            push(confirmState.decision === 'RELEASE_TO_SELLER' ? 'Fonds livrés au vendeur.' : 'Acheteur remboursé.', 'success');
            setConfirmState(null);
            fetchList();
        } catch (e: any) {
            push(e.message, 'error');
        }
    };

    const filtered = escrows.filter(e => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (e.listing?.title || '').toLowerCase().includes(q)
            || (e.buyer?.name || '').toLowerCase().includes(q)
            || (e.buyer?.phone || '').includes(q)
            || (e.seller?.name || '').toLowerCase().includes(q)
            || (e.seller?.phone || '').includes(q);
    });

    const thStyle = { padding: '15px 20px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 13 };
    const tdStyle = { padding: '15px 20px' };

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
            <ToastHost toasts={toasts} />

            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <PageHeader title="Marketplace C2C — Séquestres" subtitle="Débloquez un séquestre bloqué en faveur du vendeur, ou remboursez l'acheteur en cas de litige." />
                <div style={{ position: 'relative', width: 320 }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Annonce, acheteur, vendeur, téléphone..."
                        style={{ width: '100%', padding: '12px 12px 12px 38px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                    onClick={() => setOnlyLocked(true)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: onlyLocked ? 'var(--accent)' : 'var(--bg-card)', color: onlyLocked ? '#fff' : 'var(--text-secondary)' }}
                >
                    Bloqués uniquement
                </button>
                <button
                    onClick={() => setOnlyLocked(false)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: !onlyLocked ? 'var(--accent)' : 'var(--bg-card)', color: !onlyLocked ? '#fff' : 'var(--text-secondary)' }}
                >
                    Tout l'historique
                </button>
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '12px 20px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{error}</span>
                    <button onClick={fetchList} style={{ padding: '6px 14px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Réessayer</button>
                </div>
            )}

            <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: 'var(--bg-primary)' }}>
                        <tr>
                            <th style={thStyle}>Annonce</th>
                            <th style={thStyle}>Acheteur</th>
                            <th style={thStyle}>Vendeur</th>
                            <th style={thStyle}>Montant</th>
                            <th style={thStyle}>Statut</th>
                            <th style={thStyle}>Créé le</th>
                            {canManage && <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Chargement en cours...</td></tr>
                        ) : filtered.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun séquestre trouvé.</td></tr>
                        ) : filtered.map((e, idx) => (
                            <tr key={e.id} style={{ borderTop: idx !== 0 ? '1px solid var(--border)' : 'none' }}>
                                <td style={tdStyle}>{e.listing?.title || '—'}</td>
                                <td style={tdStyle}>
                                    <div style={{ fontWeight: 600 }}>{e.buyer?.name || '—'}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.buyer?.phone}</div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ fontWeight: 600 }}>{e.seller?.name || '—'}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.seller?.phone}</div>
                                </td>
                                <td style={{ ...tdStyle, fontWeight: 700 }}>{fmt(e.amount)}</td>
                                <td style={tdStyle}><StatusPill status={e.status} /></td>
                                <td style={{ ...tdStyle, fontSize: 13, color: 'var(--text-secondary)' }}>{fmtDate(e.createdAt)}</td>
                                {canManage && (
                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                                        {e.status === 'LOCKED' ? (
                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                                <button
                                                    onClick={() => setConfirmState({ decision: 'RELEASE_TO_SELLER', escrowId: e.id, amount: e.amount })}
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'var(--success-bg)', color: 'var(--success)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                                                >
                                                    <CheckCircle2 size={13} /> Livrer au vendeur
                                                </button>
                                                <button
                                                    onClick={() => setConfirmState({ decision: 'REFUND_BUYER', escrowId: e.id, amount: e.amount })}
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                                                >
                                                    <RotateCcw size={13} /> Rembourser l'acheteur
                                                </button>
                                            </div>
                                        ) : (
                                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                                        )}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {confirmState && (
                <ConfirmDialog
                    title={confirmState.decision === 'RELEASE_TO_SELLER' ? 'Livrer les fonds au vendeur' : "Rembourser l'acheteur"}
                    subtitle={`${fmt(confirmState.amount)} — cette action est immédiate et irréversible.`}
                    confirmLabel={confirmState.decision === 'RELEASE_TO_SELLER' ? 'Livrer au vendeur' : 'Rembourser'}
                    danger={confirmState.decision === 'REFUND_BUYER'}
                    requireReason
                    reasonLabel="Motif de la décision"
                    onConfirm={resolve}
                    onClose={() => setConfirmState(null)}
                />
            )}
        </div>
    );
}
