import {
    Activity, AlertTriangle, ArrowLeft, Ban, CheckCircle, Clock,
    FileText, Lock, MessageSquare,
    RefreshCw, ShieldAlert, ShieldCheck,
    Smartphone, Snowflake,
    Ticket, TrendingUp, Unlock, User, Wallet, XCircle
} from 'lucide-react';
import { useEffect, useState } from 'react';
import ImageLightbox from './components/ImageLightbox';
import { API_URL } from './config';

const fmt = (n: number) => n?.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (d: string) => d ? new Date(d).toLocaleString('fr-FR') : '—';

const StatusBadge = ({ status }: { status: string }) => {
    const map: Record<string, [string, string]> = {
        ACTIVE: ['var(--success)', 'var(--success-bg)'],
        SUSPENDED: ['var(--warning)', 'var(--warning-bg)'],
        FROZEN: ['var(--danger)', 'var(--danger-bg)'],
        CLOSED: ['var(--text-muted)', 'var(--bg-secondary)'],
        PENDING_KYC: ['var(--accent)', 'var(--accent-bg)'],
        APPROVED: ['var(--success)', 'var(--success-bg)'],
        REJECTED: ['var(--danger)', 'var(--danger-bg)'],
        PENDING: ['var(--warning)', 'var(--warning-bg)'],
        UNVERIFIED: ['var(--text-muted)', 'var(--bg-secondary)'],
        OPEN: ['var(--warning)', 'var(--warning-bg)'],
        RESOLVED: ['var(--success)', 'var(--success-bg)'],
        CLOSED_R: ['var(--text-muted)', 'var(--bg-secondary)'],
    };
    const [color, bg] = map[status] || ['var(--text-muted)', 'var(--bg-secondary)'];
    return (
        <span style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 12,
            fontWeight: 700, color, background: bg, border: `1px solid ${color}40`
        }}>{status}</span>
    );
};

const TABS = [
    { id: 'overview', label: 'Aperçu', icon: User },
    { id: 'identity', label: 'Identité', icon: ShieldCheck },
    { id: 'kyc', label: 'KYC', icon: FileText },
    { id: 'wallet', label: 'Wallet', icon: Wallet },
    { id: 'limits', label: 'Limites', icon: TrendingUp },
    { id: 'transactions', label: 'Transactions', icon: Activity },
    { id: 'cash-ops', label: 'Cash Ops', icon: RefreshCw },
    { id: 'security', label: 'Sécurité', icon: Lock },
    { id: 'risk', label: 'Risque', icon: ShieldAlert },
    { id: 'complaints', label: 'Réclamations', icon: Ticket },
    { id: 'admin-actions', label: 'Actions Admin', icon: AlertTriangle },
    { id: 'audit', label: 'Audit', icon: Clock },
];

