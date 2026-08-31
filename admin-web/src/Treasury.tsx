import { Activity, AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, Building2, CheckCircle2, History, RefreshCw, Server, Shield, StopCircle, Undo2, Wallet } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import ConfirmDialog from './components/ConfirmDialog';
import KpiCard from './components/KpiCard';
import PageHeader from './components/PageHeader';
import TabBar from './components/TabBar';
import { ToastHost, useToast } from './components/useToast';
import { API_URL } from './config';

const fmt = (n: number) => n?.toLocaleString('fr-GA') + ' FCFA';
const fmtDate = (d: string) => new Date(d).toLocaleString('fr-GA', { dateStyle: 'short', timeStyle: 'short' });

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
        PENDING: { bg: 'var(--warning-bg)', color: 'var(--warning)', label: 'En attente' },
        EXECUTED: { bg: 'var(--success-bg)', color: 'var(--success)', label: 'Exécuté' },
        REJECTED: { bg: 'var(--danger-bg)', color: 'var(--danger)', label: 'Rejeté' },
        CANCELLED: { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: 'Annulé' },
    };
    const s = map[status] || { bg: 'var(--bg-primary)', color: 'var(--text-secondary)', label: status };
    return <span style={{ padding: '4px 10px', borderRadius: 20, background: s.bg, color: s.color, fontSize: 11, fontWeight: 800 }}>{s.label}</span>;
}

