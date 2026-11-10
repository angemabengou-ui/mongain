import { CheckCircle2, Clock, FileClock, Plus, RefreshCw, ShieldOff, Users, XCircle } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { apiRequest, canManageAffiliations, ENDPOINTS } from './api';
import { fmtFCFA, pickNumber, pickString } from './utils/format';

type ExpectedFrequency = 'MONTHLY' | 'WEEKLY' | null;
type ComplianceStatus = 'OK' | 'LATE' | null;

type Affiliation = {
    id: string;
    status: string;
    merchantName?: string;
    merchantPhone?: string;
    createdAt?: string;
    respondedAt?: string;
    // Ajoutés par la capacité "fréquence attendue / conformité" (agent backend, en parallèle) —
    // absents de backend/src/routes/merchant-portal.ts au moment de l'écriture de cet écran
    // (vérifié : pas de trace d'expectedFrequency/complianceStatus dans le fichier réel à cette
    // date). Formes construites sur la spécification transmise.
    expectedFrequency: ExpectedFrequency;
    expectedAmount?: number;
    autoPayEnabled?: boolean;
    complianceStatus: ComplianceStatus;
};

// Forme vérifiée dans backend/src/routes/merchant-portal.ts (GET /affiliations) : chaque ligne
// porte merchant: { name, phone } imbriqué (Prisma include), pas de champs aplatis. On garde
// quand même la lecture de merchantName/merchantPhone en repli au cas où cette forme changerait.
function normalizeAffiliation(raw: any): Affiliation {
    return {
        id: raw.id,
        status: raw.status || 'PENDING',
        merchantName: pickString(raw, ['merchantName']) || pickString(raw.merchant, ['name', 'businessName']),
        merchantPhone: pickString(raw, ['merchantPhone']) || pickString(raw.merchant, ['phone']),
        createdAt: raw.createdAt,
        respondedAt: raw.respondedAt,
        expectedFrequency: raw.expectedFrequency === 'MONTHLY' || raw.expectedFrequency === 'WEEKLY' ? raw.expectedFrequency : null,
        expectedAmount: typeof raw.expectedAmount === 'number' ? raw.expectedAmount : undefined,
        autoPayEnabled: !!raw.autoPayEnabled,
        complianceStatus: raw.complianceStatus === 'OK' || raw.complianceStatus === 'LATE' ? raw.complianceStatus : null,
    };
}

function frequencyLabel(freq: ExpectedFrequency): string {
    if (freq === 'MONTHLY') return 'Mensuelle';
    if (freq === 'WEEKLY') return 'Hebdomadaire';
    return 'Non définie';
}

function ComplianceBadge({ status }: { status: ComplianceStatus }) {
    if (status === 'OK') return <span className="status-pill success">À jour</span>;
    if (status === 'LATE') return <span className="status-pill danger">En retard</span>;
    return null;
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'ACCEPTED':
            return <span className="status-pill success"><CheckCircle2 size={12} style={{ marginRight: 4 }} />Acceptée</span>;
        case 'PENDING':
            return <span className="status-pill warning"><Clock size={12} style={{ marginRight: 4 }} />En attente</span>;
        case 'REJECTED':
            return <span className="status-pill danger"><XCircle size={12} style={{ marginRight: 4 }} />Refusée</span>;
        case 'REVOKED':
            return <span className="status-pill neutral"><ShieldOff size={12} style={{ marginRight: 4 }} />Révoquée</span>;
        default:
            return <span className="status-pill neutral">{status}</span>;
    }
}

type ComplianceSummary = {
    totalAmount: number;
    totalCount: number;
    lastPaymentAmount?: number;
    lastPaymentDate?: string;
    // Historique complet optionnel : le backend actuel (routes/merchant-portal.ts
    // GET /affiliations/:id/compliance) ne renvoie qu'un résumé agrégé (total + dernier
    // versement), pas une liste transaction par transaction. On garde la lecture d'un
    // éventuel tableau (history/payments/data) pour ne rien perdre si ce point de forme
    // change côté serveur, sans en dépendre pour l'affichage principal.
    entries: { label: string; amount?: number; status?: string }[];
};

