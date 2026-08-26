import { ArrowLeft, Ban, Lock, Shield, Unlock, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import PageHeader from './components/PageHeader';
import { ToastHost, useToast } from './components/useToast';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Caisses Communes — jusqu'ici en lecture seule (le modèle Vault n'apparaissait dans
// aucun écran admin, et aucune action n'y était possible). Ajoute geler/dégeler, forcer
// la résolution d'un retrait bloqué ou contesté, réassigner un rôle, et annuler un bon —
// chaque action gérée par perm_vault_manage (perm_vault_view suffit pour la lecture, déjà
// vérifié côté serveur avant que ce composant ne soit monté, voir App.tsx).
const ROLE_LABELS: Record<string, string> = { isAdmin: 'Président', isInitiator: 'Secrétaire', isValidator: 'Commissaire', isTreasurer: 'Trésorier', isRequiredValidator: 'Validation obligatoire' };
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning)', label: 'En attente' },
        COMPLETED: { bg: 'var(--success-bg)', color: 'var(--success)', label: 'Exécuté' },
        REJECTED: { bg: 'var(--danger-bg)', color: 'var(--danger)', label: 'Rejeté' },
        ACTIVE: { bg: 'var(--success-bg)', color: 'var(--success)', label: 'Actif' },
        USED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: 'Utilisé' },
        VOID: { bg: 'var(--bg-secondary)', color: 'var(--text-muted)', label: 'Annulé' },
        LEFT: { bg: 'var(--bg-secondary)', color: 'var(--text-muted)', label: 'A quitté' },
    };
    const s = map[status] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: status };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>;
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
    | { type: 'freeze' }
    | { type: 'unfreeze' }
    | { type: 'resolve'; decision: 'APPROVE' | 'REJECT'; txId: string; amount: number }
    | { type: 'void-voucher'; voucherId: string; amount: number };