export default function Treasury({ token, hasPerm, prefillAdjustTarget, staffId }: { token: string; hasPerm: (perms: string[]) => boolean; prefillAdjustTarget?: { walletId: string; name: string } | null; staffId?: string }) {
    type TreasuryTab = 'overview' | 'agencies' | 'reconciliation' | 'requests' | 'create';
    const [tab, setTab] = useState<TreasuryTab>('overview');
    const [loading, setLoading] = useState(true);
    const [overview, setOverview] = useState<any>(null);
    const [requests, setRequests] = useState<any[]>([]);
    const [agenciesLiquidity, setAgenciesLiquidity] = useState<any[]>([]);
    const [reconciliation, setReconciliation] = useState<any[]>([]);

    // Create Request State
    const [form, setForm] = useState({ type: 'ISSUANCE', amount: '', reason: '', comment: '', targetBranchId: '', targetWalletId: '' });
    const [creating, setCreating] = useState(false);
    const [branches, setBranches] = useState<any[]>([]);
    // Nom du compte système ciblé, pour affichage (le formulaire n'envoie que targetWalletId
    // au backend — ce nom n'est là que pour que l'admin sache ce qu'il cible avant de soumettre).
    const [adjustTargetName, setAdjustTargetName] = useState('');
    const { toasts, push } = useToast();
    const [confirmState, setConfirmState] = useState<any>(null);

    // Arrivée depuis "Comptes Système > Créer un ajustement" : bascule directement sur le
    // formulaire, type ADJUSTMENT déjà sélectionné, avec le compte système visé en cible —
    // sans ça, il n'existait aucun moyen d'ajuster un compte système depuis l'UI (seul
    // targetWalletId existait déjà côté backend, jamais exposé dans ce formulaire).
    useEffect(() => {
        if (prefillAdjustTarget) {
            setForm(f => ({ ...f, type: 'ADJUSTMENT', targetBranchId: '', targetWalletId: prefillAdjustTarget.walletId }));
            setAdjustTargetName(prefillAdjustTarget.name);
            setTab('create');
        }
    }, [prefillAdjustTarget]);

    const fetchOverview = async () => {
        try {
            const r = await fetch(`${API_URL}/api/treasury/overview`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) setOverview(await r.json());
        } catch (e) { console.error(e); }
    };

    const fetchRequests = async () => {
        try {
            const r = await fetch(`${API_URL}/api/treasury/requests`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) setRequests(await r.json());
        } catch (e) { console.error(e); }
    };

    const fetchBranches = async () => {
        try {
            const r = await fetch(`${API_URL}/api/admin/branches?limit=100`, { headers: { Authorization: `Bearer ${token}` } });
            const d = await r.json();
            if (r.ok) setBranches(Array.isArray(d) ? d : (d.branches || []));
        } catch (e) { console.error(e); }
    };

    const fetchAgenciesLiquidity = async () => {
        try {
            const r = await fetch(`${API_URL}/api/treasury/agencies-liquidity`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) setAgenciesLiquidity(await r.json());
        } catch (e) { console.error(e); }
    };

    const fetchReconciliation = async () => {
        try {
            const r = await fetch(`${API_URL}/api/treasury/reconciliation`, { headers: { Authorization: `Bearer ${token}` } });
            if (r.ok) setReconciliation(await r.json());
        } catch (e) { console.error(e); }
    };

    const loadAll = async () => {
        setLoading(true);
        await Promise.all([fetchOverview(), fetchRequests(), fetchBranches(), fetchAgenciesLiquidity(), fetchReconciliation()]);
        setLoading(false);
    };

    useEffect(() => { loadAll(); }, [tab]);

    // Actions
    const commitCreateRequest = async () => {
        setCreating(true);
        try {
            const payload: any = { type: form.type, amount: parseFloat(form.amount) || 0, reason: form.reason, comment: form.comment };
            if (form.targetBranchId) payload.targetBranchId = form.targetBranchId;
            if (form.targetWalletId) payload.targetWalletId = form.targetWalletId;

            const r = await fetch(`${API_URL}/api/treasury/requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(payload)
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            push('Demande créée avec succès, envoyée pour validation.', 'success');
            setTab('requests');
            setForm({ type: 'ISSUANCE', amount: '', reason: '', comment: '', targetBranchId: '', targetWalletId: '' });
        } catch (err: any) { push(err.message, 'error'); } finally { setCreating(false); setConfirmState(null); }
    };

    const handleCreateRequest = (e: React.FormEvent) => {
        e.preventDefault();
        setConfirmState({
            type: 'create',
            actionName: form.type === 'ISSUANCE' ? 'Création monétaire' : form.type === 'ALLOCATION' ? 'Allocation' : 'Opération',
            amount: form.amount
        });
    };

    const commitApprove = async (id: string) => {
        try {
            const r = await fetch(`${API_URL}/api/treasury/requests/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            push(`Requête approuvée et exécutée avec succès !`, 'success');
            loadAll();
        } catch (err: any) { push(err.message, 'error'); } finally { setConfirmState(null); }
    };

    const commitReject = async (id: string, reason: string) => {
        if (!reason || reason.trim() === '') { push("Le motif de rejet est requis.", "error"); return; }
        try {
            const r = await fetch(`${API_URL}/api/treasury/requests/${id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ rejectionReason: reason })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            push(`Requête rejetée.`, 'success');
            loadAll();
        } catch (err: any) { push(err.message, 'error'); } finally { setConfirmState(null); }
    };

    const commitResolveReconciliation = async (id: string, resolution: string) => {
        if (!resolution || resolution.trim() === '') return;
        try {
            const r = await fetch(`${API_URL}/api/treasury/reconciliation/${id}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ resolution, newStatus: 'RESOLVED' })
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            push(`Écart résolu avec succès.`, 'success');
            loadAll();
        } catch (err: any) { push(err.message, 'error'); } finally { setConfirmState(null); }
    };

    // "Lancer Opération" n'a de sens que pour qui peut réellement soumettre : le backend
    // (POST /treasury/requests) exige perm_treasury_mint pour ISSUANCE et perm_treasury_allocate
    // pour les 4 autres types. Sans ce filtre, RISK (qui n'a que perm_treasury_view) voyait cet
    // onglet, remplissait le formulaire, et se prenait systématiquement un 403 à la soumission.
    const canCreateTreasuryOp = hasPerm(['perm_treasury_mint', 'perm_treasury_allocate']);
    const treasuryTabs = [
        { id: 'overview' as const, icon: <BarChart3 size={18} />, label: 'Tableau de Bord & KPI' },
        { id: 'agencies' as const, icon: <Building2 size={18} />, label: 'Liquidité Agences' },
        { id: 'reconciliation' as const, icon: <AlertTriangle size={18} />, label: 'Rapprochements' },
        { id: 'requests' as const, icon: <Activity size={18} />, label: 'Opérations & Approbations' },
        ...(canCreateTreasuryOp ? [{ id: 'create' as const, icon: <Shield size={18} />, label: 'Lancer Opération' }] : [])
    ];

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
            <ToastHost toasts={toasts} />
            <div style={{ marginBottom: 24 }}>
                <PageHeader
                    title="Trésorerie Centrale"
                    subtitle="Gestion de la monnaie électronique, de la réserve et des allocations système."
                    action={
                        <button onClick={loadAll} style={{ padding: '10px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                            <RefreshCw size={16} /> Rafraîchir
                        </button>
                    }
                />
            </div>

            <TabBar<TreasuryTab> tabs={treasuryTabs} active={tab} onChange={setTab} />

            {loading && !overview ? (
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}><RefreshCw size={32} className="spin" /></div>
            ) : (
                <>
                    {tab === 'overview' && overview && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                                <KpiCard label="Masse Monétaire Totale" value={fmt(overview.moneySupply)} subtitle="Masse monétaire électronique totale en circulation (M0)" icon={<Activity size={20} />} color="var(--accent)" />
                                <KpiCard label="Trésorerie Centrale" value={fmt(overview.reserveBalance)} subtitle="Séparée du Siège (qui fonctionne comme une agence normale)" icon={<Shield size={20} />} color="var(--success)" />
                                <KpiCard label="Portefeuilles Clients" value={fmt(overview.clientWalletsBalance)} subtitle="Solde net détenu par les vrais clients (comptes système exclus)" icon={<Wallet size={20} />} color="var(--warning)" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                                <KpiCard label="Liquidité Agences (E-Wallet)" value={fmt(overview.totalAgencyElectronic)} subtitle="Fonds alloués électroniquement aux agences (Siège inclus)" icon={<Building2 size={20} />} color="#3b82f6" />
                                <KpiCard label="Liquidité Physique (Coffre)" value={fmt(overview.totalPhysicalVault)} subtitle="Total du cash remonté par les agences" icon={<StopCircle size={20} />} color="#8b5cf6" />
                                <KpiCard label="Comptes Système" value={fmt(overview.systemAccountsBalance)} subtitle="Passerelle, Corporate, Coffre Tontine — voir Comptes Système" icon={<Server size={20} />} color="#ec4899" />
                            </div>

                            <div className="card" style={{ marginTop: 24, padding: 30 }}>
                                {(() => {
                                    // Calculé plutôt qu'affiché en dur : l'ancien badge "✓ SYSTÈME ÉQUILIBRÉ" et
                                    // "0 FCFA" étaient des littéraux, affichés inconditionnellement même si les
                                    // composants ne sommaient plus à la masse monétaire totale.
                                    const componentsSum = (overview.reserveBalance || 0) + (overview.totalAgencyElectronic || 0) + (overview.clientWalletsBalance || 0) + (overview.systemAccountsBalance || 0);
                                    const discrepancy = (overview.moneySupply || 0) - componentsSum;
                                    const isBalanced = Math.abs(discrepancy) < 1;
                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                                            <h3 style={{ margin: 0, fontWeight: 800, fontSize: 20 }}>Rapprochement Comptable</h3>
                                            <span style={{ background: isBalanced ? 'var(--success-bg)' : 'var(--danger-bg)', color: isBalanced ? 'var(--success)' : 'var(--danger)', padding: '4px 12px', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>{isBalanced ? '✓ SYSTÈME ÉQUILIBRÉ' : '⚠ ÉCART DÉTECTÉ'}</span>
                                        </div>
                                    );
                                })()}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 10 }}>
                                        <span style={{ fontWeight: 600 }}>Total Masse Monétaire Calculée (Ledger)</span>
                                        <span style={{ fontWeight: 800, fontSize: 16 }}>{fmt(overview.moneySupply)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>- Trésorerie Centrale</span>
                                        <span style={{ fontWeight: 600, color: 'var(--success)' }}>{fmt(overview.reserveBalance)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>- E-Wallets Agences</span>
                                        <span style={{ fontWeight: 600, color: '#3b82f6' }}>{fmt(overview.totalAgencyElectronic)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>- Portefeuilles Clients (End Users)</span>
                                        <span style={{ fontWeight: 600, color: 'var(--warning)' }}>{fmt(overview.clientWalletsBalance)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 10 }}>
                                        <span style={{ color: 'var(--text-muted)' }}>- Comptes Système (Passerelle, Corporate, Tontine...)</span>
                                        <span style={{ fontWeight: 600, color: '#ec4899' }}>{fmt(overview.systemAccountsBalance)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', borderRadius: 10, marginTop: 12 }}>
                                        <span style={{ fontWeight: 800 }}>ÉCART NON JUSTIFIÉ</span>
                                        <span style={{ fontWeight: 900, color: Math.abs((overview.moneySupply || 0) - ((overview.reserveBalance || 0) + (overview.totalAgencyElectronic || 0) + (overview.clientWalletsBalance || 0) + (overview.systemAccountsBalance || 0))) < 1 ? 'var(--success)' : 'var(--danger)', fontSize: 18 }}>
                                            {fmt((overview.moneySupply || 0) - ((overview.reserveBalance || 0) + (overview.totalAgencyElectronic || 0) + (overview.clientWalletsBalance || 0) + (overview.systemAccountsBalance || 0)))}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === 'agencies' && (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Liquidité des Succursales (E-Wallets)</h3>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Agence', 'E-Wallet', 'Coffre Fort (Espèces)', 'Statut E-Wallet'].map((h, i) => (
                                            <th key={i} style={{ textAlign: 'left', padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {agenciesLiquidity.map((a: any) => (
                                        <tr key={a.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px', fontWeight: 700 }}>{a.name} <code style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{a.code}</code></td>
                                            <td style={{ padding: '14px 16px', fontWeight: 900 }}>{fmt(a.electronicBalance)}</td>
                                            <td style={{ padding: '14px 16px', fontWeight: 900, color: '#8b5cf6' }}>{fmt(a.physicalVault)}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: a.status === 'CRITICAL' ? 'var(--danger-bg)' : a.status === 'LOW' ? 'var(--warning-bg)' : 'var(--success-bg)', color: a.status === 'CRITICAL' ? 'var(--danger)' : a.status === 'LOW' ? 'var(--warning)' : 'var(--success)' }}>
                                                    {a.status === 'CRITICAL' ? 'Critique' : a.status === 'LOW' ? 'Faible' : 'Normal'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {agenciesLiquidity.length === 0 && <tr><td colSpan={4} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune agence trouvée.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {tab === 'reconciliation' && (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Cas de Rapprochement (Écarts Agences)</h3>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Réf.', 'Agence', 'Attendu', 'Déclaré (Coffre)', 'Différence', 'Date', 'Statut', 'Actions'].map((h, i) => (
                                            <th key={i} style={{ textAlign: 'left', padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {reconciliation.map((r: any) => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px' }}><code style={{ fontSize: 12 }}>{r.reference}</code></td>
                                            <td style={{ padding: '14px 16px', fontWeight: 600 }}>{r.branch.name}</td>
                                            <td style={{ padding: '14px 16px' }}>{fmt(r.expectedAmount)}</td>
                                            <td style={{ padding: '14px 16px' }}>{fmt(r.reportedAmount)}</td>
                                            <td style={{ padding: '14px 16px', fontWeight: 900, color: r.difference === 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt(r.difference)}</td>
                                            <td style={{ padding: '14px 16px', fontSize: 12 }}>{fmtDate(r.createdAt)}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{
                                                    padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                                                    background: r.status === 'UNDER_REVIEW' ? 'var(--warning-bg)' : r.status === 'MISMATCH' ? 'var(--danger-bg)' : 'var(--success-bg)',
                                                    color: r.status === 'UNDER_REVIEW' ? 'var(--warning)' : r.status === 'MISMATCH' ? 'var(--danger)' : 'var(--success)'
                                                }}>
                                                    {r.status === 'UNDER_REVIEW' ? 'En révision' : r.status === 'MISMATCH' ? 'Écart' : 'Résolu'}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.status !== 'RESOLVED' ? (
                                                    <button onClick={() => setConfirmState({ type: 'resolve', txId: r.id, ref: r.reference })} style={{ padding: '6px 12px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-bg)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Résoudre</button>
                                                ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {reconciliation.length === 0 && <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun cas de rapprochement.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {tab === 'requests' && (
                        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>Registre des Mouvements (Maker/Checker)</h3>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        {['Référence', 'Opération', 'Montant', 'Destinataire', 'Généré par (Maker)', 'Audité par (Checker)', 'Statut', 'Actions (Checker)'].map((h, i) => (
                                            <th key={i} style={{ textAlign: 'left', padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map((r: any) => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '14px 16px' }}><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: 6 }}>{r.reference}</code><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{fmtDate(r.createdAt)}</div></td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <span style={{ padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 800, background: r.type === 'ISSUANCE' ? '#8b5cf620' : r.type === 'ALLOCATION' ? '#3b82f620' : 'var(--success-bg)', color: r.type === 'ISSUANCE' ? '#8b5cf6' : r.type === 'ALLOCATION' ? '#3b82f6' : 'var(--success)' }}>
                                                    {r.type === 'ISSUANCE' ? 'MINT' : r.type}
                                                </span>
                                            </td>
                                            <td style={{ padding: '14px 16px', fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(r.amount)}</td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.type === 'ISSUANCE' ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>Réserve Centrale</span> : (r.targetBranch ? `${r.targetBranch.name} (${r.targetBranch.code})` : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Wallet {r.targetWalletId || 'Inconnu'}</span>)}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                <div style={{ fontWeight: 600 }}>{r.maker.name}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.maker.role}</div>
                                            </td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.checker ? <><div style={{ fontWeight: 600 }}>{r.checker.name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.checker.role}</div></> : <span style={{ color: 'var(--text-muted)' }}>En attente</span>}
                                                {r.rejectionReason && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4, fontStyle: 'italic' }}>Rejeté: {r.rejectionReason}</div>}
                                            </td>
                                            <td style={{ padding: '14px 16px' }}><StatusBadge status={r.status} /></td>
                                            <td style={{ padding: '14px 16px' }}>
                                                {r.status === 'PENDING' ? (
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        {!hasPerm(['perm_treasury_approve']) ? (
                                                            <span style={{ color: 'var(--text-muted)' }}>En attente d'approbation...</span>
                                                        ) : staffId && r.maker?.id === staffId && !hasPerm(['perm_staff_permissions_edit']) ? (
                                                            // Bloqué côté serveur de toute façon pour les makers standards.
                                                            // Mais pour un SUPER_ADMIN (détecté via une perm exclusive),
                                                            // on lève le blocage frontend pour permettre l'auto-approbation.
                                                            <span style={{ color: 'var(--text-muted)' }} title="Vous ne pouvez pas approuver votre propre demande.">Votre propre demande</span>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => setConfirmState({ type: 'approve', txId: r.id, ref: r.reference })} style={{ padding: '6px 12px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success-bg)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Valider</button>
                                                                <button onClick={() => setConfirmState({ type: 'reject', txId: r.id, ref: r.reference })} style={{ padding: '6px 12px', background: 'var(--danger-bg)', color: 'var(--danger)', border: '1px solid var(--danger-bg)', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Rejeter</button>
                                                            </>
                                                        )}
                                                    </div>
                                                ) : <span style={{ color: 'var(--text-muted)' }}>Terminé</span>}
                                            </td>
                                        </tr>
                                    ))}
                                    {requests.length === 0 && <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune demande dans l'historique.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {tab === 'create' && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 300px) 1fr', gap: 24, alignItems: 'start' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {[
                                    { val: 'ISSUANCE', label: 'Création (Mint)', color: 'var(--accent)', icon: <ArrowUpRight size={18} />, desc: 'Injecter dans la Réserve Centrale' },
                                    { val: 'ALLOCATION', label: 'Allocation Agence', color: '#3b82f6', icon: <ArrowRight size={18} />, desc: 'Verser aux e-wallets agences' },
                                    { val: 'RETURN', label: 'Retour au Siège', color: 'var(--warning)', icon: <Undo2 size={18} />, desc: 'Remontée des agences' },
                                    { val: 'ADJUSTMENT', label: 'Ajustement Manuel', color: '#ec4899', icon: <History size={18} />, desc: 'Correction des grands livres' }
                                ].map(t => (
                                    <button
                                        key={t.val}
                                        type="button"
                                        onClick={() => setForm({ ...form, type: t.val, targetBranchId: '', targetWalletId: '' })}
                                        style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 16, borderRadius: 16, border: `2px solid ${form.type === t.val ? t.color : 'transparent'}`, background: form.type === t.val ? `${t.color}15` : 'var(--bg-secondary)', cursor: 'pointer', textAlign: 'left', transition: '0.2s', position: 'relative' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: form.type === t.val ? t.color : 'var(--text-primary)', fontWeight: 800, fontSize: 15 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 10, background: form.type === t.val ? t.color : 'var(--bg-card)', color: form.type === t.val ? 'white' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {t.icon}
                                            </div>
                                            {t.label}
                                        </div>
                                        <div style={{ marginLeft: 42, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>{t.desc}</div>
                                        {form.type === t.val && <div style={{ position: 'absolute', right: 16, top: 22, color: t.color }}><CheckCircle2 size={24} /></div>}
                                    </button>
                                ))}
                            </div>

                            <div className="card" style={{ padding: 32, borderRadius: 20 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
                                    <div style={{ width: 48, height: 48, borderRadius: 12, background: form.type === 'ISSUANCE' ? 'var(--accent)' : form.type === 'ALLOCATION' ? '#3b82f6' : 'var(--btn-dark-bg)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={24} /></div>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
                                            {form.type === 'ISSUANCE' ? 'Création de Monnaie (Mint)' : form.type === 'ALLOCATION' ? 'Allouer à une Agence' : 'Opération Manuelle'}
                                        </h3>
                                        <p style={{ color: 'var(--text-muted)', margin: '4px 0 0', fontSize: 14 }}>Toute requête créée devra être auditée de manière asynchrone par un Validation Center (Checker).</p>
                                    </div>
                                </div>
                                <form onSubmit={handleCreateRequest} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase' }}>Montant (FCFA) *</label>
                                        <div style={{ position: 'relative' }}>
                                            <input required type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="Ex: 5000000" style={{ width: '100%', padding: '24px 24px 24px 60px', borderRadius: 16, border: '2px solid var(--border)', fontSize: 32, fontWeight: 900, color: 'var(--text-primary)', background: 'var(--bg-primary)' }} />
                                            <div style={{ position: 'absolute', left: 20, top: 32, fontSize: 24, fontWeight: 900, color: 'var(--text-muted)' }}>₣</div>
                                        </div>
                                    </div>

                                    {form.type === 'ADJUSTMENT' && adjustTargetName && form.targetWalletId && (
                                        <div style={{ padding: 20, border: '2px solid var(--accent)', borderRadius: 16, background: 'var(--accent-bg)' }}>
                                            <label style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>Compte Système Ciblé</label>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontWeight: 900, fontSize: 15 }}>{adjustTargetName}</span>
                                                <button type="button" onClick={() => { setForm({ ...form, targetWalletId: '' }); setAdjustTargetName(''); }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 800, textDecoration: 'underline' }}>
                                                    Changer pour une agence
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {(form.type === 'ALLOCATION' || form.type === 'RETURN' || (form.type === 'ADJUSTMENT' && !form.targetWalletId)) && (
                                        <div style={{ padding: 20, border: '2px dashed var(--border)', borderRadius: 16, background: 'var(--bg-secondary)' }}>
                                            <label style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase' }}>Agence Ciblée {form.type !== 'ADJUSTMENT' && '*'}</label>
                                            <select required={form.type !== 'ADJUSTMENT'} value={form.targetBranchId} onChange={e => setForm({ ...form, targetBranchId: e.target.value })} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 15, fontWeight: 600, background: 'var(--bg-card)' }}>
                                                <option value="">-- {form.type === 'ADJUSTMENT' ? 'Laisser vide pour la Trésorerie Centrale' : 'Sélectionner une agence'} --</option>
                                                {branches.map(b => (
                                                    <option key={b.id} value={b.id}>{b.name} (Solde: {fmt(b.wallet?.balance)})</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase' }}>Motif de l'opération *</label>
                                        <input required value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Ex: Renflouement journalier agence LBV-01" style={{ width: '100%', padding: '16px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-secondary)' }} />
                                    </div>

                                    <div>
                                        <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 10, textTransform: 'uppercase' }}>Commentaire d'audit (Optionnel)</label>
                                        <textarea value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} placeholder="Détails supplémentaires pour l'équipe d'audit..." rows={3} style={{ width: '100%', padding: '16px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 14, fontFamily: 'inherit', background: 'var(--bg-secondary)' }} />
                                    </div>

                                    <div style={{ padding: 16, background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 12, fontSize: 13, color: '#c2410c', display: 'flex', gap: 12, alignItems: 'center', fontWeight: 600 }}>
                                        <AlertTriangle size={24} style={{ flexShrink: 0 }} />
                                        En tant que MAKER, votre action sera enregistrée comme PENDING. La validation doit se faire par un Validation Center ou Checker autorisé.
                                    </div>

                                    <button type="submit" disabled={creating} style={{ width: '100%', padding: '20px', background: 'var(--btn-dark-bg)', color: 'white', border: 'none', borderRadius: 16, cursor: 'pointer', fontWeight: 900, fontSize: 16, marginTop: 8, transition: '0.2s', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
                                        <Shield size={20} /> {creating ? 'Création de la requête en cours...' : 'Envoyer pour Validation (Maker)'}
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}
                </>
            )}

            {confirmState?.type === 'create' && (
                <ConfirmDialog
                    title={`Confirmer la ${confirmState.actionName}`}
                    subtitle={`Vous êtes sur le point de soumettre une demande Maker pour un montant de ${fmt(parseFloat(confirmState.amount))} FCFA.`}
                    confirmLabel="Soumettre"
                    onClose={() => setConfirmState(null)}
                    onConfirm={() => commitCreateRequest()}
                />
            )}
            {confirmState?.type === 'approve' && (
                <ConfirmDialog
                    title={`Approuver l'opération ${confirmState.ref}`}
                    subtitle="Cette action est irréversible et modifiera définitivement les soldes sur le grand livre."
                    confirmLabel="Approuver et Exécuter"
                    danger
                    onClose={() => setConfirmState(null)}
                    onConfirm={() => commitApprove(confirmState.txId)}
                />
            )}
            {confirmState?.type === 'reject' && (
                <ConfirmDialog
                    title={`Rejeter l'opération ${confirmState.ref}`}
                    subtitle="L'opération sera marquée comme rejetée."
                    confirmLabel="Confirmer le rejet"
                    danger
                    requireReason
                    reasonLabel="Motif de rejet obligatoire"
                    onClose={() => setConfirmState(null)}
                    onConfirm={(reason) => commitReject(confirmState.txId, reason)}
                />
            )}
            {confirmState?.type === 'resolve' && (
                <ConfirmDialog
                    title={`Résolution du cas ${confirmState.ref}`}
                    subtitle="Décrivez la cause de l'écart et l'action de correction."
                    confirmLabel="Résoudre"
                    requireReason
                    reasonLabel="Motif et actions"
                    onClose={() => setConfirmState(null)}
                    onConfirm={(resolution) => commitResolveReconciliation(confirmState.txId, resolution)}
                />
            )}
        </div>
    );
}
