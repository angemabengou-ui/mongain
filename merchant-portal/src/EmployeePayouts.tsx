import { Clock, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ENDPOINTS, isPortalViewer } from './api';
import { fmtFCFA, parseAmountInput, pickString } from './utils/format';

type PayoutEntry = { phone: string; amount: string };

// Traces des lots envoyés PENDANT cette session (pas un historique serveur — voir pourquoi
// juste en dessous). Perdu au rechargement de page, mais suffisant pour confirmer visuellement
// qu'un envoi a bien été pris en compte sans avoir à se fier uniquement au bandeau de succès.
type SentBatch = { bulkId?: string; name: string; totalAmount: number; entryCount: number; sentAt: string };

type Employee = { id: string; name?: string; phone?: string; isActive: boolean };

// Répertoire d'employés — GET/POST/DELETE /api/merchant-portal/employees, développées EN
// PARALLÈLE par l'agent backend (voir le commentaire au-dessus de ENDPOINTS.employees dans
// api.ts : absentes de backend/src/routes/merchant-portal.ts au moment de l'écriture de cet
// écran). DELETE désactive (soft-delete) plutôt que supprimer réellement — on filtre donc sur
// isActive côté client au cas où le GET renverrait aussi les employés désactivés.
function normalizeEmployee(raw: any): Employee {
    return {
        id: raw.id,
        name: pickString(raw, ['name']),
        phone: pickString(raw, ['phone']),
        isActive: typeof raw.isActive === 'boolean' ? raw.isActive : true,
    };
}

