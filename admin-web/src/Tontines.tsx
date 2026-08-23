import { ArrowLeft, RefreshCw, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Vue lecture seule sur les Tontines — jusqu'ici, un litige (cagnotte non reçue,
// cotisation prélevée en double, ordre de versement contesté) était invisible pour
// toute l'équipe : TontineGroup n'apparaissait dans aucun écran admin. Aucune action
// d'intervention ici volontairement — seulement de quoi comprendre une situation
// avant de répondre à un ticket. Miroir de Vaults.tsx (Caisses Communes).
const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Active', COMPLETED: 'Terminée', CANCELLED: 'Annulée' };
const FREQUENCY_LABELS: Record<string, string> = { WEEKLY: 'Hebdomadaire', MONTHLY: 'Mensuelle' };
const PARTICIPANT_STATUS_LABELS: Record<string, string> = { ACTIVE: 'Actif', PAUSED: 'En pause' };
const TX_STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', COMPLETED: 'Terminée', FAILED: 'Échouée' };

const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function StatusPill({ status, labels }: { status: string; labels: Record<string, string> }) {
    const colors: Record<string, { bg: string; color: string }> = {
        ACTIVE: { bg: 'var(--success-bg, #d1fae5)', color: 'var(--success, #059669)' },
        COMPLETED: { bg: 'var(--success-bg, #d1fae5)', color: 'var(--success, #059669)' },
        CANCELLED: { bg: 'var(--danger-bg, #fee2e2)', color: 'var(--danger, #dc2626)' },
        PAUSED: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' },
        PENDING: { bg: 'var(--warning-bg, #fef3c7)', color: 'var(--warning, #b45309)' },
        FAILED: { bg: 'var(--danger-bg, #fee2e2)', color: 'var(--danger, #dc2626)' },
    };
    const c = colors[status] || { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{labels[status] || status}</span>;
}

export default function Tontines({ token, initialSelectedId }: { token: string; initialSelectedId?: string }) {
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);

    // Arrivée depuis la recherche globale (barre du haut) : ouvre directement la tontine
    // visée sans forcer l'admin à la retrouver dans la liste.
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

    if (selectedId) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <button onClick={() => setSelectedId(null)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux tontines
                </button>

                {detailLoading || !detail ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : (
                    <>
                        <PageHeader title={detail.name} subtitle={`Créateur : ${detail.creator?.name} (${detail.creator?.phone})`} />

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
                                <thead><tr><th>Nom</th><th>Téléphone</th><th>Ordre de versement</th><th>Statut</th><th>Cagnotte reçue</th></tr></thead>
                                <tbody>
                                    {detail.participants.map((p: any) => (
                                        <tr key={p.id}>
                                            <td>{p.user.name}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{p.user.phone}</td>
                                            <td>{p.payoutOrder}</td>
                                            <td><StatusPill status={p.status} labels={PARTICIPANT_STATUS_LABELS} /></td>
                                            <td>{p.hasReceivedPayout ? '✅ Oui' : '—'}</td>
                                        </tr>
                                    ))}
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
            </div>
        );
    }

    const filteredGroups = groups.filter(g => {
        if (!search) return true;
        const s = search.toLowerCase();
        return g.name?.toLowerCase().includes(s) || g.creator?.name?.toLowerCase().includes(s) || g.creator?.phone?.includes(s);
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <PageHeader title="Tontines" subtitle="Vue d'ensemble des clubs de tontine — lecture seule, pour comprendre une situation avant de répondre à un litige." />
                <button onClick={fetchList} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    <RefreshCw size={14} /> Rafraîchir
                </button>
            </div>

            <input
                placeholder="🔍 Rechercher une tontine ou un créateur…"
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
                                <td style={{ fontWeight: 600 }}>{g.name}</td>
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
