import { ArrowLeft, Building2, Landmark, Repeat, Search, Server, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

// Comptes techniques (contreparties de double-écriture : Passerelle Externe, Corporate,
// Coffre Tontine, Trésorerie Centrale) — invisibles partout ailleurs dans l'admin (exclus
// des listes clients par rôle, exclus de la recherche globale). Ils pesaient dans des
// totaux (Trésorerie > Portefeuilles Clients) sans qu'aucun écran ne permette de savoir
// QUEL compte précis, ni de voir son historique. Lecture seule ici — toute correction de
// solde passe par le circuit Maker/Checker de Trésorerie (Ajustement), jamais un champ
// éditable directement.
const fmt = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const KIND_META: Record<string, { label: string; icon: any; color: string; bg: string }> = {
    CENTRAL_TREASURY: { label: 'Trésorerie Centrale', icon: Landmark, color: 'var(--accent)', bg: 'var(--accent-bg)' },
    CORPORATE: { label: 'Corporate (Revenus)', icon: Building2, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
    EXTERNAL_GATEWAY: { label: 'Passerelle Externe', icon: Repeat, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
    TONTINE_VAULT: { label: 'Coffre Tontine', icon: Server, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_SEEG: { label: 'Service Partenaire (SEEG)', icon: ShoppingBag, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_CANAL: { label: 'Service Partenaire (CANAL)', icon: ShoppingBag, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_TELECOM: { label: 'Service Partenaire (Télécom)', icon: ShoppingBag, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' },
};

function KindBadge({ kind }: { kind: string }) {
    const meta = KIND_META[kind] || { label: 'Compte système', icon: Server, color: 'var(--text-primary)', bg: 'var(--bg-secondary)' };
    const Icon = meta.icon;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: meta.bg, color: meta.color }}>
            <Icon size={12} /> {meta.label}
        </span>
    );
}

export default function SystemAccounts({ token, onAdjust }: { token: string; onAdjust?: (walletId: string, name: string) => void }) {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const [selected, setSelected] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);

    const fetchList = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/system-accounts`, { headers: { Authorization: `Bearer ${token}` } });
            setAccounts(data.accounts || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const openAccount = async (account: any) => {
        setSelected(account);
        setDetailLoading(true);
        try {
            const data = await apiFetch(`${API_URL}/api/admin/system-accounts/${account.walletId}/transactions`, { headers: { Authorization: `Bearer ${token}` } });
            setTransactions(data.transactions || []);
        } catch (e: any) {
            setError(e.message);
            setSelected(null);
        } finally {
            setDetailLoading(false);
        }
    };

    useEffect(() => { fetchList(); }, []);

    const filteredAccounts = accounts.filter(a => {
        if (!search) return true;
        const s = search.toLowerCase();
        return a.name?.toLowerCase().includes(s);
    });

    if (selected) {
        return (
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                <button onClick={() => { setSelected(null); setTransactions([]); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0, fontWeight: 700 }}>
                    <ArrowLeft size={16} /> Retour aux comptes système
                </button>

                <PageHeader
                    title={selected.name}
                    subtitle={selected.kind === 'CENTRAL_TREASURY' ? 'Contrepartie interne de la Trésorerie Centrale.' : 'Compte technique interne — pas un client.'}
                    action={onAdjust && (
                        <button onClick={() => onAdjust(selected.walletId, selected.name)} style={{ padding: '10px 20px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                            Ajustement Manuel
                        </button>
                    )}
                />

                <div style={{ display: 'flex', gap: 16, margin: '20px 0 32px' }}>
                    <div className="card" style={{ padding: 24, flex: '1 1 240px' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Solde actuel</div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(selected.balance)}</div>
                    </div>
                    <div className="card" style={{ padding: 24, flex: '1 1 240px' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 800 }}>Type</div>
                        <div style={{ marginTop: 8 }}><KindBadge kind={selected.kind} /></div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)', margin: 0 }}>Historique des mouvements ({transactions.length})</h3>
                </div>
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                {['Date', 'Sens', 'Montant', 'Contrepartie', 'Référence', 'Statut'].map((h, i) => (
                                    <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {detailLoading ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Chargement...</td></tr>
                            ) : transactions.length === 0 ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Aucun mouvement.</td></tr>
                            ) : transactions.map((tx: any) => {
                                const isDebit = tx.senderWallet && tx.senderWallet.id === selected.walletId;
                                const counterparty = isDebit ? tx.receiverWallet : tx.senderWallet;
                                return (
                                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                        <td style={{ padding: '16px 20px', color: isDebit ? 'var(--danger)' : 'var(--success)', fontWeight: 800 }}>{isDebit ? 'DÉBIT' : 'CRÉDIT'}</td>
                                        <td style={{ padding: '16px 20px', fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(tx.amount)}</td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{counterparty?.user?.name || counterparty?.systemAccount?.name || counterparty?.branch?.name || '—'}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{counterparty?.user?.phone}</div>
                                        </td>
                                        <td style={{ padding: '16px 20px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>{tx.reference || tx.id.slice(0, 8)}</td>
                                        <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontWeight: 700 }}>{tx.status}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Comptes Système" subtitle="Comptes techniques internes (Trésorerie Centrale, Passerelle Externe, Corporate, Coffre Tontine) — leur solde n'appartient à aucun client, mais il pèse dans les totaux de Trésorerie. Lecture seule ; toute correction passe par le circuit Ajustement (Maker/Checker)." />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', maxWidth: 360 }}>
                <Search size={16} color="var(--text-muted)" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher un compte…"
                    style={{ width: 'auto', flex: '1 1 200px', flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}
                />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 10, marginBottom: 20 }}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{error}</span>
                    <button onClick={fetchList} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Réessayer</button>
                </div>
            )}

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['Compte', 'Type', 'Solde'].map((h, i) => (
                                <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Chargement...</td></tr>
                        ) : filteredAccounts.length === 0 ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Aucun compte système trouvé.</td></tr>
                        ) : filteredAccounts.map(a => (
                            <tr key={a.id} style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onClick={() => openAccount(a)} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td style={{ padding: '16px 20px', fontWeight: 800, color: 'var(--text-primary)' }}>{a.name}</td>
                                <td style={{ padding: '16px 20px' }}><KindBadge kind={a.kind} /></td>
                                <td style={{ padding: '16px 20px', fontWeight: 900, color: 'var(--text-primary)' }}>{fmt(a.balance)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