// Paiement des employés — POST /api/merchant-portal/payouts (vérifié directement dans
// backend/src/routes/merchant-portal.ts : réutilise runMassPayout(), factorée hors de
// routes/b2b.ts). Réponse 202 : { success, message, bulkId } — traitement asynchrone, pas de
// détail par bénéficiaire dans la réponse immédiate. Il n'existe PAS de route GET pour lister
// ces lots sous /api/merchant-portal (seul /api/b2b/payouts GET existe, protégé par
// l'authMiddleware classique — le token du portail, qui porte `portal: true` mais pas de
// `jwtVersion`, n'y passerait pas) : on journalise donc localement plutôt que d'appeler un
// endpoint qui n'existe pas pour ce canal.
//
// Reproduit EXACTEMENT le pattern anti-double-paiement d'admin-web/src/B2BHub.tsx : clé
// d'idempotence stable pendant toute une tentative (retries compris), régénérée uniquement
// après un succès — un bug de double-paiement avait déjà été corrigé une fois dans ce
// codebase avec ce mécanisme, il ne faut pas le réintroduire ici.
export default function EmployeePayouts({ onSessionExpired }: { onSessionExpired: () => void }) {
    const viewer = isPortalViewer();

    const [batchName, setBatchName] = useState('');
    const [entries, setEntries] = useState<PayoutEntry[]>([{ phone: '', amount: '' }]);
    const [pin, setPin] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [sentBatches, setSentBatches] = useState<SentBatch[]>([]);

    const idempotencyKey = useRef<string>(crypto.randomUUID());

    // Répertoire d'employés persistant — indépendant du formulaire de paie ci-dessus (qui reste
    // une simple liste d'entrées en mémoire) : sert à réutiliser un numéro déjà enregistré
    // plutôt que de le ressaisir à chaque paie.
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(true);
    const [employeesError, setEmployeesError] = useState('');
    const [newEmpName, setNewEmpName] = useState('');
    const [newEmpPhone, setNewEmpPhone] = useState('');
    const [addingEmployee, setAddingEmployee] = useState(false);
    const [removingEmployeeId, setRemovingEmployeeId] = useState<string | null>(null);

    const handleEmployeesAuthError = (err: any): boolean => {
        if (err?.name === 'SessionExpiredError') { onSessionExpired(); return true; }
        return false;
    };

    const loadEmployees = async () => {
        setLoadingEmployees(true);
        setEmployeesError('');
        try {
            const res = await apiRequest(ENDPOINTS.employees);
            const list = Array.isArray(res) ? res : (res.employees || res.data || []);
            setEmployees((Array.isArray(list) ? list : []).map(normalizeEmployee).filter(e => e.isActive));
        } catch (err: any) {
            if (handleEmployeesAuthError(err)) return;
            setEmployeesError(err.message);
        } finally {
            setLoadingEmployees(false);
        }
    };

    useEffect(() => { loadEmployees(); }, []);

    // Préremplit une ligne vide existante du formulaire de paie avec le téléphone de l'employé,
    // ou en ajoute une nouvelle si aucune n'est vide — sans jamais dupliquer un employé déjà
    // présent dans le lot en cours.
    const addToPayroll = (emp: Employee) => {
        if (!emp.phone) return;
        setEntries(prev => {
            if (prev.some(e => e.phone.trim() === emp.phone)) return prev;
            const emptyIdx = prev.findIndex(e => !e.phone.trim() && !e.amount.trim());
            if (emptyIdx !== -1) {
                return prev.map((e, i) => i === emptyIdx ? { ...e, phone: emp.phone as string } : e);
            }
            return [...prev, { phone: emp.phone as string, amount: '' }];
        });
    };

    const handleAddEmployee = async (e: React.FormEvent) => {
        e.preventDefault();
        if (addingEmployee || !newEmpName.trim() || !newEmpPhone.trim()) return;
        setAddingEmployee(true);
        setEmployeesError('');
        try {
            // 409 (employé déjà existant) remonte via apiRequest comme une Error normale
            // (data.error) — affichée telle quelle, pas de traitement spécial.
            await apiRequest(ENDPOINTS.employees, {
                method: 'POST',
                body: JSON.stringify({ name: newEmpName.trim(), phone: newEmpPhone.trim() }),
            });
            setNewEmpName('');
            setNewEmpPhone('');
            await loadEmployees();
        } catch (err: any) {
            if (handleEmployeesAuthError(err)) return;
            setEmployeesError(err.message);
        } finally {
            setAddingEmployee(false);
        }
    };

    const handleRemoveEmployee = async (id: string) => {
        if (!window.confirm("Retirer cet employé du répertoire ? Il ne sera plus proposé pour la paie groupée.")) return;
        setRemovingEmployeeId(id);
        setEmployeesError('');
        try {
            await apiRequest(ENDPOINTS.employeeById(id), { method: 'DELETE' });
            await loadEmployees();
        } catch (err: any) {
            if (handleEmployeesAuthError(err)) return;
            setEmployeesError(err.message);
        } finally {
            setRemovingEmployeeId(null);
        }
    };

    const updateEntry = (idx: number, field: keyof PayoutEntry, value: string) => {
        setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
    };

    const addEntry = () => setEntries(prev => [...prev, { phone: '', amount: '' }]);
    const removeEntry = (idx: number) => setEntries(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

    const totalAmount = entries.reduce((sum, e) => sum + (parseAmountInput(e.amount) || 0), 0);

    const isValid = batchName.trim().length > 0
        && entries.every(e => e.phone.trim().length > 0 && (parseAmountInput(e.amount) || 0) > 0)
        && pin.length === 4;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting || !isValid) return; // ceinture supplémentaire au-delà du bouton désactivé
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            const cleanEntries = entries.map(en => ({ phone: en.phone.trim(), amount: parseAmountInput(en.amount) || 0 }));
            const res = await apiRequest(ENDPOINTS.employeePayouts, {
                method: 'POST',
                body: JSON.stringify({
                    name: batchName.trim(),
                    // Montants FCFA envoyés en entiers, jamais de décimales.
                    entries: cleanEntries,
                    pin,
                    idempotencyKey: idempotencyKey.current,
                }),
            });

            setSentBatches(prev => [{
                bulkId: res?.bulkId,
                name: batchName.trim(),
                totalAmount,
                entryCount: cleanEntries.length,
                sentAt: new Date().toISOString(),
            }, ...prev]);

            setBatchName('');
            setEntries([{ phone: '', amount: '' }]);
            setPin('');
            idempotencyKey.current = crypto.randomUUID(); // nouvelle tentative = nouvelle clé
            setSuccess(res?.message || 'Paie envoyée, en cours de traitement.');
        } catch (err: any) {
            if (err?.name === 'SessionExpiredError') { onSessionExpired(); return; }
            // La clé n'est PAS régénérée ici : un nouveau clic après un échec (PIN erroné, solde
            // insuffisant...) doit rester reconnaissable comme la même tentative côté serveur.
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><Users size={22} /></div>
                    Paiement des Employés
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Envoyez une paie groupée directement vers les comptes Mongain de vos employés.</p>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}
            {success && <div className="banner success mb-8">{success}</div>}
            {viewer && (
                <div className="banner info mb-8">
                    Vous êtes connecté en lecture seule. Seul le géant principal ou un membre Admin peut exécuter une paie ou gérer le répertoire d'employés.
                </div>
            )}

            <div className="card" style={{ marginBottom: 32 }}>
                <div className="flex-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Employés enregistrés</h2>
                    {!viewer && (
                        <form onSubmit={handleAddEmployee} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input type="text" value={newEmpName} onChange={e => setNewEmpName(e.target.value)} placeholder="Nom" style={{ width: 160, padding: '10px 12px' }} />
                            <input type="tel" inputMode="tel" value={newEmpPhone} onChange={e => setNewEmpPhone(e.target.value)} placeholder="Téléphone" style={{ width: 160, padding: '10px 12px' }} />
                            <button
                                type="submit"
                                disabled={addingEmployee || !newEmpName.trim() || !newEmpPhone.trim()}
                                className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                            >
                                <UserPlus size={16} /> {addingEmployee ? 'Ajout...' : 'Ajouter'}
                            </button>
                        </form>
                    )}
                </div>
                {employeesError && <div className="banner error mb-8" style={{ fontSize: 13 }}>{employeesError}</div>}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {employees.map(emp => (
                        <div key={emp.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 13 }}>{emp.name || 'Employé'}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emp.phone || '—'}</div>
                            </div>
                            {!viewer && (
                                <>
                                    <button type="button" className="btn-secondary" onClick={() => addToPayroll(emp)} style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                                        Ajouter à la paie
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveEmployee(emp.id)}
                                        disabled={removingEmployeeId === emp.id}
                                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 4 }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                    {!loadingEmployees && employees.length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Aucun employé enregistré. Ajoutez-en un pour le réutiliser dans vos prochaines paies.</div>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: viewer ? '1fr' : '1fr 1fr', gap: 32, alignItems: 'start' }}>
                {!viewer && (
                <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Nouvelle paie groupée</h2>

                    <div>
                        <label>Nom du lot</label>
                        <input type="text" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="Ex: Salaires Septembre 2026" />
                    </div>

                    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                        <div className="flex-between" style={{ marginBottom: 16 }}>
                            <label style={{ margin: 0 }}>Employés</label>
                            <button type="button" onClick={addEntry} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <Plus size={16} style={{ marginRight: 4 }} /> Ajouter
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {entries.map((en, idx) => (
                                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <input type="tel" value={en.phone} onChange={e => updateEntry(idx, 'phone', e.target.value)} style={{ flex: 1.2, padding: '10px 12px' }} placeholder="Téléphone" />
                                    <input type="number" min={1} step={1} value={en.amount} onChange={e => updateEntry(idx, 'amount', e.target.value)} style={{ flex: 1, padding: '10px 12px' }} placeholder="Montant FCFA" />
                                    <button type="button" onClick={() => removeEntry(idx)} disabled={entries.length === 1} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: entries.length === 1 ? 'not-allowed' : 'pointer', opacity: entries.length === 1 ? 0.4 : 1, padding: 6 }}>
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex-between" style={{ background: 'var(--accent-bg)', borderRadius: 12, padding: '14px 18px' }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 13 }}>Total à débiter</span>
                        <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: 18 }}>{fmtFCFA(totalAmount)}</span>
                    </div>

                    <div>
                        <label>Code PIN (confirmation)</label>
                        <input
                            type="password" inputMode="numeric" maxLength={4} value={pin}
                            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="••••"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting || !isValid}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                        <Send size={18} /> {submitting ? 'Envoi...' : 'Exécuter le paiement'}
                    </button>
                </form>
                )}

                <div className="card" style={{ padding: 28 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>Paies envoyées (cette session)</h2>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px' }}>
                        Traitement asynchrone côté serveur : le statut détaillé par employé n'est pas encore consultable depuis ce portail.
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 560, overflowY: 'auto' }}>
                        {sentBatches.map((bulk, i) => (
                            <div key={bulk.bulkId || i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, background: 'var(--bg-secondary)' }}>
                                <div className="flex-between">
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: 14 }}>{bulk.name}</div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                                            <Clock size={12} /> {new Date(bulk.sentAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · {bulk.entryCount} employé(s)
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontWeight: 800 }}>{fmtFCFA(bulk.totalAmount)}</div>
                                        <span className="status-pill warning">En traitement</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {sentBatches.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Aucune paie groupée envoyée pour le moment.</div>}
                    </div>
                </div>
            </div>
        </div>
    );
}
