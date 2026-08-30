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
    CORPORATE: { label: 'Corporate (Revenus)', icon: Building2, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    EXTERNAL_GATEWAY: { label: 'Passerelle Externe', icon: Repeat, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    TONTINE_VAULT: { label: 'Coffre Tontine', icon: Server, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_SEEG: { label: 'Service Partenaire (SEEG)', icon: ShoppingBag, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_CANAL: { label: 'Service Partenaire (CANAL)', icon: ShoppingBag, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    SERVICE_PARTNER_TELECOM: { label: 'Service Partenaire (Télécom)', icon: ShoppingBag, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
};

function KindBadge({ kind }: { kind: string }) {
    const meta = KIND_META[kind] || { label: 'Compte système', icon: Server, color: 'var(--text-secondary)', bg: 'var(--bg-secondary)' };
    const Icon = meta.icon;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 10, background: meta.bg, color: meta.color }}>
            <Icon size={11} /> {meta.label}
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
                <button onClick={() => { setSelected(null); setTransactions([]); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, marginBottom: 16, padding: 0 }}>
                    <ArrowLeft size={15} /> Retour aux comptes système
                </button>

                <PageHeader
                    title={selected.name}
                    subtitle={selected.kind === 'CENTRAL_TREASURY' ? 'Contrepartie interne de la Trésorerie Centrale.' : 'Compte technique interne — pas un client.'}
                    action={onAdjust && (
                        <button onClick={() => onAdjust(selected.walletId, selected.name)} style={{ padding: '10px 16px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                            Créer un ajustement (Maker/Checker)
                        </button>
                    )}
                />

                <div style={{ display: 'flex', gap: 16, margin: '20px 0 28px' }}>
                    <div className="table-container" style={{ padding: 16, flex: '1 1 240px' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Solde actuel</div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{fmt(selected.balance)}</div>
                    </div>
                    <div className="table-container" style={{ padding: 16, flex: '1 1 240px' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>Type</div>
                        <div style={{ marginTop: 4 }}><KindBadge kind={selected.kind} /></div>
                    </div>
                </div>

                <h3 style={{ fontSize: 16, marginBottom: 12 }}>Historique des mouvements ({transactions.length})</h3>
                <div className="table-container">
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                        <thead><tr><th>Date</th><th>Sens</th><th>Montant</th><th>Contrepartie</th><th>Référence</th><th>Statut</th></tr></thead>
                        <tbody>
                            {detailLoading ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                            ) : transactions.length === 0 ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun mouvement.</td></tr>
                            ) : transactions.map((tx: any) => {
                                const isDebit = tx.senderWallet && tx.senderWallet.id === selected.walletId;
                                const counterparty = isDebit ? tx.receiverWallet : tx.senderWallet;
                                return (
                                    <tr key={tx.id}>
                                        <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{fmtDate(tx.createdAt)}</td>
                                        <td style={{ color: isDebit ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{isDebit ? 'Débit' : 'Crédit'}</td>
                                        <td style={{ fontWeight: 700 }}>{fmt(tx.amount)}</td>
                                        <td>{counterparty?.user?.name || counterparty?.systemAccount?.name || counterparty?.branch?.name || '—'}<div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{counterparty?.user?.phone}</div></td>
                                        <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{tx.reference || tx.id.slice(0, 8)}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{tx.status}</td>
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

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', maxWidth: 360 }}>
                <Search size={15} color="var(--text-muted)" />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Rechercher un compte…"
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
                />
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
                        <tr><th>Compte</th><th>Type</th><th>Solde</th></tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : filteredAccounts.length === 0 ? (
                            <tr><td colSpan={3} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Aucun compte système.</td></tr>
                        ) : filteredAccounts.map(a => (
                            <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => openAccount(a)}>
                                <td style={{ fontWeight: 600 }}>{a.name}</td>
                                <td><KindBadge kind={a.kind} /></td>
                                <td style={{ fontWeight: 700 }}>{fmt(a.balance)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