export default function Customer360({ token, userId, onBack, staffRole, hasPerm }: {
    token: string;
    userId: string;
    onBack: () => void;
    staffRole?: string;
    hasPerm: (perms: string[]) => boolean;
}) {
    const [activeTab, setActiveTab] = useState('overview');
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Tab-specific data
    const [txData, setTxData] = useState<any>(null);
    const [cashData, setCashData] = useState<any>(null);
    const [secData, setSecData] = useState<any>(null);
    const [limitsData, setLimitsData] = useState<any>(null);
    const [recData, setRecData] = useState<any[]>([]);
    const [auditData, setAuditData] = useState<any>(null);

    // Action form states
    const [actionReason, setActionReason] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    // Flag form
    const [flagType, setFlagType] = useState('SUSPICIOUS_ACTIVITY');
    const [flagDesc, setFlagDesc] = useState('');

    // KYC reject reason
    const [kycRejectReason, setKycRejectReason] = useState('');
    // Zoom plein écran d'une photo KYC (CNI/selfie) — vignette 150px trop petite pour
    // vérifier sérieusement une pièce d'identité avant d'approuver/rejeter un dossier.
    const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

    // Limit request form
    const [limitForm, setLimitForm] = useState({
        limitType: 'customDailyLimit', requestedValue: '', reason: '', expiresAt: ''
    });
    const [vipLimit, setVipLimit] = useState('');
    const [vipLimitType, setVipLimitType] = useState('customDailyLimit');
    const [vipExpiresAt, setVipExpiresAt] = useState('');

    // Ticket form
    const [ticketForm, setTicketForm] = useState({
        title: '', description: '', priority: 'NORMAL', category: 'OTHER', transactionId: ''
    });
    const [showTicketModal, setShowTicketModal] = useState(false);

    // Tx filters
    const [txFilter, setTxFilter] = useState({ type: '', status: '', page: 1 });

    // ── Freeze / Unfreeze (Prompt 17) ──────────────────────────
    const [freezeReason, setFreezeReason] = useState('SUSPECTED_FRAUD');
    const [freezeComment, setFreezeComment] = useState('');
    const [unfreezeJustification, setUnfreezeJustification] = useState('');

    // ── Refund Request Modal (Prompt 17) ───────────────────────
    const [refundModal, setRefundModal] = useState<any>(null); // { tx } | null
    const [refundAmount, setRefundAmount] = useState('');
    const [refundReason, setRefundReason] = useState('');

    // ── Support Tab (Prompt 17) ────────────────────────────────
    const [supportNote, setSupportNote] = useState('');
    const [supportRecId, setSupportRecId] = useState('');
    const [ticketStatusForm, setTicketStatusForm] = useState<{ recId: string; status: string; comment: string } | null>(null);

    // Avant ce correctif, ces indicateurs se déduisaient d'une liste de rôles codée en dur
    // (staffRole), ignorant entièrement le catalogue RBAC réel et les permissions
    // personnalisées qu'un SUPER_ADMIN peut accorder à un employé (StaffAccessRights.tsx) —
    // exactement la même classe de dérive déjà corrigée ailleurs cette session. Chaque
    // indicateur correspond maintenant à LA permission que le backend vérifie réellement
    // pour l'action ou la donnée concernée (voir admin.ts) — jamais un rôle deviné, et
    // parfois une permission bien plus large que ce que "isSensitive"/"isRisk" laissaient
    // supposer (ex: la demande de relèvement de plafond et de remboursement n'exigent que
    // perm_customer_360_basic, déjà accordée à la plupart des rôles opérationnels — ces
    // formulaires étaient invisibles à tort pour TELLER/BRANCH_MANAGER).
    const canViewWallet = hasPerm(['perm_customer_wallet_view']);
    const canViewAnySensitiveData = hasPerm(['perm_customer_wallet_view', 'perm_customer_kyc_view', 'perm_customer_flag']);
    const canViewKyc = hasPerm(['perm_customer_kyc_view']);
    const canValidateKyc = hasPerm(['perm_customer_kyc_validate']);
    const canRequestLimitIncrease = hasPerm(['perm_customer_360_basic']);
    const canRequestRefund = hasPerm(['perm_customer_360_basic']);
    const canFlagCustomer = hasPerm(['perm_customer_flag']);
    const canManageAccountStatus = hasPerm(['perm_customer_freeze']);
    // POST /users/:id/reclamation (admin.ts) vérifie un rôle codé en dur côté serveur
    // (hasSupportAccess), pas une permission RBAC — TELLER en est exclu. Le bouton restait
    // affiché sans condition à quiconque atteint cet onglet (perm_customer_360_basic suffit
    // pour ça), donc un TELLER le voyait, remplissait le formulaire, et se heurtait à un
    // refus serveur silencieux à la soumission.
    const canCreateTicketAsStaff = ['SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER', 'SUPPORT_MAKER', 'BRANCH_MANAGER'].includes(staffRole || '');

    const api = async (path: string, method = 'GET', body?: any) => {
        const resp = await fetch(`${API_URL}/api/admin${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: body ? JSON.stringify(body) : undefined
        });
        return resp;
    };

    const fetchMain = async () => {
        setLoading(true);
        try {
            const r = await api(`/users/${userId}/360`);
            const d = await r.json();
            if (r.ok) setData(d); else { alert(d.error); onBack(); }
        } catch (e: any) {
            alert('Erreur réseau : impossible de charger la fiche client. Réessayez.');
            onBack();
        } finally { setLoading(false); }
    };

    useEffect(() => { fetchMain(); }, [userId]);

    useEffect(() => {
        if (activeTab === 'transactions' && !txData) loadTx();
        if (activeTab === 'cash-ops' && !cashData) loadCash();
        if (activeTab === 'security' && !secData) loadSec();
        if (activeTab === 'limits' && !limitsData) loadLimits();
        if ((activeTab === 'complaints' || activeTab === 'support') && recData.length === 0) loadRec();
        if (activeTab === 'audit' && !auditData) loadAudit();
    }, [activeTab]);

    const loadTx = async (page = txFilter.page) => { const r = await api(`/users/${userId}/transactions?type=${txFilter.type}&status=${txFilter.status}&page=${page}`); if (r.ok) setTxData(await r.json()); };
    const loadCash = async () => { const r = await api(`/users/${userId}/cash-ops`); if (r.ok) setCashData(await r.json()); };
    const loadSec = async () => { const r = await api(`/users/${userId}/security`); if (r.ok) setSecData(await r.json()); };
    const loadLimits = async () => { const r = await api(`/users/${userId}/limits-view`); if (r.ok) setLimitsData(await r.json()); };
    const loadRec = async () => { const r = await api(`/users/${userId}/reclamations`); if (r.ok) setRecData(await r.json()); };
    const loadAudit = async () => { const r = await api(`/users/${userId}/audit`); if (r.ok) setAuditData(await r.json()); };

    const doAction = async (path: string, body: any, successMsg: string, method = 'POST') => {
        setActionLoading(true);
        try {
            const r = await api(path, method, body);
            const d = await r.json();
            if (r.ok) { alert(successMsg); fetchMain(); setActionReason(''); setSecData(null); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : l\'action n\'a pas pu être effectuée. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doFreeze = async () => {
        if (!freezeReason) return alert('Motif de gel obligatoire.');
        if (freezeReason === 'OTHER' && freezeComment.trim().length < 10) return alert('Commentaire requis (min 10 caractères) pour motif OTHER.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/freeze`, 'POST', { freezeReason, comment: freezeComment });
            const d = await r.json();
            if (r.ok) { alert(`✅ Compte gelé — Motif: ${freezeReason}`); fetchMain(); setFreezeComment(''); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le gel n\'a pas pu être effectué. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doUnfreeze = async () => {
        if (unfreezeJustification.trim().length < 10) return alert('Justification du dégel obligatoire (min 10 caractères).');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/unfreeze`, 'POST', { justification: unfreezeJustification });
            const d = await r.json();
            if (r.ok) { alert('✅ Compte dégelé et réactivé.'); fetchMain(); setUnfreezeJustification(''); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le dégel n\'a pas pu être effectué. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doRefundRequest = async () => {
        if (!refundModal?.id || !refundAmount || !refundReason) return alert('Tous les champs sont requis.');
        if (parseFloat(refundAmount) <= 0) return alert('Montant invalide.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/refund-request`, 'POST', {
                transactionId: refundModal.id,
                amount: parseFloat(refundAmount),
                reason: refundReason
            });
            const d = await r.json();
            if (r.ok) { alert('✅ Demande de remboursement soumise au Checker.'); setRefundModal(null); setRefundAmount(''); setRefundReason(''); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : la demande n\'a pas pu être soumise. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doSupportNote = async () => {
        if (supportNote.trim().length < 3) return alert('Note trop courte.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/support-note`, 'POST', { content: supportNote, reclamationId: supportRecId || undefined });
            const d = await r.json();
            if (r.ok) { alert('✅ Note interne enregistrée.'); setSupportNote(''); setSupportRecId(''); setRecData([]); loadRec(); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : la note n\'a pas pu être enregistrée. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doTicketStatus = async () => {
        if (!ticketStatusForm) return;
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/reclamation/${ticketStatusForm.recId}/status`, 'PATCH', {
                status: ticketStatusForm.status,
                comment: ticketStatusForm.comment
            });
            const d = await r.json();
            if (r.ok) { alert(`✅ Ticket mis à jour: ${ticketStatusForm.status}`); setTicketStatusForm(null); setRecData([]); loadRec(); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le statut n\'a pas pu être mis à jour. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doKyc = async (status: 'APPROVED' | 'REJECTED') => {
        if (status === 'REJECTED' && !kycRejectReason) return alert('Motif de rejet requis.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/kyc`, 'PUT', { status, reason: kycRejectReason });
            const d = await r.json();
            if (r.ok) { alert('KYC mis à jour.'); fetchMain(); setKycRejectReason(''); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le dossier KYC n\'a pas pu être mis à jour. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doFlag = async () => {
        if (!flagDesc) return alert('Description requise.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/flag`, 'POST', { type: flagType, description: flagDesc });
            const d = await r.json();
            if (r.ok) { alert('Flag créé.'); fetchMain(); setFlagDesc(''); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le flag n\'a pas pu être créé. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doLimitRequest = async () => {
        if (!limitForm.requestedValue || !limitForm.reason) return alert('Montant et raison requis.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/limit-request`, 'POST', {
                limitType: limitForm.limitType,
                requestedValue: Number(limitForm.requestedValue),
                reason: limitForm.reason,
                expiresAt: limitForm.expiresAt || undefined
            });
            const d = await r.json();
            if (r.ok) { alert('Demande soumise au Checker.'); setLimitForm({ limitType: 'customDailyLimit', requestedValue: '', reason: '', expiresAt: '' }); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : la demande n\'a pas pu être soumise. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const VIP_LIMIT_TYPE_LABELS: Record<string, string> = {
        customDailyLimit: 'journalier', customMonthlyLimit: 'mensuel', customPerTxLimit: 'par transaction'
    };

    const doVipLimit = async () => {
        const limit = Number(vipLimit);
        if (!limit || limit < 100) return alert('Plafond invalide.');
        if (!window.confirm(`Appliquer immédiatement un plafond ${VIP_LIMIT_TYPE_LABELS[vipLimitType]} de ${limit.toLocaleString('fr-FR')} FCFA ? Cette action est exécutée directement, sans validation Checker.`)) return;
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/vip-limit`, 'PUT', { limit, limitType: vipLimitType, expiresAt: vipExpiresAt || undefined });
            const d = await r.json();
            if (r.ok) { alert('Plafond VIP appliqué.'); setVipLimit(''); setVipExpiresAt(''); loadLimits(); fetchMain(); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le plafond n\'a pas pu être appliqué. Réessayez.');
        } finally { setActionLoading(false); }
    };

    const doCreateTicket = async () => {
        if (!ticketForm.title || !ticketForm.description) return alert('Titre et description requis.');
        setActionLoading(true);
        try {
            const r = await api(`/users/${userId}/reclamation`, 'POST', ticketForm);
            const d = await r.json();
            if (r.ok) { alert('Ticket créé.'); setShowTicketModal(false); setRecData([]); loadRec(); }
            else alert('Erreur: ' + d.error);
        } catch (e: any) {
            alert('Erreur réseau : le ticket n\'a pas pu être créé. Réessayez.');
        } finally { setActionLoading(false); }
    };

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
            <div style={{ textAlign: 'center' }}>
                <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent)' }} />
                <p style={{ marginTop: 16, color: 'var(--text-muted)' }}>Chargement Customer 360…</p>
            </div>
        </div>
    );
    if (!data) return null;

    const { user, recentTx, auditLogs, openRiskFlagsCount, reclamationsCount } = data;

    const card = (children: any, extra?: any) => (
        <div className="card" style={{ padding: 28, ...extra }}>{children}</div>
    );

    const sectionTitle = (label: string) => (
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>{label}</h3>
    );

    const inputStyle: any = { width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', marginTop: 4 };
    const btnStyle = (color = 'var(--accent)') => ({ padding: '10px 20px', background: color, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: actionLoading ? 0.6 : 1 });
    const labelStyle: any = { fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginTop: 8, display: 'block' };

    // ── HEADER ────────────────────────────────────────────────
    const Header = () => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
            <button onClick={onBack} style={{ ...btnStyle('transparent'), color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '8px 14px' }}>
                <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Retour
            </button>
            <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 20 }}>
                        {user?.name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{user?.name}</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.phone}</span>
                            <StatusBadge status={user?.accountStatus || 'ACTIVE'} />
                            <StatusBadge status={user?.kycStatus || 'UNVERIFIED'} />
                        </div>
                    </div>
                </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-muted)' }}>
                <div>ID: <code style={{ fontSize: 11 }}>{user?.id?.substring(0, 12)}…</code></div>
                <div>Inscrit le {fmtDate(user?.createdAt)}</div>
            </div>
        </div>
    );

    // ── TAB NAV ───────────────────────────────────────────────
    const TabNav = () => (
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: 24, flexWrap: 'wrap' }}>
            {TABS.map(t => {
                const Icon = t.icon;
                return (
                    <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                        padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
                        borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                        color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
                        fontWeight: activeTab === t.id ? 700 : 400,
                        fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginBottom: -2, transition: 'all 0.2s'
                    }}>
                        <Icon size={14} />{t.label}
                    </button>
                );
            })}
        </div>
    );

    // ── OVERVIEW ──────────────────────────────────────────────
    const Overview = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                {[
                    { label: 'Statut Compte', value: <StatusBadge status={user?.accountStatus} /> },
                    { label: 'KYC Level', value: `Tier ${user?.kycLevel} — ${user?.kycStatus}` },
                    { label: 'Rôle', value: user?.role },
                    { label: 'Solde', value: canViewWallet ? fmt(user?.wallet?.balance || 0) : '••••• FCFA' },
                    { label: 'RiskFlags actifs', value: openRiskFlagsCount ?? 0 },
                    { label: 'Réclamations', value: reclamationsCount ?? 0 },
                ].map(({ label, value }) => (
                    <div key={label} className="stat-card" style={{ padding: 20 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 8 }}>{label}</div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
                    </div>
                ))}
            </div>
            {card(<>
                {sectionTitle('Dernières Transactions')}
                {recentTx?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucune transaction.</p> : (
                    <table style={{ width: '100%' }}>
                        <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Frais</th><th>Statut</th></tr></thead>
                        <tbody>{recentTx?.slice(0, 5).map((t: any) => (
                            <tr key={t.id}>
                                <td>{fmtDate(t.createdAt)}</td>
                                <td>{t.type}</td>
                                <td style={{ fontWeight: 700 }}>{fmt(t.amount)}</td>
                                <td>{fmt(t.fee)}</td>
                                <td><StatusBadge status={t.status} /></td>
                            </tr>
                        ))}</tbody>
                    </table>
                )}
            </>)}
            {card(<>
                {sectionTitle('Derniers Événements Admins')}
                {auditLogs?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucun log.</p> : auditLogs?.slice(0, 5).map((l: any) => (
                    <div key={l.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{l.action}</span>
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{fmtDate(l.createdAt)} — par {l.admin?.name}</span>
                    </div>
                ))}
            </>)}
        </div>
    );

    // ── IDENTITY ──────────────────────────────────────────────
    const Identity = () => card(
        <>
            {sectionTitle('Identité du Client')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {[
                    ['Compte (MONG-ID RIB)', user?.accountNumber ? user.accountNumber.replace(/(.{5})(.{5})(.{11})(.{2})/, '$1 $2 $3 $4') : 'Non généré'],
                    ['ID Technique', user?.id?.substring(0, 8)],
                    ['Nom complet', user?.name],
                    ['Téléphone', user?.phone],
                    ['Pseudo', user?.username || '—'],
                    ['Email', canViewAnySensitiveData ? (user?.email || '—') : '•••@•••'],
                    ['Rôle', user?.role],
                    ['Statut', user?.accountStatus],
                    ['Date inscription', fmtDate(user?.createdAt)],
                    ['Dernière MàJ', fmtDate(user?.updatedAt)],
                    ['Motif gel', user?.freezeReason || '—'],
                ].map(([label, val]) => (
                    <div key={label as string}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
                        <div style={{ fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>{val}</div>
                    </div>
                ))}
            </div>
        </>
    );

    // ── KYC ───────────────────────────────────────────────────
    const Kyc = () => card(<>
        {sectionTitle('Dossier KYC')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {[
                ['Niveau KYC', `Tier ${user?.kycLevel}`],
                ['Statut KYC', user?.kycStatus],
            ].map(([l, v]) => <div key={l as string}><span style={labelStyle}>{l}</span><strong>{v}</strong></div>)}
        </div>
        {canViewKyc && user?.idCardFront && (
            <div style={{ marginBottom: 24 }}>
                {sectionTitle('Documents soumis')}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[['Recto CNI', user?.idCardFront], ['Verso CNI', user?.idCardBack], ['Selfie', user?.selfie]].map(([label, url]) => url ? (
                        <div key={label as string} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
                            <img
                                src={url as string} alt={`${label} — ${user?.name}`}
                                onClick={() => setLightbox({ src: url as string, alt: `${label} — ${user?.name}` })}
                                style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)', maxHeight: 150, objectFit: 'cover', cursor: 'zoom-in' }}
                            />
                        </div>
                    ) : null)}
                </div>
            </div>
        )}
        {canValidateKyc && user?.kycStatus === 'PENDING' && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                {sectionTitle('Décision KYC')}
                <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Motif de rejet (si applicable)</label>
                    <input style={inputStyle} placeholder="Ex: Document illisible" value={kycRejectReason} onChange={e => setKycRejectReason(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <button style={btnStyle('var(--success)')} onClick={() => doKyc('APPROVED')} disabled={actionLoading}><CheckCircle size={14} style={{ marginRight: 6 }} />Approuver</button>
                    <button style={btnStyle('var(--danger)')} onClick={() => doKyc('REJECTED')} disabled={actionLoading}><XCircle size={14} style={{ marginRight: 6 }} />Rejeter</button>
                </div>
            </div>
        )}
    </>);

    // ── WALLET ────────────────────────────────────────────────
    const WalletTab = () => card(<>
        {sectionTitle('Portefeuille (Read-only)')}
        {!canViewWallet ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                <Lock size={32} style={{ marginBottom: 12 }} />
                <p>Accès aux données financières restreint à votre rôle.</p>
            </div>
        ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                {[
                    ['Wallet ID', user?.wallet?.id],
                    ['Devise', user?.wallet?.currency],
                    ['Solde', fmt(user?.wallet?.balance)],
                    ['Dépensé aujourd\'hui', fmt(user?.wallet?.dailySpent)],
                    ['Dépensé ce mois', fmt(user?.wallet?.monthlySpent)],
                ].map(([l, v]) => (
                    <div key={l as string} style={{ background: 'var(--bg-secondary)', padding: 16, borderRadius: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{l}</div>
                        <div style={{ fontWeight: 700, fontSize: 18, marginTop: 6 }}>{v}</div>
                    </div>
                ))}
            </div>
        )}
        <div style={{ marginTop: 20, padding: 12, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, fontSize: 13, color: 'var(--danger)' }}>
            🔒 Règle absolue: Le solde ne peut JAMAIS être modifié directement depuis cet écran.
        </div>
    </>);

    // ── LIMITS ────────────────────────────────────────────────
    const LimitsTab = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {card(<>
                {sectionTitle('Moteur de Limites Effectives')}
                {!limitsData ? <p style={{ color: 'var(--text-muted)' }}>Chargement…</p> : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                        {[
                            { label: 'Limit Globale (COBAC)', val: fmt(limitsData.globalLimit), color: 'var(--accent)' },
                            { label: `KYC Journalier (${limitsData.tierName})`, val: fmt(limitsData.kycLimitDaily), color: '#0284c7' },
                            { label: 'KYC Mensuel', val: fmt(limitsData.kycLimitMonthly), color: '#0284c7' },
                            { label: 'KYC / Transaction', val: fmt(limitsData.kycLimitPerTx), color: '#0284c7' },
                            { label: 'Custom Override Journalier', val: limitsData.customDailyLimit ? fmt(limitsData.customDailyLimit) : '—', color: limitsData.isCustomActive ? 'var(--warning)' : '#6b7280' },
                            { label: 'Expiration Custom', val: limitsData.customLimitExpiresAt ? fmtDate(limitsData.customLimitExpiresAt) : '—', color: '#6b7280' },
                        ].map(({ label, val, color }) => (
                            <div key={label} style={{ padding: 16, borderLeft: `3px solid ${color}`, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</div>
                                <div style={{ fontWeight: 700, fontSize: 16, marginTop: 6 }}>{val}</div>
                            </div>
                        ))}
                    </div>
                )}
                {limitsData && (
                    <div style={{ marginTop: 20, padding: 16, background: 'rgba(99,102,241,0.1)', borderRadius: 8, display: 'flex', gap: 24 }}>
                        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>✅ EFFECTIVE / Jour</div><strong style={{ fontSize: 18, color: 'var(--accent)' }}>{fmt(limitsData.effectiveDaily)}</strong></div>
                        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>✅ EFFECTIVE / Mois</div><strong style={{ fontSize: 18, color: 'var(--accent)' }}>{fmt(limitsData.effectiveMonthly)}</strong></div>
                        <div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>✅ EFFECTIVE / Transaction</div><strong style={{ fontSize: 18, color: 'var(--accent)' }}>{fmt(limitsData.effectivePerTx)}</strong></div>
                    </div>
                )}
            </>)}
            {canRequestLimitIncrease && card(<>
                {sectionTitle('Demande de Modification (Maker/Checker)')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                        <label style={labelStyle}>Type de limite</label>
                        <select style={inputStyle} value={limitForm.limitType} onChange={e => setLimitForm(f => ({ ...f, limitType: e.target.value }))}>
                            <option value="customDailyLimit">Journalière</option>
                            <option value="customMonthlyLimit">Mensuelle</option>
                            <option value="customPerTxLimit">Par transaction</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Nouveau plafond (FCFA)</label>
                        <input type="number" style={inputStyle} placeholder="Ex: 500000" value={limitForm.requestedValue} onChange={e => setLimitForm(f => ({ ...f, requestedValue: e.target.value }))} />
                    </div>
                    <div>
                        <label style={labelStyle}>Date expiration (optionnel)</label>
                        <input type="date" style={inputStyle} value={limitForm.expiresAt} onChange={e => setLimitForm(f => ({ ...f, expiresAt: e.target.value }))} />
                    </div>
                    <div>
                        <label style={labelStyle}>Motif</label>
                        <input style={inputStyle} placeholder="Justification obligatoire" value={limitForm.reason} onChange={e => setLimitForm(f => ({ ...f, reason: e.target.value }))} />
                    </div>
                </div>
                <button style={{ ...btnStyle(), marginTop: 16 }} onClick={doLimitRequest} disabled={actionLoading}>Soumettre au Checker</button>
            </>)}
            {staffRole === 'SUPER_ADMIN' && card(<>
                {sectionTitle('Plafond VIP (Application immédiate, SUPER_ADMIN uniquement)')}
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: -8, marginBottom: 12 }}>
                    Contrairement à la demande ci-dessus, cette action s'applique instantanément, sans passer par un Checker — réservée aux cas exceptionnels (client VIP, dérogation directe).
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'flex-end' }}>
                    <div>
                        <label style={labelStyle}>Type de limite</label>
                        <select style={inputStyle} value={vipLimitType} onChange={e => setVipLimitType(e.target.value)}>
                            <option value="customDailyLimit">Journalière</option>
                            <option value="customMonthlyLimit">Mensuelle</option>
                            <option value="customPerTxLimit">Par transaction</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Nouveau plafond (FCFA)</label>
                        <input type="number" style={inputStyle} placeholder="Ex: 10000000" value={vipLimit} onChange={e => setVipLimit(e.target.value)} />
                    </div>
                    <div>
                        <label style={labelStyle}>Expiration (optionnel)</label>
                        <input type="date" style={inputStyle} value={vipExpiresAt} onChange={e => setVipExpiresAt(e.target.value)} />
                    </div>
                    <button style={btnStyle()} onClick={doVipLimit} disabled={actionLoading}>Appliquer</button>
                </div>
            </>)}
        </div>
    );

    // ── TRANSACTIONS ──────────────────────────────────────────
    const Transactions = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
                <select style={{ ...inputStyle, width: 160 }} value={txFilter.type} onChange={e => setTxFilter(f => ({ ...f, type: e.target.value }))}>
                    <option value="">Tous types</option>
                    <option value="TRANSFER">P2P</option>
                    <option value="CASH_IN">Cash-In</option>
                    <option value="CASH_OUT">Cash-Out</option>
                    <option value="REFUND">Remboursement</option>
                </select>
                <select style={{ ...inputStyle, width: 160 }} value={txFilter.status} onChange={e => setTxFilter(f => ({ ...f, status: e.target.value }))}>
                    <option value="">Tous statuts</option>
                    <option value="COMPLETED">Complétée</option>
                    <option value="PENDING">En attente</option>
                    <option value="FAILED">Échouée</option>
                </select>
                <button style={btnStyle()} onClick={() => { setTxData(null); loadTx(); }}>Filtrer</button>
            </div>
            {card(<>
                {!txData ? <p>Chargement…</p> : txData.txs?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucune transaction.</p> : (
                    <table style={{ width: '100%' }}>
                        <thead><tr><th>Date</th><th>Réf.</th><th>Type</th><th>Montant</th><th>Frais</th><th>Contrepartie</th><th>Statut</th>{canRequestRefund && <th>Rembours.</th>}</tr></thead>
                        <tbody>{txData.txs.map((t: any) => {
                            const isOut = t.senderWallet?.user?.id === userId;
                            const counterpart = isOut ? t.receiverWallet?.user : t.senderWallet?.user;
                            return (
                                <tr key={t.id}>
                                    <td style={{ fontSize: 12 }}>{fmtDate(t.createdAt)}</td>
                                    <td style={{ fontSize: 11, fontFamily: 'monospace' }}>{t.reference?.substring(0, 16)}…</td>
                                    <td>{t.type}</td>
                                    <td style={{ fontWeight: 700, color: isOut ? 'var(--danger)' : 'var(--success)' }}>{isOut ? '-' : '+'}{fmt(t.amount)}</td>
                                    <td style={{ color: 'var(--text-muted)' }}>{fmt(t.fee)}</td>
                                    <td style={{ fontSize: 12 }}>{counterpart?.name || '—'}<br /><small style={{ color: 'var(--text-muted)' }}>{counterpart?.phone}</small></td>
                                    <td><StatusBadge status={t.status} /></td>
                                    {canRequestRefund && <td>
                                        {t.status === 'COMPLETED' && (
                                            <button onClick={() => { setRefundModal(t); setRefundAmount(String(t.amount)); setRefundReason(''); }}
                                                style={{ padding: '4px 10px', fontSize: 11, background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid var(--accent)40', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                                                Rembourser
                                            </button>
                                        )}
                                    </td>}
                                </tr>
                            );
                        })}</tbody>
                    </table>
                )}
                {/* "Page X/Y" était un texte pur, sans aucun moyen de changer de page : les
                pages 2+ étaient invisibles dès qu'un client avait plus d'une page de transactions. */}
                {txData && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                        <span>{txData.total} transaction(s) — Page {txData.page}/{txData.pages}</span>
                        <button disabled={txFilter.page <= 1} onClick={() => { const p = txFilter.page - 1; setTxFilter(f => ({ ...f, page: p })); loadTx(p); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: txFilter.page <= 1 ? 'default' : 'pointer' }}>◀</button>
                        <button disabled={txFilter.page >= txData.pages} onClick={() => { const p = txFilter.page + 1; setTxFilter(f => ({ ...f, page: p })); loadTx(p); }} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'none', cursor: txFilter.page >= txData.pages ? 'default' : 'pointer' }}>▶</button>
                    </div>
                )}
            </>)}

            {/* Refund Request Modal */}
            {refundModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ padding: 28, minWidth: 460, maxWidth: 560 }}>
                        {sectionTitle('Demande de Remboursement (Maker)')}
                        <div style={{ padding: 12, background: 'rgba(99,102,241,0.08)', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                            <div>Transaction: <code style={{ fontSize: 11 }}>{refundModal.id}</code></div>
                            <div>Montant original: <strong>{fmt(refundModal.amount)}</strong></div>
                            <div>Type: {refundModal.type} — <StatusBadge status={refundModal.status} /></div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <label style={labelStyle}>Montant à rembourser (FCFA)</label>
                                <input type="number" style={inputStyle} max={refundModal.amount} min={1}
                                    value={refundAmount} onChange={e => setRefundAmount(e.target.value)} />
                                <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Max autorisé: {fmt(refundModal.amount)}</small>
                            </div>
                            <div>
                                <label style={labelStyle}>Motif du remboursement</label>
                                <textarea style={{ ...inputStyle, minHeight: 70 }} placeholder="Expliquer la raison du remboursement…" value={refundReason} onChange={e => setRefundReason(e.target.value)} />
                            </div>
                            <div style={{ padding: 10, background: 'rgba(239,68,68,0.06)', borderRadius: 6, fontSize: 12, color: 'var(--danger)' }}>
                                🔒 La transaction originale ne sera<strong> JAMAIS modifiée</strong>. Un nouveau flux comptable sera créé à l’approbation du Checker.
                            </div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button style={btnStyle()} onClick={doRefundRequest} disabled={actionLoading || !refundReason || !refundAmount}>Soumettre au Checker</button>
                                <button style={btnStyle('#6b7280')} onClick={() => setRefundModal(null)}>Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ── CASH OPS ──────────────────────────────────────────────
    const CashOps = () => {
        const af = cashData?.antiFractioning;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {af && (
                    <div style={{ padding: 20, background: af.flagged ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.06)', border: `1px solid ${af.flagged ? 'var(--danger)' : 'var(--success)'}30`, borderRadius: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 16, color: af.flagged ? 'var(--danger)' : 'var(--success)' }}>
                            {af.flagged ? '⚠️ ALERTE ANTI-FRACTIONNEMENT' : '✅ Activité Normale'}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                            {[
                                ['Retraits 24h', fmt(af.totalOut24h)],
                                ['Retraits 7j', fmt(af.totalOut7d)],
                                ['Opérations 24h', af.countLast24h],
                                ['Agences utilisées 24h', af.branchesUsed24h],
                                ['Montant moyen', fmt(af.avgPerOp24h)],
                                ['Frais payés 7j', fmt(af.feesPaid7d)],
                            ].map(([l, v]) => (
                                <div key={l as string} style={{ padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l}</div>
                                    <div style={{ fontWeight: 700, marginTop: 4 }}>{v}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {card(<>
                        <h4 style={{ margin: '0 0 16px', color: 'var(--success)' }}>⬆️ Cash-In reçus ({cashData?.cashIns?.length || 0})</h4>
                        {cashData?.cashIns?.map((t: any) => (
                            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span style={{ fontWeight: 700, color: 'var(--success)' }}>+{fmt(t.amount)}</span>
                                <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>{fmtDate(t.createdAt)}</span>
                                {t.branchId && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agence: {t.branchId?.substring(0, 8)}…</div>}
                            </div>
                        ))}
                    </>)}
                    {card(<>
                        <h4 style={{ margin: '0 0 16px', color: 'var(--danger)' }}>⬇️ Cash-Out effectués ({cashData?.cashOuts?.length || 0})</h4>
                        {cashData?.cashOuts?.map((t: any) => (
                            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span style={{ fontWeight: 700, color: 'var(--danger)' }}>-{fmt(t.amount)}</span>
                                <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>{fmtDate(t.createdAt)}</span>
                                {t.branchId && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Agence: {t.branchId?.substring(0, 8)}…</div>}
                            </div>
                        ))}
                    </>)}
                </div>
            </div>
        );
    };

    // ── SECURITY ──────────────────────────────────────────────
    const SecurityTab = () => card(<>
        {sectionTitle('Sécurité du Compte')}
        {!secData ? <p>Chargement…</p> : (
            <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
                    {[
                        ['Tentatives PIN échouées', secData.failedPinAttempts],
                        ['Compte verrouillé', secData.isLocked ? '🔴 OUI' : '🟢 Non'],
                        ['Verrouillé jusqu\'au', secData.lockedUntil ? fmtDate(secData.lockedUntil) : '—'],
                        ['Statut', secData.accountStatus],
                        ['Sessions actives (version JWT)', secData.jwtVersion],
                        ['Motif blocage', secData.freezeReason || '—'],
                    ].map(([l, v]) => (
                        <div key={l as string} style={{ padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l}</div>
                            <div style={{ fontWeight: 700, marginTop: 6 }}>{v}</div>
                        </div>
                    ))}
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {sectionTitle('Actions de Sécurité')}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                        <div>
                            <label style={labelStyle}>Motif (obligatoire pour toute action)</label>
                            <input style={inputStyle} placeholder="Raison de l'action…" value={actionReason} onChange={e => setActionReason(e.target.value)} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <button style={btnStyle('var(--warning)')} onClick={() => doAction(`/users/${userId}/unlock-account`, { reason: actionReason }, 'Compte déverrouillé.')} disabled={actionLoading || actionReason.trim().length < 3}>
                            <Unlock size={14} style={{ marginRight: 6 }} />Déverrouiller PIN
                        </button>
                        {canManageAccountStatus && <button style={btnStyle('var(--danger)')} onClick={() => doAction(`/users/${userId}/revoke-sessions`, { reason: actionReason }, 'Sessions révoquées.')} disabled={actionLoading || actionReason.trim().length < 3}>
                            <Smartphone size={14} style={{ marginRight: 6 }} />Révoquer toutes les sessions
                        </button>}
                        {canManageAccountStatus && <button style={btnStyle('var(--accent)')} onClick={() => doAction(`/users/${userId}/reset-pin`, { reason: actionReason }, 'PIN réinitialisé. Client doit recréer son PIN.')} disabled={actionLoading || actionReason.trim().length < 5}>
                            <Lock size={14} style={{ marginRight: 6 }} />Déclencher Reset PIN
                        </button>}
                    </div>
                </div>

                {secData.securityLogs?.length > 0 && (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                        {sectionTitle('Historique Sécurité')}
                        {secData.securityLogs.map((l: any, i: number) => (
                            <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{l.action}</span>
                                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{fmtDate(l.createdAt)} — {l.admin?.name} ({l.admin?.role})</span>
                            </div>
                        ))}
                    </div>
                )}
            </>
        )}
    </>);

    // ── RISK ──────────────────────────────────────────────────
    const Risk = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {card(<>
                {sectionTitle('Flags de Risque')}
                {user?.riskFlags?.length === 0 ? <p style={{ color: 'var(--success)' }}>✅ Aucun flag actif.</p> : user?.riskFlags?.map((f: any) => (
                    <div key={f.id} style={{ padding: 16, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700, color: 'var(--danger)' }}>{f.type}</span>
                            <StatusBadge status={f.status} />
                        </div>
                        <div style={{ fontSize: 13, marginTop: 8 }}>{f.description}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{fmtDate(f.createdAt)} — {f.author?.name}</div>
                    </div>
                ))}
            </>)}
            {canFlagCustomer && card(<>
                {sectionTitle('Créer un Flag')}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                        <label style={labelStyle}>Type de flag</label>
                        <select style={inputStyle} value={flagType} onChange={e => setFlagType(e.target.value)}>
                            <option value="SUSPICIOUS_ACTIVITY">Activité suspecte</option>
                            <option value="AML_ALERT">Alerte AML</option>
                            <option value="FRAUD_REPORT">Fraude signalée</option>
                            <option value="IDENTITY_THEFT">Usurpation identité</option>
                            <option value="ANTI_FRACTIONING">Fractionnement</option>
                            <option value="OTHER">Autre</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Description</label>
                        <input style={inputStyle} placeholder="Détails observés…" value={flagDesc} onChange={e => setFlagDesc(e.target.value)} />
                    </div>
                </div>
                <button style={{ ...btnStyle('var(--warning)'), marginTop: 12 }} onClick={doFlag} disabled={actionLoading}><ShieldAlert size={14} style={{ marginRight: 6 }} />Créer le Flag</button>
            </>)}
            {canManageAccountStatus && card(<>
                {sectionTitle('Gestion du Statut du Compte')}

                {/* Current status banner */}
                <div style={{
                    padding: 16, borderRadius: 8, marginBottom: 20,
                    background:
                        user?.accountStatus === 'FROZEN' ? 'rgba(239,68,68,0.08)' :
                            user?.accountStatus === 'SUSPENDED' ? 'rgba(245,158,11,0.08)' :
                                'rgba(16,185,129,0.06)',
                    border: `1px solid ${user?.accountStatus === 'FROZEN' ? 'var(--danger-bg)' :
                        user?.accountStatus === 'SUSPENDED' ? 'var(--warning-bg)' : 'var(--success-bg)'}`
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <StatusBadge status={user?.accountStatus} />
                        {user?.freezeReason && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Motif: <strong>{user.freezeReason}</strong></span>}
                    </div>
                </div>

                {/* FREEZE section — only if not already FROZEN */}
                {user?.accountStatus !== 'FROZEN' && user?.accountStatus !== 'CLOSED' && (<>
                    <div style={{ marginBottom: 20, padding: 16, border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Snowflake size={16} />Geler le compte (FROZEN)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div>
                                <label style={labelStyle}>Motif structuré</label>
                                <select style={inputStyle} value={freezeReason} onChange={e => setFreezeReason(e.target.value)}>
                                    <option value="SUSPECTED_FRAUD">Fraude suspectée</option>
                                    <option value="AML_REVIEW">Revue AML</option>
                                    <option value="SECURITY_ISSUE">Problème de sécurité</option>
                                    <option value="LEGAL_REQUEST">Requête légale / Judiciaire</option>
                                    <option value="CUSTOMER_REQUEST">Demande du client</option>
                                    <option value="ACCOUNT_COMPROMISE">Compte compromis</option>
                                    <option value="OTHER">Autre (commentaire requis)</option>
                                </select>
                            </div>
                            {freezeReason === 'OTHER' && <div>
                                <label style={labelStyle}>Commentaire (min 10 caractères)</label>
                                <input style={inputStyle} placeholder="Préciser la raison…" value={freezeComment} onChange={e => setFreezeComment(e.target.value)} />
                            </div>}
                        </div>
                        <button style={{ ...btnStyle('var(--danger)'), marginTop: 12 }} onClick={doFreeze} disabled={actionLoading}>
                            <Snowflake size={14} style={{ marginRight: 6 }} />Geler le compte
                        </button>
                    </div>

                    {/* SUSPEND section */}
                    {user?.accountStatus !== 'SUSPENDED' && <div style={{ marginBottom: 20, padding: 16, border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Ban size={16} />Suspendre le compte (SUSPENDED)
                        </div>
                        <label style={labelStyle}>Motif (min 5 caractères)</label>
                        <input style={inputStyle} placeholder="Raison de la suspension…" value={actionReason} onChange={e => setActionReason(e.target.value)} />
                        <button style={{ ...btnStyle('var(--warning)'), marginTop: 12 }} onClick={() => doAction(`/users/${userId}/block`, { reason: actionReason }, 'Compte suspendu.')} disabled={actionLoading || actionReason.trim().length < 5}>
                            <Ban size={14} style={{ marginRight: 6 }} />Suspendre
                        </button>
                    </div>}

                    {user?.accountStatus === 'SUSPENDED' && <div style={{ padding: 16, border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8 }}>
                        <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <CheckCircle size={16} />Réactiver le compte (SUSPENDED → ACTIVE)
                        </div>
                        <label style={labelStyle}>Motif (min 5 caractères)</label>
                        <input style={inputStyle} placeholder="Raison du déblocage…" value={actionReason} onChange={e => setActionReason(e.target.value)} />
                        <button style={{ ...btnStyle('var(--success)'), marginTop: 12 }} onClick={() => doAction(`/users/${userId}/unblock`, { reason: actionReason }, 'Compte réactivé.')} disabled={actionLoading || actionReason.trim().length < 5}>
                            <CheckCircle size={14} style={{ marginRight: 6 }} />Réactiver
                        </button>
                    </div>}
                </>)}

                {/* UNFREEZE section — only if FROZEN */}
                {user?.accountStatus === 'FROZEN' && <div style={{ padding: 16, border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, background: 'rgba(16,185,129,0.04)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--success)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Unlock size={16} />Dégeler le compte (FROZEN → ACTIVE)
                    </div>
                    {user?.freezeReason && <div style={{ marginBottom: 12, padding: 10, background: 'rgba(239,68,68,0.06)', borderRadius: 6, fontSize: 13 }}>
                        <strong>Motif de gel initial:</strong> {user.freezeReason}
                    </div>}
                    <label style={labelStyle}>Justification du dégel (min 10 caractères)</label>
                    <textarea style={{ ...inputStyle, minHeight: 60 }} placeholder="Détailler la raison du dégel…" value={unfreezeJustification} onChange={e => setUnfreezeJustification(e.target.value)} />
                    <button style={{ ...btnStyle('var(--success)'), marginTop: 12 }} onClick={doUnfreeze} disabled={actionLoading || unfreezeJustification.trim().length < 10}>
                        <Unlock size={14} style={{ marginRight: 6 }} />Dégeler le compte
                    </button>
                </div>}
            </>)}
        </div>
    );

    // ── COMPLAINTS ────────────────────────────────────────────
    // Fusion des anciens onglets "Réclamations" (lecture) et "Support" (statut + note) —
    // les deux affichaient la même liste de tickets sous deux présentations séparées,
    // obligeant l'agent à changer d'onglet pour lire un ticket puis agir dessus.
    const Complaints = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Réclamations ({recData.length})</h3>
                {canCreateTicketAsStaff && <button style={btnStyle()} onClick={() => setShowTicketModal(true)}>+ Nouveau ticket</button>}
            </div>
            {recData.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucun ticket.</p> : recData.map((r: any) => (
                <div key={r.id} className="card" style={{ padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <strong>{r.title}</strong>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <StatusBadge status={r.priority} />
                            <StatusBadge status={r.status} />
                        </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{r.category} — {fmtDate(r.createdAt)}</div>
                    <div style={{ fontSize: 13, marginBottom: 12 }}>{r.description}</div>

                    {r.notes?.length > 0 && (
                        <div style={{ marginBottom: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                            {r.notes.map((n: any) => (
                                <div key={n.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                                    {!n.isInternal && <span style={{ color: 'var(--success)', fontWeight: 700 }}>[CLIENT] </span>}
                                    {n.authorName}: {n.content}
                                    <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{fmtDate(n.createdAt)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const).map(s => (
                                <button key={s} onClick={() => setTicketStatusForm({ recId: r.id, status: s, comment: '' })}
                                    style={{ padding: '4px 12px', fontSize: 11, background: r.status === s ? 'var(--accent)' : 'var(--bg-secondary)', color: r.status === s ? '#fff' : 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 20, cursor: 'pointer', fontWeight: 700 }}>
                                    → {s}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input
                                style={{ ...inputStyle, flex: 1, marginTop: 0 }}
                                placeholder="Ajouter une note interne…"
                                value={supportRecId === r.id ? supportNote : ''}
                                onFocus={() => setSupportRecId(r.id)}
                                onChange={e => { setSupportRecId(r.id); setSupportNote(e.target.value); }}
                            />
                            <button style={btnStyle()} onClick={doSupportNote} disabled={actionLoading || supportRecId !== r.id || supportNote.trim().length < 3}>
                                <MessageSquare size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            {showTicketModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ padding: 28, minWidth: 480, maxWidth: 600 }}>
                        {sectionTitle('Créer un ticket de réclamation')}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div><label style={labelStyle}>Titre</label><input style={inputStyle} value={ticketForm.title} onChange={e => setTicketForm(f => ({ ...f, title: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Catégorie</label>
                                <select style={inputStyle} value={ticketForm.category} onChange={e => setTicketForm(f => ({ ...f, category: e.target.value }))}>
                                    {['ACCOUNT', 'KYC', 'TRANSACTION', 'CASH_IN', 'CASH_OUT', 'MERCHANT', 'AGENCY', 'FRAUD', 'REFUND', 'LIMIT', 'OTHER'].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div><label style={labelStyle}>Priorité</label>
                                <select style={inputStyle} value={ticketForm.priority} onChange={e => setTicketForm(f => ({ ...f, priority: e.target.value }))}>
                                    {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map(p => <option key={p} value={p}>{p}</option>)}
                                </select>
                            </div>
                            <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, minHeight: 80 }} value={ticketForm.description} onChange={e => setTicketForm(f => ({ ...f, description: e.target.value }))} /></div>
                            <div><label style={labelStyle}>Transaction concernée (optionnel)</label><input style={inputStyle} placeholder="ID transaction" value={ticketForm.transactionId} onChange={e => setTicketForm(f => ({ ...f, transactionId: e.target.value }))} /></div>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button style={btnStyle()} onClick={doCreateTicket} disabled={actionLoading}>Créer le ticket</button>
                                <button style={btnStyle('#6b7280')} onClick={() => setShowTicketModal(false)}>Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {ticketStatusForm && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ padding: 28, minWidth: 420 }}>
                        {sectionTitle(`Changer le statut → ${ticketStatusForm.status}`)}
                        <label style={labelStyle}>Commentaire (optionnel)</label>
                        <textarea style={{ ...inputStyle, minHeight: 60 }}
                            placeholder="Expliquer le changement de statut…"
                            value={ticketStatusForm.comment}
                            onChange={e => setTicketStatusForm(f => f ? { ...f, comment: e.target.value } : null)} />
                        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                            <button style={btnStyle()} onClick={doTicketStatus} disabled={actionLoading}>Confirmer</button>
                            <button style={btnStyle('#6b7280')} onClick={() => setTicketStatusForm(null)}>Annuler</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

    // ── ADMIN ACTIONS (timeline) ──────────────────────────────
    const AdminActions = () => card(<>
        {sectionTitle('Actions Administratives (Timeline)')}
        {auditLogs?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucune action administrative enregistrée.</p> : (
            <div style={{ position: 'relative', paddingLeft: 24 }}>
                <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
                {auditLogs.map((l: any) => (
                    <div key={l.id} style={{ position: 'relative', marginBottom: 20 }}>
                        <div style={{ position: 'absolute', left: -20, top: 4, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg-primary)' }} />
                        <div className="card" style={{ padding: 16, marginLeft: 8 }}>
                            <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>{l.action}</div>
                            <div style={{ fontSize: 13 }}>{l.details}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                                {fmtDate(l.createdAt)} — <strong>{l.admin?.name}</strong>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        )}
    </>);

    // ── AUDIT ─────────────────────────────────────────────────
    const Audit = () => card(<>
        {sectionTitle('Journal d\'Audit')}
        {!auditData ? <p>Chargement…</p> : auditData.logs?.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Aucun log d'audit.</p> : (
            <>
                <table style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Action</th>
                            <th>Acteur</th>
                            <th>Détails</th>
                        </tr>
                    </thead>
                    <tbody>
                        {auditData.logs.map((l: any) => (
                            <tr key={l.id}>
                                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(l.createdAt)}</td>
                                <td><span style={{ padding: '2px 8px', background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>{l.action}</span></td>
                                <td style={{ fontSize: 13 }}>{l.admin?.name}<br /><small style={{ color: 'var(--text-muted)' }}>{l.admin?.role}</small></td>
                                <td style={{ fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.details}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{auditData.total} entrée(s) — Page {auditData.page}/{auditData.pages}</div>
            </>
        )}
    </>);

    // Appelées comme de simples fonctions (Overview(), pas <Overview />) : ce sont des closures
    // sur l'état du composant parent, sans hooks à elles (vérifié), donc rien n'empêche de les
    // inliner directement. Les appeler en JSX (<Overview />) leur donnait une nouvelle identité
    // de type à CHAQUE rendu du parent (la fonction est redéfinie à chaque passage) : React
    // démontait/remontait tout le sous-arbre à chaque frappe dans un champ, faisant perdre le
    // focus après chaque caractère (plafond VIP, description de flag, note de support, motif de
    // remboursement...).
    const renderTab = () => {
        switch (activeTab) {
            case 'overview': return Overview();
            case 'identity': return Identity();
            case 'kyc': return Kyc();
            case 'wallet': return WalletTab();
            case 'limits': return LimitsTab();
            case 'transactions': return Transactions();
            case 'cash-ops': return CashOps();
            case 'security': return SecurityTab();
            case 'risk': return Risk();
            case 'complaints': return Complaints();
            case 'admin-actions': return AdminActions();
            case 'audit': return Audit();
            default: return null;
        }
    };

    return (
        <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 60 }}>
            {Header()}
            {TabNav()}
            {renderTab()}
            {lightbox && <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
        </div>
    );
}


