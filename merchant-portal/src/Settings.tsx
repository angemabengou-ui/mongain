import { Building2, CircleDollarSign, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, canManageSettings, ENDPOINTS } from './api';
import { fmtFCFA, parseAmountInput, pickNullableNumber } from './utils/format';

export default function Settings({ onSessionExpired }: { onSessionExpired: () => void }) {
    const canManage = canManageSettings();

    const [threshold, setThreshold] = useState<number | null>(null);
    const [bankName, setBankName] = useState('');
    const [iban, setIban] = useState('');
    const [swift, setSwift] = useState('');
    const [autoSettlementEnabled, setAutoSettlementEnabled] = useState(false);
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const [editingThreshold, setEditingThreshold] = useState(false);
    const [editValue, setEditValue] = useState(''); 
    const [savingThreshold, setSavingThreshold] = useState(false);

    const [editingBank, setEditingBank] = useState(false);
    const [editBankName, setEditBankName] = useState('');
    const [editIban, setEditIban] = useState('');
    const [editSwift, setEditSwift] = useState('');
    const [editAutoSettlement, setEditAutoSettlement] = useState(false);
    const [savingBank, setSavingBank] = useState(false);

    const handleAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.portalSettings);
            setThreshold(pickNullableNumber(res, ['portalApprovalThreshold']));
            setBankName(res.bankName || '');
            setIban(res.iban || '');
            setSwift(res.swift || '');
            setAutoSettlementEnabled(res.autoSettlementEnabled || false);
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const startEditThreshold = () => {
        setEditValue(threshold !== null ? String(threshold) : '');
        setEditingThreshold(true);
        setMessage('');
        setError('');
    };

    const handleSaveThreshold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingThreshold) return;
        const trimmed = editValue.trim();
        const parsed = trimmed === '' ? null : parseAmountInput(trimmed);
        if (trimmed !== '' && parsed === null) { setError('Montant invalide.'); return; }
        setSavingThreshold(true);
        setError('');
        setMessage('');
        try {
            await apiRequest(ENDPOINTS.portalSettings, {
                method: 'PATCH',
                body: JSON.stringify({ portalApprovalThreshold: parsed }),
            });
            setThreshold(parsed);
            setEditingThreshold(false);
            setMessage('Seuil de double validation mis à jour.');
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSavingThreshold(false);
        }
    };

    const startEditBank = () => {
        setEditBankName(bankName);
        setEditIban(iban);
        setEditSwift(swift);
        setEditAutoSettlement(autoSettlementEnabled);
        setEditingBank(true);
        setMessage('');
        setError('');
    };

    const handleSaveBank = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingBank) return;
        setSavingBank(true);
        setError('');
        setMessage('');
        try {
            await apiRequest(ENDPOINTS.portalSettings, {
                method: 'PATCH',
                body: JSON.stringify({ 
                    bankName: editBankName.trim(), 
                    iban: editIban.trim(), 
                    swift: editSwift.trim(),
                    autoSettlementEnabled: editAutoSettlement 
                }),
            });
            setBankName(editBankName.trim());
            setIban(editIban.trim());
            setSwift(editSwift.trim());
            setAutoSettlementEnabled(editAutoSettlement);
            setEditingBank(false);
            setMessage('Coordonnées bancaires mises à jour.');
        } catch (err: any) {
            if (handleAuthError(err)) return;
            setError(err.message);
        } finally {
            setSavingBank(false);
        }
    };

    return (
        <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><ShieldCheck size={22} /></div>
                    Réglages
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                    Gérez vos préférences de validation et les coordonnées de déversement bancaire automatique.
                </p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {message && <div className="banner success mb-8">{message}</div>}
            {!canManage && (
                <div className="banner info mb-8">
                    Vous n'avez pas les droits pour modifier ces réglages. Seul un Admin peut les modifier.
                </div>
            )}

            <div className="card mb-8">
                <div className="flex-between" style={{ flexWrap: 'wrap', gap: 16, marginBottom: canManage && editingThreshold ? 20 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 12, borderRadius: 12, display: 'flex' }}>
                            <CircleDollarSign size={22} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 15 }}>Seuil de double validation</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, maxWidth: 480 }}>
                                {loading ? 'Chargement...' : threshold !== null
                                    ? `Au-delà de ${fmtFCFA(threshold)}, un paiement groupé reste en attente jusqu'à l'approbation d'un second membre habilité.`
                                    : "Aucun seuil défini : tous les paiements groupés s'exécutent immédiatement, quel que soit leur montant."}
                            </div>
                        </div>
                    </div>
                    {canManage && !editingThreshold && !loading && (
                        <button className="btn-secondary" onClick={startEditThreshold}>Modifier</button>
                    )}
                </div>

                {canManage && editingThreshold && (
                    <form onSubmit={handleSaveThreshold} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                            <label>Seuil (FCFA) — laisser vide pour désactiver</label>
                            <input
                                type="number" min={1} step={1} value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                placeholder="Ex: 1000000"
                            />
                        </div>
                        <button type="submit" disabled={savingThreshold} className="btn-primary">
                            {savingThreshold ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                        <button type="button" disabled={savingThreshold} className="btn-secondary" onClick={() => setEditingThreshold(false)}>
                            Annuler
                        </button>
                    </form>
                )}
            </div>

            <div className="card">
                <div className="flex-between" style={{ flexWrap: 'wrap', gap: 16, marginBottom: canManage && editingBank ? 20 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 12, borderRadius: 12, display: 'flex' }}>
                            <Building2 size={22} />
                        </div>
                        <div>
                            <div style={{ fontWeight: 800, fontSize: 15 }}>Déversement Bancaire (T+1)</div>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, maxWidth: 480 }}>
                                {loading ? 'Chargement...' : iban
                                    ? `Les fonds de votre solde Mongain seront ${autoSettlementEnabled ? 'automatiquement virés à J+1' : 'disponibles pour un virement manuel'} vers le compte ${iban} (${bankName}).`
                                    : "Aucun compte bancaire configuré. Le virement automatique T+1 est impossible."}
                            </div>
                        </div>
                    </div>
                    {canManage && !editingBank && !loading && (
                        <button className="btn-secondary" onClick={startEditBank}>Modifier</button>
                    )}
                </div>

                {canManage && editingBank && (
                    <form onSubmit={handleSaveBank} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                            <div>
                                <label>Nom de la banque</label>
                                <input type="text" value={editBankName} onChange={e => setEditBankName(e.target.value)} placeholder="Ex: UBA Gabon" required />
                            </div>
                            <div>
                                <label>Code SWIFT / BIC</label>
                                <input type="text" value={editSwift} onChange={e => setEditSwift(e.target.value)} placeholder="Ex: UBAFGAXXXX" />
                            </div>
                        </div>
                        <div>
                            <label>IBAN ou Numéro de Compte (RIB)</label>
                            <input type="text" value={editIban} onChange={e => setEditIban(e.target.value)} placeholder="Ex: GA000 00000 00000000000 00" required />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 8, padding: 12, background: 'var(--surface-dim)', borderRadius: 8 }}>
                            <input 
                                type="checkbox" 
                                id="autoSettlement"
                                checked={editAutoSettlement}
                                onChange={e => setEditAutoSettlement(e.target.checked)}
                                style={{ width: 18, height: 18 }}
                            />
                            <label htmlFor="autoSettlement" style={{ margin: 0, fontSize: 14, cursor: 'pointer' }}>
                                Activer le virement automatique de tout mon solde chaque soir (T+1)
                            </label>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                            <button type="submit" disabled={savingBank} className="btn-primary">
                                {savingBank ? 'Enregistrement...' : 'Enregistrer les coordonnées'}
                            </button>
                            <button type="button" disabled={savingBank} className="btn-secondary" onClick={() => setEditingBank(false)}>
                                Annuler
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

