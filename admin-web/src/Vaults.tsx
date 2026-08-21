import { ArrowLeft, Shield, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Vue lecture seule sur les Caisses Communes — jusqu'ici, un litige sur une caisse
// (retrait bloqué, dette de sortie, désaccord entre membres) était invisible pour
// toute l'équipe : le modèle Vault n'apparaissait dans aucun écran admin. Aucune
// action d'intervention ici volontairement (réattribuer un rôle, forcer un retrait) —
// seulement de quoi comprendre une situation avant de répondre à un ticket.
const ROLE_LABELS: Record<string, string> = { isAdmin: 'Président', isInitiator: 'Secrétaire', isValidator: 'Commissaire', isTreasurer: 'Trésorier' };
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        PENDING: { bg: 'var(--warning-bg, #fef3c7)', color: 'var(--warning, #b45309)', label: 'En attente' },
        COMPLETED: { bg: 'var(--success-bg, #d1fae5)', color: 'var(--success, #059669)', label: 'Exécuté' },
        REJECTED: { bg: 'var(--danger-bg, #fee2e2)', color: 'var(--danger, #dc2626)', label: 'Rejeté' },
        ACTIVE: { bg: 'var(--success-bg, #d1fae5)', color: 'var(--success, #059669)', label: 'Actif' },
        USED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: 'Utilisé' },
        LEFT: { bg: 'var(--bg-secondary)', color: 'var(--text-muted)', label: 'A quitté' },
    };
    const s = map[status] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)', label: status };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>;
}

export default function Vaults({ token }: { token: string }) {
    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [detailLoading, setDetailLoading] = useState(false);

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

    if (selectedId) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <button onClick={() => setSelectedId(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux caisses
                </button>

                {detailLoading || !detail ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : (
                    <>
                        <PageHeader title={detail.name} subtitle={detail.description || `Président : ${detail.admin?.name} (${detail.admin?.phone})`} />

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
                                <thead><tr><th>Nom</th><th>Téléphone</th><th>Rôles</th></tr></thead>
                                <tbody>
                                    {detail.members.map((m: any) => (
                                        <tr key={m.id}>
                                            <td>{m.user.name}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{m.user.phone}</td>
                                            <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {Object.entries(ROLE_LABELS).filter(([k]) => m[k]).map(([k, label]) => (
                                                    <span key={k} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: 'var(--accent-bg)', color: 'var(--accent)' }}>{label}</span>
                                                ))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Transactions ({detail.transactions.length})</h3>
                        <div className="table-container" style={{ marginBottom: 28 }}>
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Demandé par</th><th>Motif</th><th>Destination</th><th>Approbations</th><th>Statut</th></tr></thead>
                                <tbody>
                                    {detail.transactions.length === 0 ? (
                                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucune transaction.</td></tr>
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
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <h3 style={{ fontSize: 16, marginBottom: 12 }}>Bons de retrait ({detail.vouchers.length})</h3>
                        <div className="table-container">
                            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                                <thead><tr><th>Montant</th><th>Porteur</th><th>Créé le</th><th>Utilisé le</th><th>Statut</th></tr></thead>
                                <tbody>
                                    {detail.vouchers.length === 0 ? (
                                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun bon émis.</td></tr>
                                    ) : detail.vouchers.map((v: any) => (
                                        <tr key={v.id}>
                                            <td style={{ fontWeight: 700 }}>{fmt(v.amount)}</td>
                                            <td>{v.president?.name}<div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v.president?.phone}</div></td>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{fmtDate(v.createdAt)}</td>
                                            <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{v.usedAt ? fmtDate(v.usedAt) : '—'}</td>
                                            <td><StatusPill status={v.status} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Caisses Communes" subtitle="Vue d'ensemble des coffres collectifs multi-signatures — lecture seule, pour comprendre une situation avant de répondre à un litige." />
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
                        ) : vaults.length === 0 ? (
                            <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Aucune caisse commune créée pour l'instant.</td></tr>
                        ) : vaults.map(v => (
                            <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(v.id)}>
                                <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                                    <Shield size={14} color="var(--accent)" /> {v.name}
                                </td>
                                <td style={{ color: 'var(--text-secondary)' }}>{v.admin?.name}</td>
                                <td style={{ color: 'var(--text-secondary)' }}><UsersIcon size={12} style={{ marginRight: 4, verticalAlign: -1 }} />{v._count.members}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(v.balance)}</td>
                                <td style={{ color: 'var(--text-secondary)' }}>{v.requiredApprovals}</td>
                                <td>
                                    {v._count.transactions > 0 ? (
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: 'var(--warning-bg, #fef3c7)', color: 'var(--warning, #b45309)' }}>
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
