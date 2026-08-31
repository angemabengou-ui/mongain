import { ArrowLeft, CalendarClock, Pause, Play, RefreshCw, Search, Users as UsersIcon } from 'lucide-react';
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
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', PENDING_RENEWAL: 'Sondage de relance', COMPLETED: 'Terminée', CANCELLED: 'Annulée' };
const FREQUENCY_LABELS: Record<string, string> = { WEEKLY: 'Hebdomadaire', MONTHLY: 'Mensuelle' };
const PARTICIPANT_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Actif', PAUSED: 'En pause', LEFT: 'Parti' };
const TX_STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', COMPLETED: 'Terminée', FAILED: 'Échouée' };
const CYCLE_STATUS_LABELS: Record<string, string> = { COMPLETED: 'Complet', PARTIAL: 'Partiel (échecs)', PAYOUT_FAILED: 'Versement bloqué' };

const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Miroir de tontine-detail.tsx (mobile) : même calcul de ponctualité depuis l'historique
// déjà chargé (detail.cycles), pour que le personnel dispose de la même visibilité que les
// membres eux-mêmes lorsqu'ils tranchent un litige ("il n'a jamais payé" vs "il paie
// toujours en retard" ne se lit pas pareil sur un seul cycle isolé).
function computeReliability(participantId: string, cycles: any[]) {
    let paid = 0, total = 0;
    cycles.forEach((c: any) => {
        const contrib = (c.contributions || []).find((x: any) => x.participantId === participantId);
        if (contrib) { total++; if (contrib.status === 'PAID') paid++; }
    });
    return { paid, total };
}