function normalizeCompliance(raw: any): ComplianceSummary {
    const arr: any[] = raw?.history || raw?.payments || (Array.isArray(raw?.data) ? raw.data : []);
    const entries = Array.isArray(arr) ? arr.map((item, idx) => ({
        label: pickString(item, ['date', 'label', 'period', 'createdAt']) || `#${idx + 1}`,
        amount: pickNumber(item, ['amount', 'total', 'value']),
        status: pickString(item, ['status']),
    })) : [];
    return {
        totalAmount: pickNumber(raw, ['totalAmount']) ?? 0,
        totalCount: pickNumber(raw, ['totalCount']) ?? 0,
        lastPaymentAmount: pickNumber(raw?.lastPayment, ['amount']) ?? pickNumber(raw, ['lastPaymentAmount', 'lastAmount']),
        lastPaymentDate: pickString(raw?.lastPayment, ['date']) || pickString(raw, ['lastPaymentDate', 'lastDate']),
        entries,
    };
}

export default function Affiliations({ onSessionExpired }: { onSessionExpired: () => void }) {
    // ADMIN et MANAGER seulement — OPERATOR peut exécuter paiements/retraits mais pas gérer les
    // affiliations, AUDITOR reste en lecture seule. Le serveur (requirePortalAdmin ou son
    // équivalent enrichi une fois mergé, voir routes/merchant-portal.ts) renverrait 403 à ces
    // deux rôles : masqué ici plutôt que désactivé, même principe que partout dans ce portail.
    const canManage = canManageAffiliations();

    const [affiliations, setAffiliations] = useState<Affiliation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const [newPhone, setNewPhone] = useState('');
    const [newFrequency, setNewFrequency] = useState<'' | 'MONTHLY' | 'WEEKLY'>('');
    const [newAmount, setNewAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [revokingId, setRevokingId] = useState<string | null>(null);

    const [complianceId, setComplianceId] = useState<string | null>(null);
    const [complianceLoading, setComplianceLoading] = useState(false);
    const [complianceError, setComplianceError] = useState('');
    const [compliance, setCompliance] = useState<ComplianceSummary | null>(null);

    // Édition (définition initiale ou modification) de la fréquence/montant attendu d'une affiliation
    // déjà ACCEPTED — petit formulaire inline
    const [freqEditId, setFreqEditId] = useState<string | null>(null);
    const [freqValue, setFreqValue] = useState<'' | 'MONTHLY' | 'WEEKLY'>('');
    const [amountValue, setAmountValue] = useState('');
    const [freqSubmitting, setFreqSubmitting] = useState(false);

    const handleAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.affiliations);
            const list = Array.isArray(res) ? res : (res.affiliations || res.data || []);
            setAffiliations((Array.isArray(list) ? list : []).map(normalizeAffiliation));
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !newPhone.trim()) return;
        setSubmitting(true);
        setError('');
        setMessage('');
        try {
            const parsedAmount = parseInt(newAmount, 10);
            await apiRequest(ENDPOINTS.affiliations, {
                method: 'POST',
                body: JSON.stringify({ 
                    merchantPhone: newPhone.trim(), 
                    expectedFrequency: newFrequency || null,
                    expectedAmount: (parsedAmount > 0) ? parsedAmount : null 
                }),
            });
            setNewPhone('');
            setNewFrequency('');
            setNewAmount('');
            setMessage("Demande envoyée. Elle reste \"En attente\" tant que le marchand ne l'a pas acceptée depuis son application mobile — ce n'est pas automatique.");
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleRevoke = async (id: string) => {
        if (!window.confirm("Révoquer cette affiliation ? Le marchand ne sera plus rattaché à votre compte géant.")) return;
        setRevokingId(id);
        setError('');
        try {
            await apiRequest(ENDPOINTS.affiliationById(id), { method: 'DELETE' });
            setMessage('Affiliation révoquée.');
            if (complianceId === id) setComplianceId(null);
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setRevokingId(null);
        }
    };

    const openCompliance = async (id: string) => {
        if (complianceId === id) { setComplianceId(null); return; }
        setComplianceId(id);
        setCompliance(null);
        setComplianceError('');
        setComplianceLoading(true);
        try {
            const res = await apiRequest(ENDPOINTS.affiliationCompliance(id));
            setCompliance(normalizeCompliance(res));
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setComplianceError(err.message);
        } finally {
            setComplianceLoading(false);
        }
    };

    const openFreqEdit = (aff: Affiliation) => {
        if (freqEditId === aff.id) { setFreqEditId(null); return; }
        setFreqEditId(aff.id);
        setFreqValue(aff.expectedFrequency || '');
        setAmountValue(aff.expectedAmount ? aff.expectedAmount.toString() : '');
    };

    const handleSaveFrequency = async (id: string) => {
        setFreqSubmitting(true);
        setError('');
        try {
            const parsedAmount = parseInt(amountValue, 10);
            await apiRequest(ENDPOINTS.affiliationTerms(id), {
                method: 'PATCH',
                body: JSON.stringify({ 
                    expectedFrequency: freqValue || null,
                    expectedAmount: (parsedAmount > 0) ? parsedAmount : null
                }),
            });
            setMessage('Termes de versement mis à jour.');
            setFreqEditId(null);
            await load();
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setFreqSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div className="flex-between" style={{ marginBottom: 28 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><Users size={22} /></div>
                        Affiliations
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Marchands rattachés à votre compte pour le suivi de conformité des versements.</p>
                </div>
                <button onClick={load} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} /> Actualiser
                </button>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {message && <div className="banner success mb-8">{message}</div>}
            {!canManage && (
                <div className="banner info mb-8">
                    Vous n'avez pas les droits pour gérer les affiliations. Seuls un Admin ou un Manager peuvent affilier, révoquer ou modifier la fréquence attendue.
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: canManage ? '360px 1fr' : '1fr', gap: 32, alignItems: 'start' }}>
                {canManage && (
                    <form onSubmit={handleAdd} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Affilier un marchand</h2>
                        <div>
                            <label>Téléphone du marchand</label>
                            <input
                                type="tel" inputMode="tel" value={newPhone}
                                onChange={e => setNewPhone(e.target.value)}
                                placeholder="Ex: 074XXXXXX"
                            />
                        </div>
                        <div>
                            <label>Fréquence de versement attendue (optionnel)</label>
                            <select value={newFrequency} onChange={e => setNewFrequency(e.target.value as '' | 'MONTHLY' | 'WEEKLY')}>
                                <option value="">Aucune</option>
                                <option value="MONTHLY">Mensuelle</option>
                                <option value="WEEKLY">Hebdomadaire</option>
                            </select>
                        </div>
                        <div>
                            <label>Montant exact attendu (FCFA)</label>
                            <input
                                type="number" inputMode="numeric" value={newAmount}
                                onChange={e => setNewAmount(e.target.value)}
                                placeholder="Ex: 5000 (optionnel)"
                            />
                        </div>
                        <div className="banner info" style={{ fontSize: 13 }}>
                            <FileClock size={16} /> Le marchand doit accepter la demande depuis son application mobile. Elle restera "En attente" jusqu'à sa réponse.
                        </div>
                        <button type="submit" disabled={submitting || !newPhone.trim()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <Plus size={18} /> {submitting ? 'Envoi...' : 'Envoyer la demande'}
                        </button>
                    </form>
                )}

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Marchand</th>
                                <th>Statut</th>
                                <th>Fréquence attendue</th>
                                <th>Depuis le</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {affiliations.map(aff => (
                                <Fragment key={aff.id}>
                                    <tr>
                                        <td>
                                            <div style={{ fontWeight: 700 }}>{aff.merchantName || 'Marchand'}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{aff.merchantPhone || '—'}</div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                                <StatusBadge status={aff.status} />
                                                <ComplianceBadge status={aff.complianceStatus} />
                                            </div>
                                        </td>
                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{frequencyLabel(aff.expectedFrequency)}</td>
                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                            {aff.createdAt ? new Date(aff.createdAt).toLocaleDateString('fr-FR') : '—'}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                {aff.status === 'ACCEPTED' && (
                                                    <button className="btn-secondary" onClick={() => openCompliance(aff.id)} style={{ padding: '8px 14px', fontSize: 12 }}>
                                                        {complianceId === aff.id ? 'Masquer' : 'Conformité'}
                                                    </button>
                                                )}
                                                {canManage && aff.status === 'ACCEPTED' && (
                                                    <button className="btn-secondary" onClick={() => openFreqEdit(aff)} style={{ padding: '8px 14px', fontSize: 12 }}>
                                                        {freqEditId === aff.id ? 'Fermer' : (aff.expectedFrequency ? 'Modifier la fréquence' : 'Définir la fréquence')}
                                                    </button>
                                                )}
                                                {canManage && aff.status !== 'REVOKED' && (
                                                    <button
                                                        className="btn-danger"
                                                        disabled={revokingId === aff.id}
                                                        onClick={() => handleRevoke(aff.id)}
                                                    >
                                                        {revokingId === aff.id ? '...' : 'Révoquer'}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                    {freqEditId === aff.id && (
                                        <tr>
                                            <td colSpan={5} style={{ background: 'var(--bg-primary)', padding: 20 }}>
                                                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <label style={{ margin: 0, whiteSpace: 'nowrap' }}>Fréquence attendue</label>
                                                    <select value={freqValue} onChange={e => setFreqValue(e.target.value as '' | 'MONTHLY' | 'WEEKLY')} style={{ width: 160 }}>
                                                        <option value="">Aucune</option>
                                                        <option value="MONTHLY">Mensuelle</option>
                                                        <option value="WEEKLY">Hebdomadaire</option>
                                                    </select>
                                                    <label style={{ margin: 0, whiteSpace: 'nowrap' }}>Montant</label>
                                                    <input 
                                                        type="number" inputMode="numeric" value={amountValue} 
                                                        onChange={e => setAmountValue(e.target.value)} 
                                                        placeholder="Ex: 5000" style={{ width: 140 }} 
                                                    />
                                                    <button className="btn-primary" disabled={freqSubmitting} onClick={() => handleSaveFrequency(aff.id)} style={{ padding: '10px 18px' }}>
                                                        {freqSubmitting ? 'Enregistrement...' : 'Enregistrer'}
                                                    </button>
                                                    <button className="btn-secondary" disabled={freqSubmitting} onClick={() => setFreqEditId(null)} style={{ padding: '10px 18px' }}>
                                                        Annuler
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {complianceId === aff.id && (
                                        <tr>
                                            <td colSpan={5} style={{ background: 'var(--bg-primary)', padding: 24 }}>
                                                {complianceLoading && <div style={{ color: 'var(--text-muted)' }}>Chargement de l'historique...</div>}
                                                {complianceError && <div className="banner error">⚠️ {complianceError}</div>}
                                                {compliance && (
                                                    <div>
                                                        <div className="stats-grid" style={{ marginBottom: compliance.entries.length > 0 ? 20 : 0 }}>
                                                            <div className="stat-card" style={{ padding: 18 }}>
                                                                <div className="stat-value" style={{ fontSize: 20 }}>
                                                                    {typeof compliance.lastPaymentAmount === 'number' ? fmtFCFA(compliance.lastPaymentAmount) : 'Aucun versement'}
                                                                </div>
                                                                <div className="stat-label">
                                                                    Dernier versement{compliance.lastPaymentDate ? ` · ${new Date(compliance.lastPaymentDate).toLocaleDateString('fr-FR')}` : ''}
                                                                </div>
                                                            </div>
                                                            <div className="stat-card" style={{ padding: 18 }}>
                                                                <div className="stat-value" style={{ fontSize: 20 }}>{fmtFCFA(compliance.totalAmount)}</div>
                                                                <div className="stat-label">Total versé (historique)</div>
                                                            </div>
                                                            <div className="stat-card" style={{ padding: 18 }}>
                                                                <div className="stat-value" style={{ fontSize: 20 }}>{compliance.totalCount}</div>
                                                                <div className="stat-label">Nombre de versements</div>
                                                            </div>
                                                        </div>
                                                        {/* Historique transaction par transaction : non renvoyé par l'API actuelle (résumé
                                                            agrégé uniquement) — affiché seulement s'il apparaît un jour. */}
                                                        {compliance.entries.length > 0 && (
                                                            <table>
                                                                <thead>
                                                                    <tr><th>Date / Référence</th><th>Montant</th><th>Statut</th></tr>
                                                                </thead>
                                                                <tbody>
                                                                    {compliance.entries.map((entry, idx) => (
                                                                        <tr key={idx}>
                                                                            <td>{entry.label}</td>
                                                                            <td style={{ fontWeight: 700 }}>{typeof entry.amount === 'number' ? fmtFCFA(entry.amount) : '—'}</td>
                                                                            <td>{entry.status || '—'}</td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            ))}
                            {!loading && affiliations.length === 0 && (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun marchand affilié pour le moment.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
