import { ArrowLeft, Pause, Play, RefreshCw, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import PageHeader from './components/PageHeader';
import { ToastHost, useToast } from './components/useToast';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Tontines — jusqu'ici en lecture seule (TontineGroup n'apparaissait dans aucun écran
// admin, et aucune action n'y était possible). Ajoute mettre en pause le groupe ou un
// participant, et relancer les cotisations en échec d'un cycle — chaque action gérée par
// perm_tontine_manage. L'historique de cycles vient du grand livre structuré
// (TontineCycle/TontineContribution) : les groupes créés avant son introduction n'ont pas
// de ligne TontineCycle, d'où le repli sur les « Mouvements » (parsing Transaction.reference).
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', COMPLETED: 'Terminée', CANCELLED: 'Annulée' };
const FREQUENCY_LABELS: Record<string, string> = { WEEKLY: 'Hebdomadaire', MONTHLY: 'Mensuelle' };
const PARTICIPANT_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Actif', PAUSED: 'En pause' };
const TX_STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', COMPLETED: 'Terminée', FAILED: 'Échouée' };
const CYCLE_STATUS_LABELS: Record<string, string> = { COMPLETED: 'Complet', PARTIAL: 'Partiel (échecs)' };

const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status, labels }: { status: string; labels: Record<string, string> }) {
    const colors: Record<string, { bg: string; color: string }> = {
        ACTIVE: { bg: 'var(--success-bg)', color: 'var(--success)' },
        COMPLETED: { bg: 'var(--success-bg)', color: 'var(--success)' },
        CANCELLED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
        PAUSED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' },
        PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
        FAILED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
        PARTIAL: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
        PAID: { bg: 'var(--success-bg)', color: 'var(--success)' },
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

type ConfirmState =
    | { type: 'pause-group' }
    | { type: 'resume-group' }
    | { type: 'pause-participant'; userId: string; name: string }
    | { type: 'resume-participant'; userId: string; name: string }
    | { type: 'retry-cycle'; cycleId: string; cycleNumber: number };

export default function Tontines({ token, hasPerm, initialSelectedId }: { token: string; hasPerm: (perms: string[]) => boolean; initialSelectedId?: string }) {
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'paused'>('all');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

    const { toasts, push } = useToast();
    const canManage = hasPerm(['perm_tontine_manage']);

    useEffect(() => { if (initialSelectedId) setSelectedId(initialSelectedId); }, [initialSelectedId]);

    const fetchList = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/tontines`, { headers: { Authorization: `Bearer ${token}` } });
            setGroups(data.groups || []);
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
            const data = await apiFetch(`${API_URL}/api/admin/tontines/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            setDetail(data.group);
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
        const cycles = detail?.cycles || [];
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <ToastHost toasts={toasts} />
                <button onClick={() => setSelectedId(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux tontines
                </button>

                {detailLoading || !detail ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : (
                    <>
                        <PageHeader
                            title={detail.name}
                            subtitle={`Créateur : ${detail.creator?.name} (${detail.creator?.phone})`}
                            action={canManage ? (
                                detail.isPaused
                                    ? <button onClick={() => setConfirmState({ type: 'resume-group' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--success-bg)', color: 'var(--success)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Play size={14} /> Reprendre la tontine</button>
                                    : <button onClick={() => setConfirmState({ type: 'pause-group' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Pause size={14} /> Mettre en pause</button>
                            ) : undefined}
                        />

                        {detail.isPaused && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, margin: '16px 0' }}>
                                <Pause size={15} /> Tontine en pause{detail.pausedReason ? ` — ${detail.pausedReason}` : ''}. Le CRON ne déclenchera aucun cycle tant que la pause n'est pas levée.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0 28px' }}>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Cotisation</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(detail.contribution)}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Fréquence</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{FREQUENCY_LABELS[detail.frequency] || detail.frequency}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Cycle actuel</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{detail.currentCycle}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Statut</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}><StatusPill status={detail.status} labels={STATUS_LABELS} /></div>
                            </div>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Participants ({detail.participants.length})</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Nom</th><th>Téléphone</th><th>Ordre de versement</th><th>Statut</th><th>Cagnotte reçue</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {detail.participants.map((p: any) => (
                                        <tr key={p.id}>
                                            <td>{p.user.name}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{p.user.phone}</td>
                                            <td>{p.payoutOrder}</td>
                                            <td><StatusPill status={p.status} labels={PARTICIPANT_STATUS_LABELS} /></td>
                                            <td>{p.hasReceivedPayout ? '✅ Oui' : '—'}</td>
                                            {canManage && (
                                                <td>
                                                    {p.status === 'PAUSED' ? (
                                                        <ActionButton onClick={() => setConfirmState({ type: 'resume-participant', userId: p.user.id, name: p.user.name })}>Reprendre</ActionButton>
                                                    ) : (
                                                        <ActionButton danger onClick={() => setConfirmState({ type: 'pause-participant', userId: p.user.id, name: p.user.name })}>Mettre en pause</ActionButton>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Historique des cycles ({cycles.length})</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Cycle</th><th>Exécuté le</th><th>Attendu</th><th>Collecté</th><th>Statut</th><th>Détail des échecs</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {cycles.length === 0 ? (
                                        <tr><td colSpan={canManage ? 7 : 6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun cycle enregistré dans le grand livre structuré (groupe créé avant sa mise en place, ou aucun cycle exécuté) — voir « Mouvements » ci-dessous.</td></tr>
                                    ) : cycles.map((c: any) => {
                                        const failed = (c.contributions || []).filter((ct: any) => ct.status === 'FAILED');
                                        return (
                                            <tr key={c.id}>
                                                <td style={{ fontWeight: 700 }}>#{c.cycleNumber}</td>
                                                <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(c.executedAt)}</td>
                                                <td>{fmt(c.totalExpected)}</td>
                                                <td style={{ fontWeight: 700 }}>{fmt(c.totalCollected)}</td>
                                                <td><StatusPill status={c.status} labels={CYCLE_STATUS_LABELS} /></td>
                                                <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                                    {failed.length === 0 ? '—' : failed.map((ct: any) => ct.participant?.user?.name).filter(Boolean).join(', ')}
                                                </td>
                                                {canManage && (
                                                    <td>
                                                        {c.status === 'PARTIAL' && (
                                                            <ActionButton onClick={() => setConfirmState({ type: 'retry-cycle', cycleId: c.id, cycleNumber: c.cycleNumber })}>
                                                                <RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 3 }} />Réessayer
                                                            </ActionButton>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Mouvements ({transactions.length})</h3>
                        <div className="table-container">
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Frais</th><th>Participant</th><th>Statut</th></tr></thead>
                                <tbody>
                                    {transactions.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun mouvement.</td></tr>
                                    ) : transactions.map((tx: any) => {
                                        const isPayout = tx.reference?.includes('_PAY_');
                                        const participant = isPayout ? tx.receiverWallet?.user : tx.senderWallet?.user;
                                        return (
                                            <tr key={tx.id}>
                                                <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                                <td>{isPayout ? '🎉 Versement de cagnotte' : '💸 Cotisation'}</td>
                                                <td style={{ fontWeight: 700 }}>{fmt(tx.amount)}</td>
                                                <td style={{ color: 'var(--text-secondary)' }}>{tx.fee ? fmt(tx.fee) : '—'}</td>
                                                <td>{participant?.name || '—'}<div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{participant?.phone}</div></td>
                                                <td><StatusPill status={tx.status} labels={TX_STATUS_LABELS} /></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                {confirmState?.type === 'pause-group' && (
                    <ConfirmDialog
                        title="Mettre cette tontine en pause"
                        subtitle="Le CRON ne débitera plus aucune cotisation ni ne versera de cagnotte pour ce groupe tant que la pause n'est pas levée. currentCycle n'est pas modifié : la tontine reprend exactement où elle en était."
                        confirmLabel="Confirmer la pause"
                        danger
                        requireReason
                        reasonLabel="Motif de la pause"
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/tontines/${selectedId}/pause`, { reason }, 'Tontine mise en pause.')}
                    />
                )}
                {confirmState?.type === 'resume-group' && (
                    <ConfirmDialog
                        title="Reprendre cette tontine"
                        subtitle="Le prochain passage du CRON pourra de nouveau exécuter un cycle pour ce groupe."
                        confirmLabel="Reprendre"
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/tontines/${selectedId}/resume`, {}, 'Tontine reprise.')}
                    />
                )}
                {confirmState?.type === 'pause-participant' && (
                    <ConfirmDialog
                        title={`Mettre ${confirmState.name} en pause`}
                        subtitle="Ce participant sera exclu des prochains cycles (aucun débit) jusqu'à sa reprise."
                        confirmLabel="Confirmer la pause"
                        danger
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/tontines/${selectedId}/participants/${confirmState.userId}/pause`, {}, 'Participant mis en pause.')}
                    />
                )}
                {confirmState?.type === 'resume-participant' && (
                    <ConfirmDialog
                        title={`Reprendre ${confirmState.name}`}
                        subtitle="Ce participant sera de nouveau inclus dans les prochains cycles."
                        confirmLabel="Confirmer la reprise"
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/tontines/${selectedId}/participants/${confirmState.userId}/resume`, {}, 'Participant repris.')}
                    />
                )}
                {confirmState?.type === 'retry-cycle' && (
                    <ConfirmDialog
                        title={`Relancer les cotisations en échec du cycle #${confirmState.cycleNumber}`}
                        subtitle="Retente le débit uniquement pour les participants dont la cotisation a échoué sur ce cycle. Si la cagnotte n'a pas encore été versée, les fonds récupérés s'y ajoutent."
                        confirmLabel="Relancer"
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/tontines/${selectedId}/cycles/${confirmState.cycleId}/retry`, {}, 'Relance effectuée.')}
                    />
                )}
            </div>
        );
    }

    const filteredGroups = groups.filter(g => {
        if (statusFilter === 'paused' && !g.isPaused) return false;
        if (!search) return true;
        const s = search.toLowerCase();
        return g.name?.toLowerCase().includes(s) || g.creator?.name?.toLowerCase().includes(s) || g.creator?.phone?.includes(s);
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <ToastHost toasts={toasts} />
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <PageHeader title="Tontines" subtitle={canManage ? "Vue d'ensemble des clubs de tontine — mettre en pause, relancer un cycle en échec." : "Vue d'ensemble des clubs de tontine — lecture seule."} />
                <button onClick={fetchList} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    <RefreshCw size={14} /> Rafraîchir
                </button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    placeholder="🔍 Rechercher une tontine ou un créateur…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%', maxWidth: 360, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}
                />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}>
                    <option value="all">Toutes</option>
                    <option value="paused">En pause uniquement</option>
                </select>
            </div>

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
                            <th>Tontine</th><th>Créateur</th><th>Membres</th><th>Cotisation</th><th>Fréquence</th><th>Cycle</th><th>Statut</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : filteredGroups.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{groups.length === 0 ? "Aucune tontine créée pour l'instant." : 'Aucune tontine ne correspond à la recherche.'}</td></tr>
                        ) : filteredGroups.map(g => (
                            <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(g.id)}>
                                <td style={{ fontWeight: 600 }}>{g.name}{g.isPaused && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>En pause</span>}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{g.creator?.name}</td>
                                <td style={{ color: 'var(--text-secondary)' }}><UsersIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />{g._count.participants}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(g.contribution)}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{FREQUENCY_LABELS[g.frequency] || g.frequency}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{g.currentCycle}</td>
                                <td><StatusPill status={g.status} labels={STATUS_LABELS} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