function StatusPill({ status, labels }: { status: string; labels: Record<string, string> }) {
    const colors: Record<string, { bg: string; color: string }> = {
        ACTIVE: { bg: 'var(--success-bg)', color: 'var(--success)' },
        COMPLETED: { bg: 'var(--success-bg)', color: 'var(--success)' },
        CANCELLED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
        PAUSED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' },
        PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
        FAILED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
        PARTIAL: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
        PAYOUT_FAILED: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
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
    | { type: 'postpone-group' }
    | { type: 'pause-participant'; userId: string; name: string }
    | { type: 'resume-participant'; userId: string; name: string }
    | { type: 'emergency-payout'; userId: string; name: string }
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
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    {detail.status === 'ACTIVE' && (
                                        <button onClick={() => setConfirmState({ type: 'postpone-group' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent-bg)', color: 'var(--accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><CalendarClock size={14} /> Reporter le prélèvement</button>
                                    )}
                                    {detail.isPaused
                                        ? <button onClick={() => setConfirmState({ type: 'resume-group' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--success-bg)', color: 'var(--success)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Play size={14} /> Reprendre la tontine</button>
                                        : <button onClick={() => setConfirmState({ type: 'pause-group' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Pause size={14} /> Mettre en pause</button>
                                    }
                                </div>
                            ) : undefined}
                        />

                        {detail.isPaused && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, margin: '16px 0' }}>
                                <Pause size={15} /> Tontine en pause{detail.pausedReason ? ` — ${detail.pausedReason}` : ''}. Le CRON ne déclenchera aucun cycle tant que la pause n'est pas levée.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0 28px' }}>
                            <div className="card" style={{ padding: 24, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Cotisation</div>
                                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(detail.contribution)}</div>
                            </div>
                            <div className="card" style={{ padding: 24, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Fréquence</div>
                                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)' }}>{FREQUENCY_LABELS[detail.frequency] || detail.frequency}</div>
                            </div>
                            <div className="card" style={{ padding: 24, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Cycle actuel</div>
                                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)' }}>{detail.currentCycle}</div>
                            </div>
                            <div className="card" style={{ padding: 24, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Statut</div>
                                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)' }}><StatusPill status={detail.status} labels={STATUS_LABELS} /></div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Participants ({detail.participants.length})</h3>
                        </div>
                        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Nom', 'Téléphone', 'Ordre de versement', 'Statut', 'Ponctualité', 'Cagnotte reçue', ...(canManage ? ['Actions'] : [])].map((h, i) => (
                                            <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Actions' ? 'right' : 'left' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.participants.map((p: any) => {
                                        const rel = computeReliability(p.id, cycles);
                                        return (
                                            <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                <td style={{ padding: '16px 20px', fontWeight: 800, color: 'var(--text-primary)' }}>{p.user.name}</td>
                                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}>{p.user.phone}</td>
                                                <td style={{ padding: '16px 20px', fontWeight: 800 }}>#{p.payoutOrder}</td>
                                                <td style={{ padding: '16px 20px' }}><StatusPill status={p.status} labels={PARTICIPANT_STATUS_LABELS} /></td>
                                                <td style={{ padding: '16px 20px', color: rel.total === 0 ? 'var(--text-muted)' : rel.paid === rel.total ? 'var(--success)' : 'var(--warning)', fontWeight: 800, fontSize: 13 }}>
                                                    {rel.total === 0 ? 'Pas encore historique' : `${rel.paid}/${rel.total} cycles`}
                                                </td>
                                                <td style={{ padding: '16px 20px', fontWeight: 700 }}>{p.hasReceivedPayout ? '✅ Oui' : '—'}</td>
                                                {canManage && (
                                                    <td style={{ padding: '16px 20px', textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                        {p.status === 'PAUSED' ? (
                                                            <ActionButton onClick={() => setConfirmState({ type: 'resume-participant', userId: p.userId, name: p.user.name })}>Reprendre</ActionButton>
                                                        ) : (
                                                            <ActionButton danger onClick={() => setConfirmState({ type: 'pause-participant', userId: p.userId, name: p.user.name })}>Mettre en pause</ActionButton>
                                                        )}
                                                        {detail.status === 'ACTIVE' && p.status === 'ACTIVE' && !p.hasReceivedPayout && (
                                                            <ActionButton onClick={() => setConfirmState({ type: 'emergency-payout', userId: p.userId, name: p.user.name })}>Urgence</ActionButton>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Historique des cycles ({cycles.length})</h3>
                        </div>
                        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 32 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Cycle', 'Exécuté le', 'Attendu', 'Collecté', 'Statut', 'Détail des échecs', ...(canManage ? ['Actions'] : [])].map((h, i) => (
                                            <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Actions' ? 'right' : 'left' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {cycles.length === 0 ? (
                                        <tr><td colSpan={canManage ? 7 : 6} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Aucun cycle enregistré dans le grand livre structuré (groupe créé avant sa mise en place, ou aucun cycle exécuté) — voir « Mouvements » ci-dessous.</td></tr>
                                    ) : cycles.map((c: any) => {
                                        const incomplete = (c.contributions || []).filter((ct: any) => ct.status === 'PARTIAL' || ct.status === 'FAILED');
                                        return (
                                            <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                <td style={{ padding: '16px 20px', fontWeight: 900, color: 'var(--text-primary)' }}>#{c.cycleNumber}</td>
                                                <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(c.executedAt)}</td>
                                                <td style={{ padding: '16px 20px', fontWeight: 700 }}>{fmt(c.totalExpected)}</td>
                                                <td style={{ padding: '16px 20px', fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(c.totalCollected)}</td>
                                                <td style={{ padding: '16px 20px' }}><StatusPill status={c.status} labels={CYCLE_STATUS_LABELS} /></td>
                                                <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                    {c.status === 'PAYOUT_FAILED'
                                                        ? 'Cotisations OK — le versement de la cagnotte a échoué'
                                                        : incomplete.length === 0 ? '—' : incomplete.map((ct: any) => {
                                                            const name = ct.participant?.user?.name;
                                                            const owed = ct.status === 'FAILED' ? detail.contribution : Math.max(0, detail.contribution - ct.amount);
                                                            return name ? `${name} (doit ${fmt(owed)})` : null;
                                                        }).filter(Boolean).join(', ')}
                                                </td>
                                                {canManage && (
                                                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                                        {(c.status === 'PARTIAL' || c.status === 'PAYOUT_FAILED') && (
                                                            <ActionButton onClick={() => setConfirmState({ type: 'retry-cycle', cycleId: c.id, cycleNumber: c.cycleNumber })}>
                                                                <RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 4 }} />Réessayer
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

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Mouvements ({transactions.length})</h3>
                        </div>
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Date', 'Type', 'Montant', 'Frais', 'Participant', 'Statut'].map((h, i) => (
                                            <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.length === 0 ? (
                                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Aucun mouvement enregistré.</td></tr>
                                    ) : transactions.map((tx: any) => {
                                        const isPayout = tx.reference?.includes('_PAY_');
                                        const participant = isPayout ? tx.receiverWallet?.user : tx.senderWallet?.user;
                                        return (
                                            <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                                <td style={{ padding: '16px 20px', fontWeight: 700 }}>{isPayout ? '🎉 Versement de cagnotte' : '💸 Cotisation'}</td>
                                                <td style={{ padding: '16px 20px', fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(tx.amount)}</td>
                                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}>{tx.fee ? fmt(tx.fee) : '—'}</td>
                                                <td style={{ padding: '16px 20px' }}>
                                                    <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 13 }}>{participant?.name || '—'}</div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{participant?.phone}</div>
                                                </td>
                                                <td style={{ padding: '16px 20px' }}><StatusPill status={tx.status} labels={TX_STATUS_LABELS} /></td>
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
                {confirmState?.type === 'postpone-group' && (
                    <ConfirmDialog
                        title="Reporter le prélèvement automatique"
                        subtitle="Décale la date du prochain prélèvement du nombre de jours indiqué (à partir de la date de référence actuelle) — utile quand un ou plusieurs membres ont besoin de plus de temps pour compléter leur cotisation. currentCycle n'est pas modifié, seule l'échéance recule."
                        confirmLabel="Reporter"
                        requireReason
                        reasonLabel="Motif du report"
                        numberField={{ label: 'Nombre de jours de report', defaultValue: 3, min: 1, max: 90 }}
                        onClose={() => setConfirmState(null)}
                        onConfirm={(reason, days) => runAction(`/tontines/${selectedId}/postpone`, { days, reason }, 'Prélèvement reporté.')}
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
                {confirmState?.type === 'emergency-payout' && (
                    <ConfirmDialog
                        title={`Paiement d'urgence hors tour pour ${confirmState.name}`}
                        subtitle="Déclenche immédiatement le cycle en cours (collecte des cotisations de tous les membres actifs, puis versement) en désignant cette personne comme bénéficiaire à la place de celle normalement prévue — qui recevra sa cagnotte à un tour ultérieur à la place. À réserver aux situations où le membre concerné a explicitement demandé à l'administration de recevoir sa cagnotte avant son tour normal."
                        confirmLabel="Déclencher le paiement"
                        danger
                        requireReason
                        reasonLabel="Motif de l'urgence"
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/tontines/${selectedId}/participants/${confirmState.userId}/emergency-payout`, { reason }, 'Paiement d\'urgence déclenché.')}
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
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60, position: 'relative' }}>
            <ToastHost toasts={toasts} />

            <div style={{ marginBottom: 32 }}>
                <PageHeader
                    title="Tontines"
                    subtitle={canManage ? "Vue d'ensemble des clubs de tontine — gérer, mettre en pause, relancer." : "Vue d'ensemble des clubs de tontine — lecture seule."}
                    action={
                        <button onClick={fetchList} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: '0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                            <RefreshCw size={16} /> Rafraîchir
                        </button>
                    }
                />
            </div>

            {/* ── FILTRES ── */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
                    <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        placeholder="Rechercher une tontine ou créateur…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px 12px 42px', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
                    />
                </div>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} style={{ flex: '0 0 200px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', cursor: 'pointer' }}>
                    <option value="all">Toutes les tontines</option>
                    <option value="paused">En pause uniquement</option>
                </select>
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '16px 20px', borderRadius: 12, marginBottom: 24, fontWeight: 600 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button onClick={fetchList} style={{ padding: '8px 14px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Réessayer</button>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 8px' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>Groupes ({filteredGroups.length})</span>
            </div>

            {/* ── TABLEAU ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['Tontine', 'Créateur', 'Membres', 'Cotisation', 'Fréquence', 'Cycle', 'Statut'].map((h, i) => (
                                <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Chargement...</td></tr>
                        ) : filteredGroups.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>{groups.length === 0 ? "Aucune tontine créée pour l'instant." : 'Aucune tontine ne correspond à la recherche.'}</td></tr>
                        ) : filteredGroups.map(g => (
                            <tr key={g.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onClick={() => setSelectedId(g.id)} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td style={{ padding: '16px 20px', fontWeight: 800, color: 'var(--text-primary)', fontSize: 14 }}>
                                    {g.name}
                                    {g.isPaused && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>En pause</span>}
                                </td>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}>{g.creator?.name}</td>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}><UsersIcon size={14} style={{ marginRight: 6, verticalAlign: -2 }} />{g._count.participants}</td>
                                <td style={{ padding: '16px 20px', fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>{fmt(g.contribution)}</td>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 600 }}>{FREQUENCY_LABELS[g.frequency] || g.frequency}</td>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 800 }}>#{g.currentCycle}{g.totalCycles ? ` / ${g.totalCycles}` : ''}</td>
                                <td style={{ padding: '16px 20px' }}><StatusPill status={g.status} labels={STATUS_LABELS} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
