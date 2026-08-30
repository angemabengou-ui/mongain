import { AlertTriangle, ArrowUpCircle, BarChart2, CheckCircle, Clock, Filter, MessageSquare, RefreshCw, Shield, ShieldAlert, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import KpiCard from './components/KpiCard';
import PageHeader from './components/PageHeader';
import TabBar from './components/TabBar';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

interface SupportCenterProps { token: string; role?: string; }

// Removed obsolete hardcoded FINANCE_ROLES const array.

const STATUS_COLORS: Record<string, string> = {
    OPEN: 'var(--warning)', ASSIGNED: '#3b82f6', IN_PROGRESS: '#8b5cf6',
    WAITING_CUSTOMER: 'var(--warning)', WAITING_INTERNAL: 'var(--accent)',
    ESCALATED: 'var(--danger)', REOPENED: '#ec4899',
    RESOLVED: 'var(--success)', CLOSED: '#6b7280',
};

const TICKET_STATUS_LABELS: Record<string, string> = {
    OPEN: 'Ouvert', ASSIGNED: 'Assigné', IN_PROGRESS: 'En cours',
    WAITING_CUSTOMER: 'Attente client', WAITING_INTERNAL: 'Attente interne',
    ESCALATED: 'Escaladé', REOPENED: 'Réouvert',
    RESOLVED: 'Résolu', CLOSED: 'Clos',
};

const PRIORITY_COLORS: Record<string, string> = {
    LOW: '#6b7280', NORMAL: '#3b82f6', HIGH: 'var(--warning)', CRITICAL: 'var(--danger)',
};

const PRIORITY_LABELS: Record<string, string> = {
    LOW: 'Faible', NORMAL: 'Normale', HIGH: 'Haute', CRITICAL: 'Critique',
};

const CATEGORY_LABELS: Record<string, string> = {
    ACCOUNT: 'Compte', KYC: 'KYC', TRANSACTION: 'Transaction', CASH_IN: 'Dépôt',
    CASH_OUT: 'Retrait', MERCHANT: 'Marchand', AGENCY: 'Agence', TONTINE: 'Tontine', FRAUD: 'Fraude',
    REFUND: 'Remboursement', TECHNICAL: 'Technique', LIMIT: 'Plafond', OTHER: 'Autre',
};

const FRAUD_TYPE_LABELS: Record<string, string> = {
    SUSPICIOUS_ACTIVITY: 'Activité suspecte', ACCOUNT_TAKEOVER: 'Piratage de compte',
    MONEY_LAUNDERING: 'Blanchiment', IDENTITY_THEFT: "Usurpation d'identité",
};

// riskLevel par défaut du backend est MEDIUM (pas NORMAL comme la priorité des tickets) —
// carte de couleurs séparée pour ne pas retomber en gris faute de correspondance.
const RISK_LEVEL_COLORS: Record<string, string> = {
    LOW: '#6b7280', MEDIUM: '#3b82f6', HIGH: 'var(--warning)', CRITICAL: 'var(--danger)',
};

const RISK_LEVEL_LABELS: Record<string, string> = {
    LOW: 'Faible', MEDIUM: 'Moyen', HIGH: 'Élevé', CRITICAL: 'Critique',
};

const FRAUD_STATUS_COLORS: Record<string, string> = {
    OPEN: 'var(--warning)', INVESTIGATION: '#8b5cf6', CONFIRMED: 'var(--danger)',
    FALSE_POSITIVE: 'var(--success)', CLOSED: '#6b7280',
};

const FRAUD_STATUS_LABELS: Record<string, string> = {
    OPEN: 'Ouvert', INVESTIGATION: 'Investigation', CONFIRMED: 'Confirmé',
    FALSE_POSITIVE: 'Faux positif', CLOSED: 'Clos',
};

const REFUND_TYPE_LABELS: Record<string, string> = { FULL: 'Total', PARTIAL: 'Partiel' };

const REFUND_STATUS_LABELS: Record<string, string> = {
    REQUESTED: 'Demandé', UNDER_REVIEW: 'En révision', APPROVED: 'Approuvé',
    EXECUTED: 'Exécuté', REJECTED: 'Rejeté',
};

const TRANSACTION_STATUS_LABELS: Record<string, string> = {
    PENDING: 'En attente', COMPLETED: 'Terminée', FAILED: 'Échouée',
};

function Badge({ text, color }: { text: string; color: string }) {
    return (
        <span style={{ background: color + '22', color, border: `1px solid ${color}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>
            {text}
        </span>
    );
}

interface SupportCenterProps { token: string; hasPerm: (perms: string[]) => boolean; }

export default function SupportCenter({ token, hasPerm }: SupportCenterProps) {
    // Régression : gatait Approuver/Exécuter sur `perm_refund_request` (le Maker, qui CRÉE la
    // demande) au lieu de `perm_refund_approve` (le Checker, seul autorisé côté backend) — le
    // Checker (COMPLIANCE_CHECKER) ne voyait jamais ces boutons, tandis que les Makers en
    // voyaient qui échouaient systématiquement en 403 au clic.
    const canApproveRefunds = hasPerm(['perm_refund_approve']);
    const [tab, setTab] = useState<'dashboard' | 'inbox' | 'fraud' | 'refunds'>('dashboard');
    const [stats, setStats] = useState<any>(null);
    const [tickets, setTickets] = useState<any[]>([]);
    const [fraudCases, setFraudCases] = useState<any[]>([]);
    const [refunds, setRefunds] = useState<any[]>([]);
    const [selectedTicket, setSelectedTicket] = useState<any>(null);
    const [ticketNotes, setTicketNotes] = useState<any[]>([]);
    const [noteContent, setNoteContent] = useState('');
    const [noteIsInternal, setNoteIsInternal] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Ticket Filters
    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [slaFilter, setSlaFilter] = useState(false);

    // Refund Filters
    const [refundStatusFilter, setRefundStatusFilter] = useState('');

    // Fraud Filters
    const [fraudStatusFilter, setFraudStatusFilter] = useState('');

    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const fetchStats = useCallback(async () => {
        try {
            setStats(await apiFetch(`${API_URL}/api/admin/reclamations/stats`, { headers }));
        } catch (e) { console.error(e); }
    }, [token]);

    const fetchTickets = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set('status', statusFilter);
            if (priorityFilter) params.set('priority', priorityFilter);
            if (categoryFilter) params.set('category', categoryFilter);
            if (searchQuery) params.set('query', searchQuery);
            if (slaFilter) params.set('slaBreached', 'true');
            params.set('limit', '100');
            const d = await apiFetch(`${API_URL}/api/admin/reclamations?${params}`, { headers });
            setTickets(d.tickets || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [token, statusFilter, priorityFilter, categoryFilter, searchQuery, slaFilter]);

    const fetchFraudCases = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (fraudStatusFilter) params.set('status', fraudStatusFilter);
            const d = await apiFetch(`${API_URL}/api/admin/fraud-cases?${params}`, { headers });
            setFraudCases(d.cases || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        }
    }, [token, fraudStatusFilter]);

    const fetchRefunds = useCallback(async () => {
        try {
            const params = new URLSearchParams();
            if (refundStatusFilter) params.set('status', refundStatusFilter);
            const d = await apiFetch(`${API_URL}/api/admin/refund-requests?${params}`, { headers });
            setRefunds(d.refunds || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        }
    }, [token, refundStatusFilter]);

    const openTicket = async (t: any) => {
        try {
            const d = await apiFetch(`${API_URL}/api/admin/reclamations/${t.id}`, { headers });
            setSelectedTicket(d);
            setTicketNotes(d.notes || []);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const addNote = async () => {
        if (!noteContent.trim() || !selectedTicket) return;
        try {
            const d = await apiFetch(`${API_URL}/api/admin/reclamations/${selectedTicket.id}/notes`, {
                method: 'POST', headers, body: JSON.stringify({ content: noteContent, isInternal: noteIsInternal })
            });
            setTicketNotes(prev => [...prev, d.note]);
            setNoteContent('');
            setError('');
            // Le backend peut faire transiter le ticket vers WAITING_CUSTOMER/IN_PROGRESS
            // automatiquement — refléter ce changement dans le panneau ET dans la liste
            // (sans ce second update, la liste affichait l'ancien statut jusqu'au prochain
            // rechargement complet, divergent du panneau à droite).
            setSelectedTicket((t: any) => t ? { ...t, status: d.status, assigneeId: d.assigneeId } : t);
            setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: d.status, assigneeId: d.assigneeId } : t));
        } catch (e: any) {
            setError(e.message);
        }
    };

    const updateTicketStatus = async (id: string, status: string) => {
        try {
            await apiFetch(`${API_URL}/api/admin/reclamations/${id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ status })
            });
            fetchTickets();
            if (selectedTicket?.id === id) setSelectedTicket((t: any) => ({ ...t, status }));
        } catch (e: any) {
            setError(e.message);
        }
    };

    const approveRefund = async (id: string, action: 'APPROVE' | 'REJECT') => {
        try {
            await apiFetch(`${API_URL}/api/admin/refund-requests/${id}/approve`, {
                method: 'PATCH', headers, body: JSON.stringify({ action })
            });
            fetchRefunds();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const executeRefund = async (id: string) => {
        try {
            await apiFetch(`${API_URL}/api/admin/refund-requests/${id}/execute`, { method: 'POST', headers });
            fetchRefunds();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const updateFraudCase = async (id: string, status: string, decision?: string) => {
        try {
            await apiFetch(`${API_URL}/api/admin/fraud-cases/${id}`, {
                method: 'PATCH', headers, body: JSON.stringify({ status, decision })
            });
            fetchFraudCases();
        } catch (e: any) {
            setError(e.message);
        }
    };

    useEffect(() => { fetchStats(); }, [fetchStats]);
    useEffect(() => { if (tab === 'inbox') fetchTickets(); }, [tab, fetchTickets]);
    useEffect(() => { if (tab === 'fraud') fetchFraudCases(); }, [tab, fetchFraudCases]);
    useEffect(() => { if (tab === 'refunds') fetchRefunds(); }, [tab, fetchRefunds]);

    const CATEGORIES = ['ACCOUNT', 'KYC', 'TRANSACTION', 'CASH_IN', 'CASH_OUT', 'MERCHANT', 'AGENCY', 'TONTINE', 'FRAUD', 'REFUND', 'TECHNICAL', 'LIMIT', 'OTHER'];
    const STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'ESCALATED', 'REOPENED', 'RESOLVED', 'CLOSED'];

    const sla = (t: any) => {
        if (!t.slaDeadline) return null;
        const mins = Math.round((new Date(t.slaDeadline).getTime() - Date.now()) / 60000);
        if (t.slaBreached) return <Badge text="SLA Dépassé" color="var(--danger)" />;
        if (mins < 60) return <Badge text={`SLA: ${mins}m`} color="var(--warning)" />;
        if (mins < 120) return <Badge text={`SLA: ${Math.round(mins / 60)}h`} color="var(--warning)" />;
        return <Badge text={`SLA: ${Math.round(mins / 60)}h`} color="var(--success)" />;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
            <div style={{ marginBottom: 20 }}>
                <PageHeader title="Support & Réclamations" subtitle="Centre unifié de gestion des tickets, fraudes et remboursements clients." />
            </div>
            <TabBar<'dashboard' | 'inbox' | 'fraud' | 'refunds'>
                tabs={[
                    { id: 'dashboard', icon: <BarChart2 size={15} />, label: 'Tableau de Bord' },
                    { id: 'inbox', icon: <MessageSquare size={15} />, label: 'Boîte de Réception' },
                    { id: 'fraud', icon: <ShieldAlert size={15} />, label: 'Fraudes' },
                    { id: 'refunds', icon: <ArrowUpCircle size={15} />, label: 'Remboursements' },
                ]}
                active={tab}
                onChange={setTab}
            />

            {error && <div style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13 }}>{error} <button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button></div>}

            {/* ─── DASHBOARD ─── */}
            {tab === 'dashboard' && (
                <div style={{ paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <KpiCard label="Ouverts" value={stats?.open ?? '…'} color="var(--warning)" icon={<FilterIcon size={18} />} />
                        <KpiCard label="En Cours" value={stats?.inProgress ?? '…'} color="#8b5cf6" icon={<RefreshCw size={18} />} />
                        <KpiCard label="Attente Client" value={stats?.waitingCustomer ?? '…'} color="var(--warning)" icon={<Clock size={18} />} />
                        <KpiCard label="SLA Dépassés" value={stats?.slaBreached ?? '…'} color="var(--danger)" icon={<AlertTriangle size={18} />} />
                        <KpiCard label="Critiques" value={stats?.critical ?? '…'} color="var(--danger)" icon={<ShieldAlert size={18} />} />
                        <KpiCard label="Remb. en Attente" value={stats?.refundPending ?? '…'} color="#0ea5e9" icon={<ArrowUpCircle size={18} />} />
                        <KpiCard label="Fraudes Actives" value={stats?.fraudCases ?? '…'} color="var(--danger)" icon={<Shield size={18} />} />
                    </div>
                    <button onClick={fetchStats} style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <RefreshCw size={14} /> Rafraîchir
                    </button>
                </div>
            )}

            {/* ─── INBOX ─── */}
            {tab === 'inbox' && (
                <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden', paddingTop: 16 }}>
                    {/* List */}
                    <div style={{ flex: selectedTicket ? '0 0 52%' : '1', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
                        {/* Filters */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <input placeholder="🔍 Rechercher…" value={searchQuery} onChange={e => { setSearchQuery(e.target.value) }} onKeyDown={e => e.key === 'Enter' && fetchTickets()}
                                style={{ flex: 1, minWidth: 200, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', color: 'var(--text-primary)', fontSize: 13 }} />
                            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}>
                                <option value="">Tous statuts</option>
                                {STATUSES.map(s => <option key={s} value={s}>{TICKET_STATUS_LABELS[s] || s}</option>)}
                            </select>
                            <select value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); }} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}>
                                <option value="">Toutes prios</option>
                                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map(p => <option key={p} value={p}>{PRIORITY_LABELS[p] || p}</option>)}
                            </select>
                            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); }} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}>
                                <option value="">Toutes catégories</option>
                                {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
                            </select>
                            <button onClick={() => setSlaFilter(!slaFilter)} style={{ background: slaFilter ? 'var(--danger-bg)' : 'var(--bg-card)', border: `1px solid ${slaFilter ? 'var(--danger)' : 'var(--border)'}`, borderRadius: 8, padding: '6px 10px', color: slaFilter ? 'var(--danger)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <AlertTriangle size={13} /> SLA Dépassés
                            </button>
                            <button onClick={fetchTickets} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Filter size={13} /> Filtrer
                            </button>
                        </div>

                        {/* Table */}
                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {loading ? <div style={{ color: 'var(--text-muted)', padding: 20 }}>Chargement…</div> : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                            {['ID', 'Client', 'Catégorie', 'Priorité', 'Statut', 'SLA', 'Assigné', 'Date'].map(h => (
                                                <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tickets.map(t => (
                                            <tr key={t.id} onClick={() => openTicket(t)} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: selectedTicket?.id === t.id ? 'var(--accent-bg)' : 'transparent', transition: 'background .1s' }}>
                                                <td style={{ padding: '8px', fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 10 }}>{t.id.slice(0, 8)}</td>
                                                <td style={{ padding: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>{t.user?.name}<br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{t.user?.phone}</span></td>
                                                <td style={{ padding: '8px' }}><Badge text={CATEGORY_LABELS[t.category] || t.category} color="var(--accent)" /></td>
                                                <td style={{ padding: '8px' }}><Badge text={PRIORITY_LABELS[t.priority] || t.priority} color={PRIORITY_COLORS[t.priority] || '#6b7280'} /></td>
                                                <td style={{ padding: '8px' }}><Badge text={TICKET_STATUS_LABELS[t.status] || t.status} color={STATUS_COLORS[t.status] || '#6b7280'} /></td>
                                                <td style={{ padding: '8px' }}>{sla(t)}</td>
                                                <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>{t.assignee?.name || '—'}</td>
                                                <td style={{ padding: '8px', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(t.createdAt).toLocaleDateString('fr-FR')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Ticket Detail Panel */}
                    {selectedTicket && (
                        <div style={{ flex: '0 0 46%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* Header */}
                            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedTicket.title}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>#{selectedTicket.id.slice(0, 8)} · {CATEGORY_LABELS[selectedTicket.category] || selectedTicket.category} · <Badge text={PRIORITY_LABELS[selectedTicket.priority] || selectedTicket.priority} color={PRIORITY_COLORS[selectedTicket.priority]} /> · <Badge text={TICKET_STATUS_LABELS[selectedTicket.status] || selectedTicket.status} color={STATUS_COLORS[selectedTicket.status]} /></div>
                                </div>
                                <button onClick={() => setSelectedTicket(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                            </div>

                            {/* Meta */}
                            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: 'var(--text-muted)' }}>
                                <span>👤 <b style={{ color: 'var(--text-primary)' }}>{selectedTicket.user?.name}</b> · {selectedTicket.user?.phone}</span>
                                {selectedTicket.assignee && <span>📋 Assigné: <b style={{ color: 'var(--text-primary)' }}>{selectedTicket.assignee.name}</b></span>}
                                {selectedTicket.transactionDetails && (
                                    <span>💳 TX: <b style={{ color: 'var(--success)' }}>{selectedTicket.transactionDetails.amount?.toLocaleString('fr-FR')} FCFA</b> [{TRANSACTION_STATUS_LABELS[selectedTicket.transactionDetails.status] || selectedTicket.transactionDetails.status}]</span>
                                )}
                                {selectedTicket.branchDetails && (
                                    <span>🏢 Agence: <b style={{ color: 'var(--text-primary)' }}>{selectedTicket.branchDetails.name}</b></span>
                                )}
                                {selectedTicket.slaDeadline && <span>⏱ SLA: {sla(selectedTicket)}</span>}
                                {selectedTicket.escalatedTo && <span style={{ color: 'var(--danger)' }}>🔺 Escaladé → {selectedTicket.escalatedTo}</span>}
                            </div>

                            {/* Description */}
                            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-primary)', fontStyle: 'italic' }}>{selectedTicket.description}</div>

                            {/* Actions rapides */}
                            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {['IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'RESOLVED', 'CLOSED'].map(s => (
                                    selectedTicket.status !== s && (
                                        <button key={s} onClick={() => updateTicketStatus(selectedTicket.id, s)} style={{ background: 'var(--bg-primary)', border: `1px solid ${STATUS_COLORS[s]}55`, color: STATUS_COLORS[s], borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                            → {s}
                                        </button>
                                    )
                                ))}
                                <button onClick={() => updateTicketStatus(selectedTicket.id, 'ESCALATED')} style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)', color: 'var(--danger)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                                    🔺 ESCALADE
                                </button>
                            </div>

                            {/* Timeline Notes */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {ticketNotes.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 16 }}>Aucune note.</div>}
                                {ticketNotes.map((n: any) => (
                                    <div key={n.id} style={{ background: n.isInternal ? 'var(--warning-bg)' : 'var(--success-bg)', border: `1px solid ${n.isInternal ? 'var(--warning-bg)' : 'var(--success-bg)'}`, borderRadius: 8, padding: '8px 12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                                            <span>📝 <b>{n.authorName}</b></span>
                                            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                                {n.isInternal && <Badge text="INTERNE" color="var(--warning)" />}
                                                {new Date(n.createdAt).toLocaleString('fr-FR')}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{n.content}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Add Note */}
                            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={noteIsInternal} onChange={e => setNoteIsInternal(e.target.checked)} />
                                        Note Interne
                                    </label>
                                    {!noteIsInternal && <Badge text="RÉPONSE CLIENT" color="var(--success)" />}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <textarea value={noteContent} onChange={e => setNoteContent(e.target.value)} placeholder="Ajouter une note ou réponse…"
                                        style={{ flex: 1, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px', color: 'var(--text-primary)', fontSize: 12, resize: 'none', height: 64 }} />
                                    <button onClick={addNote} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '0 16px', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                                        Envoyer
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── FRAUD CASES ─── */}
            {tab === 'fraud' && (
                <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                        <select value={fraudStatusFilter} onChange={e => setFraudStatusFilter(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}>
                            <option value="">Tous statuts</option>
                            {['OPEN', 'INVESTIGATION', 'CONFIRMED', 'FALSE_POSITIVE', 'CLOSED'].map(s => <option key={s} value={s}>{FRAUD_STATUS_LABELS[s] || s}</option>)}
                        </select>
                        <button onClick={fetchFraudCases} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Rafraîchir</button>
                    </div>
                    <div style={{ overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                    {['ID', 'Client', 'Type', 'Risque', 'Statut', 'Analyste', 'Date', 'Actions'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {fraudCases.map(fc => (
                                    <tr key={fc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{fc.id.slice(0, 8)}</td>
                                        <td style={{ padding: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>{fc.user?.name}<br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fc.user?.phone}</span></td>
                                        <td style={{ padding: '8px' }}><Badge text={FRAUD_TYPE_LABELS[fc.type] || fc.type} color="#8b5cf6" /></td>
                                        <td style={{ padding: '8px' }}><Badge text={RISK_LEVEL_LABELS[fc.riskLevel] || fc.riskLevel} color={RISK_LEVEL_COLORS[fc.riskLevel] || '#6b7280'} /></td>
                                        <td style={{ padding: '8px' }}><Badge text={FRAUD_STATUS_LABELS[fc.status] || fc.status} color={FRAUD_STATUS_COLORS[fc.status] || '#6b7280'} /></td>
                                        <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>{fc.analyst?.name || '—'}</td>
                                        <td style={{ padding: '8px', fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(fc.createdAt).toLocaleDateString('fr-FR')}</td>
                                        <td style={{ padding: '8px' }}>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                {fc.status === 'OPEN' && <button onClick={() => updateFraudCase(fc.id, 'INVESTIGATION')} style={{ background: '#3b82f611', border: '1px solid #3b82f633', color: '#3b82f6', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Investiguer</button>}
                                                {fc.status === 'INVESTIGATION' && <>
                                                    <button onClick={() => updateFraudCase(fc.id, 'CONFIRMED', 'FRAUD')} style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)', color: 'var(--danger)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Confirmer</button>
                                                    <button onClick={() => updateFraudCase(fc.id, 'FALSE_POSITIVE', 'INVALID')} style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)', color: 'var(--success)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Faux Positif</button>
                                                </>}
                                                {(fc.status === 'CONFIRMED' || fc.status === 'FALSE_POSITIVE') && <button onClick={() => updateFraudCase(fc.id, 'CLOSED')} style={{ background: '#6b728011', border: '1px solid #6b728033', color: '#6b7280', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>Clore</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {fraudCases.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Aucun dossier fraude.</div>}
                    </div>
                </div>
            )}

            {/* ─── REFUND REQUESTS ─── */}
            {tab === 'refunds' && (
                <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                        <select value={refundStatusFilter} onChange={e => setRefundStatusFilter(e.target.value)}
                            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12 }}>
                            <option value="">Tous statuts</option>
                            {['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'EXECUTED', 'REJECTED'].map(s => <option key={s} value={s}>{REFUND_STATUS_LABELS[s] || s}</option>)}
                        </select>
                        <button onClick={fetchRefunds} style={{ background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '6px 14px', color: '#fff', cursor: 'pointer', fontSize: 12 }}>Rafraîchir</button>
                    </div>

                    <div style={{ overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                                    {['ID', 'Client', 'Montant', 'Type', 'Motif', 'Demandeur', 'Approbateur', 'Statut', 'Actions'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {refunds.map((r: any) => (
                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{r.id.slice(0, 8)}</td>
                                        <td style={{ padding: '8px', color: 'var(--text-primary)', fontWeight: 500 }}>{r.user?.name}<br /><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.user?.phone}</span></td>
                                        <td style={{ padding: '8px', color: 'var(--success)', fontWeight: 700 }}>{r.amount?.toLocaleString('fr-FR')} FCFA</td>
                                        <td style={{ padding: '8px' }}><Badge text={REFUND_TYPE_LABELS[r.refundType] || r.refundType} color="#0ea5e9" /></td>
                                        <td style={{ padding: '8px', maxWidth: 160, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</td>
                                        <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>{r.requester?.name || '—'}</td>
                                        <td style={{ padding: '8px', fontSize: 11, color: 'var(--text-muted)' }}>{r.approver?.name || '—'}</td>
                                        <td style={{ padding: '8px' }}><Badge text={REFUND_STATUS_LABELS[r.status] || r.status} color={r.status === 'EXECUTED' ? 'var(--success)' : r.status === 'REJECTED' ? 'var(--danger)' : r.status === 'APPROVED' ? '#3b82f6' : 'var(--warning)'} /></td>
                                        <td style={{ padding: '8px' }}>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                {(r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && (canApproveRefunds ? <>
                                                    <button onClick={() => approveRefund(r.id, 'APPROVE')} style={{ background: 'var(--success-bg)', border: '1px solid var(--success-bg)', color: 'var(--success)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}><CheckCircle size={10} />Approuver</button>
                                                    <button onClick={() => approveRefund(r.id, 'REJECT')} style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-bg)', color: 'var(--danger)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}><XCircle size={10} />Rejeter</button>
                                                </> : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>En attente d'approbation Finance</span>)}
                                                {r.status === 'APPROVED' && (canApproveRefunds ? (
                                                    <button onClick={() => executeRefund(r.id)} style={{ background: 'var(--accent)', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>⚡ Exécuter</button>
                                                ) : <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>En attente d'exécution Finance</span>)}
                                                {r.status === 'EXECUTED' && <span style={{ color: 'var(--success)', fontSize: 10 }}>✅ Exécuté</span>}
                                                {r.status === 'REJECTED' && (
                                                    <span style={{ color: 'var(--danger)', fontSize: 10 }} title={r.rejectionReason}>❌ Rejeté</span>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {refunds.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>Aucune demande de remboursement.</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

// Tiny local icon alias
function FilterIcon({ size }: { size: number }) { return <Filter size={size} />; }