export default function Vaults({ token, hasPerm, initialSelectedId }: { token: string; hasPerm: (perms: string[]) => boolean; initialSelectedId?: string }) {
    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'frozen'>('all');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [roleDraft, setRoleDraft] = useState<Record<string, boolean>>({});

    const { toasts, push } = useToast();
    const canManage = hasPerm(['perm_vault_manage']);

    useEffect(() => { if (initialSelectedId) setSelectedId(initialSelectedId); }, [initialSelectedId]);

    const fetchList = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/vaults`, { headers: { Authorization: `Bearer ${token}` } });
            setVaults(data.vaults || []);
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
            const data = await apiFetch(`${API_URL}/api/admin/vaults/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            setDetail(data.vault);
        } catch (e: any) {
            setError(e.message);
            setSelectedId(null);
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => { fetchList(); }, []);
    useEffect(() => { if (selectedId) fetchDetail(selectedId); else setDetail(null); }, [selectedId]);

    const runAction = async (path: string, method: 'POST' | 'PUT', body: any, successMessage: string) => {
        try {
            await apiFetch(`${API_URL}/api/admin${path}`, {
                method,
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            });
            push(successMessage, 'success');
            setConfirmState(null);
            setEditingMemberId(null);
            if (selectedId) fetchDetail(selectedId);
            fetchList();
        } catch (e: any) {
            push(e.message, 'error');
        }
    };

    const startEditRole = (m: any) => {
        setEditingMemberId(m.id);
        setRoleDraft({ isAdmin: m.isAdmin, isInitiator: m.isInitiator, isValidator: m.isValidator, isTreasurer: m.isTreasurer, isRequiredValidator: m.isRequiredValidator });
    };

    const saveRole = (userId: string) => runAction(`/vaults/${selectedId}/members/${userId}/role`, 'PUT', roleDraft, 'Rôles mis à jour.');

    if (selectedId) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <ToastHost toasts={toasts} />
                <button onClick={() => setSelectedId(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux caisses
                </button>

                {detailLoading || !detail ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : (
                    <>
                        <PageHeader
                            title={detail.name}
                            subtitle={detail.description || `Président : ${detail.admin?.name} (${detail.admin?.phone})`}
                            action={canManage ? (
                                detail.isFrozen
                                    ? <button onClick={() => setConfirmState({ type: 'unfreeze' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--success-bg)', color: 'var(--success)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Unlock size={14} /> Dégeler la caisse</button>
                                    : <button onClick={() => setConfirmState({ type: 'freeze' })} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}><Lock size={14} /> Geler la caisse</button>
                            ) : undefined}
                        />

                        {detail.isFrozen && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, margin: '16px 0' }}>
                                <Lock size={15} /> Caisse gelée{detail.frozenReason ? ` — ${detail.frozenReason}` : ''}. Dépôts, retraits et bons sont bloqués jusqu'au dégel.
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '20px 0 28px' }}>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Solde</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(detail.balance)}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Membres</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{detail.members.length}</div>
                            </div>
                            <div className="table-container" style={{ padding: 16, flex: '1 1 200px' }}>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Seuil d'approbation</div>
                                <div style={{ fontSize: 22, fontWeight: 800 }}>{detail.requiredApprovals}</div>
                            </div>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Membres</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôles</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {detail.members.map((m: any) => (
                                        <tr key={m.id}>
                                            <td>{m.user.name}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{m.user.phone}</td>
                                            <td>
                                                {editingMemberId === m.id ? (
                                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                                        {Object.entries(ROLE_LABELS).map(([k, label]) => (
                                                            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                                                                <input type="checkbox" checked={!!roleDraft[k]} onChange={e => setRoleDraft(d => ({ ...d, [k]: e.target.checked }))} /> {label}
                                                            </label>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                        {Object.entries(ROLE_LABELS).filter(([k]) => m[k]).map(([k, label]) => (
                                                            <span key={k} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: 'var(--accent-bg)', color: 'var(--accent)' }}>{label}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            {canManage && (
                                                <td style={{ whiteSpace: 'nowrap' }}>
                                                    {editingMemberId === m.id ? (
                                                        <div style={{ display: 'flex', gap: 6 }}>
                                                            <ActionButton onClick={() => saveRole(m.user.id)}>Enregistrer</ActionButton>
                                                            <ActionButton onClick={() => setEditingMemberId(null)}>Annuler</ActionButton>
                                                        </div>
                                                    ) : (
                                                        <ActionButton onClick={() => startEditRole(m)}>Modifier</ActionButton>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Transactions ({detail.transactions.length})</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Demandé par</th><th>Motif</th><th>Destination</th><th>Approbations</th><th>Statut</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {detail.transactions.length === 0 ? (
                                        <tr><td colSpan={canManage ? 9 : 8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune transaction.</td></tr>
                                    ) : detail.transactions.map((tx: any) => (
                                        <tr key={tx.id}>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                            <td>{tx.type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'}</td>
                                            <td style={{ fontWeight: 700 }}>{fmt(tx.amount)}</td>
                                            <td>{tx.requestedBy?.name}</td>
                                            <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={tx.reason || ''}>{tx.reason || '—'}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{tx.destinationType || '—'}</td>
                                            <td>{tx.type === 'WITHDRAW_REQUEST' ? `${tx.approvals.length}/${detail.requiredApprovals}` : '—'}</td>
                                            <td><StatusPill status={tx.status} /></td>
                                            {canManage && (
                                                <td style={{ whiteSpace: 'nowrap' }}>
                                                    {tx.type === 'WITHDRAW_REQUEST' && tx.status === 'PENDING' && (
                                                        <div style={{ display: 'flex', gap: 6 }}>
                                                            <ActionButton onClick={() => setConfirmState({ type: 'resolve', decision: 'APPROVE', txId: tx.id, amount: tx.amount })}>Forcer l'approbation</ActionButton>
                                                            <ActionButton danger onClick={() => setConfirmState({ type: 'resolve', decision: 'REJECT', txId: tx.id, amount: tx.amount })}>Rejeter</ActionButton>
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Bons de retrait ({detail.vouchers.length})</h3>
                        <div className="table-container">
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Montant</th><th>Porteur</th><th>Créé le</th><th>Utilisé le</th><th>Statut</th>{canManage && <th></th>}</tr></thead>
                                <tbody>
                                    {detail.vouchers.length === 0 ? (
                                        <tr><td colSpan={canManage ? 6 : 5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun bon émis.</td></tr>
                                    ) : detail.vouchers.map((v: any) => (
                                        <tr key={v.id}>
                                            <td style={{ fontWeight: 700 }}>{fmt(v.amount)}</td>
                                            <td>{v.president?.name}<div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v.president?.phone}</div></td>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtDate(v.createdAt)}</td>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{v.usedAt ? fmtDate(v.usedAt) : '—'}</td>
                                            <td><StatusPill status={v.status} /></td>
                                            {canManage && (
                                                <td>
                                                    {v.status === 'ACTIVE' && (
                                                        <ActionButton danger onClick={() => setConfirmState({ type: 'void-voucher', voucherId: v.id, amount: v.amount })}><Ban size={11} style={{ verticalAlign: -1, marginRight: 3 }} />Annuler</ActionButton>
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

                {confirmState?.type === 'freeze' && (
                    <ConfirmDialog
                        title="Geler cette caisse"
                        subtitle="Bloque immédiatement dépôts, retraits, approbations et bons pour cette caisse — les membres verront un message explicite. Réversible via « Dégeler »."
                        confirmLabel="Geler"
                        danger
                        requireReason
                        reasonLabel="Motif du gel"
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/vaults/${selectedId}/freeze`, 'POST', { reason }, 'Caisse gelée.')}
                    />
                )}
                {confirmState?.type === 'unfreeze' && (
                    <ConfirmDialog
                        title="Dégeler cette caisse"
                        subtitle="Les membres pourront de nouveau déposer, demander et approuver des retraits."
                        confirmLabel="Dégeler"
                        onClose={() => setConfirmState(null)}
                        onConfirm={() => runAction(`/vaults/${selectedId}/unfreeze`, 'POST', {}, 'Caisse dégelée.')}
                    />
                )}
                {confirmState?.type === 'resolve' && (
                    <ConfirmDialog
                        title={confirmState.decision === 'APPROVE' ? "Forcer l'approbation de ce retrait" : 'Rejeter ce retrait'}
                        subtitle={`${fmt(confirmState.amount)} — cette décision contourne le quorum multisig normal. Elle est tracée et notifiée au demandeur.`}
                        confirmLabel={confirmState.decision === 'APPROVE' ? 'Approuver et exécuter' : 'Confirmer le rejet'}
                        danger={confirmState.decision === 'REJECT'}
                        requireReason
                        reasonLabel="Motif de la décision"
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/vaults/${selectedId}/withdraw-requests/${confirmState.txId}/force-resolve`, 'POST', { decision: confirmState.decision, reason }, confirmState.decision === 'APPROVE' ? 'Retrait approuvé et exécuté.' : 'Retrait rejeté.')}
                    />
                )}
                {confirmState?.type === 'void-voucher' && (
                    <ConfirmDialog
                        title="Annuler ce bon de retrait"
                        subtitle={`${fmt(confirmState.amount)} — le bon ne pourra plus être dépensé. Action définitive.`}
                        confirmLabel="Annuler le bon"
                        danger
                        onClose={() => setConfirmState(null)}
                        onConfirm={reason => runAction(`/vaults/${selectedId}/vouchers/${confirmState.voucherId}/void`, 'POST', { reason }, 'Bon annulé.')}
                    />
                )}
            </div>
        );
    }

    const filteredVaults = vaults.filter(v => {
        if (statusFilter === 'frozen' && !v.isFrozen) return false;
        if (!search) return true;
        const s = search.toLowerCase();
        return v.name?.toLowerCase().includes(s) || v.admin?.name?.toLowerCase().includes(s) || v.admin?.phone?.includes(s);
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <ToastHost toasts={toasts} />
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Caisses Communes" subtitle={canManage ? "Vue d'ensemble des coffres collectifs multi-signatures — geler, débloquer un retrait contesté, réassigner un rôle." : "Vue d'ensemble des coffres collectifs multi-signatures — lecture seule."} />
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    placeholder="🔍 Rechercher une caisse ou un président…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ width: '100%', maxWidth: 360, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}
                />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}>
                    <option value="all">Toutes</option>
                    <option value="frozen">Gelées uniquement</option>
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
                            <th>Caisse</th><th>Président</th><th>Membres</th><th>Solde</th><th>Seuil</th><th>En attente</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : filteredVaults.length === 0 ? (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{vaults.length === 0 ? "Aucune caisse commune créée pour l'instant." : 'Aucune caisse ne correspond à la recherche.'}</td></tr>
                        ) : filteredVaults.map(v => (
                            <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(v.id)}>
                                <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                                    {v.isFrozen ? <Lock size={14} color="var(--danger)" /> : <Shield size={14} color="var(--accent)" />} {v.name}
                                </td>
                                <td style={{ color: 'var(--text-secondary)' }}>{v.admin?.name}</td>
                                <td style={{ color: 'var(--text-secondary)' }}><UsersIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />{v._count.members}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(v.balance)}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{v.requiredApprovals}</td>
                                <td>
                                    {v.isFrozen ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>Gelée</span>
                                    ) : v._count.transactions > 0 ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                                            {v._count.transactions} en attente
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
