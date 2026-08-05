import { API_URL } from './config';
import { ArrowDownLeft, ArrowUpRight, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Ledger({ token }: { token: string }) {
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchLedger();
    }, []);

    const fetchLedger = async () => {
        try {
            const res = await fetch(API_URL + '/api/admin/ledger', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTransactions(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filteredTransactions = transactions.filter(tx => {
        if (!search) return true;
        const s = search.toLowerCase();
        return (
            tx.reference?.toLowerCase().includes(s) ||
            tx.senderWallet?.user?.phone.includes(s) ||
            tx.receiverWallet?.user?.phone.includes(s) ||
            tx.senderWallet?.user?.name.toLowerCase().includes(s) ||
            tx.receiverWallet?.user?.name.toLowerCase().includes(s)
        );
    });

    const exportCSV = () => {
        const headers = ["Date", "Expediteur", "Beneficiaire", "Montant", "Reference", "Statut"];
        const rows = filteredTransactions.map(tx => {
            const sender = `${tx.senderWallet?.user?.name || 'Inconnu'} (${tx.senderWallet?.user?.phone || 'N/A'})`;
            const receiver = `${tx.receiverWallet?.user?.name || 'Inconnu'} (${tx.receiverWallet?.user?.phone || 'N/A'})`;
            return [
                new Date(tx.createdAt).toLocaleString('fr-FR'),
                `"${sender}"`,
                `"${receiver}"`,
                tx.amount,
                tx.reference || tx.id,
                tx.status
            ].join(',');
        });
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `mongain_ledger_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="dashboard-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Grand Livre (Ledger AML)</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Surveillance en temps réel de tous les flux financiers de la plateforme.</p>
                </div>
                <button
                    onClick={exportCSV}
                    style={{ padding: '12px 20px', backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                    Télécharger CSV
                </button>
            </div>

            <div style={{ marginBottom: '24px', position: 'relative' }}>
                <Search size={20} color="var(--text-secondary)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
                <input
                    type="text"
                    placeholder="Rechercher par Numéro, Référence ou Nom..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        width: '100%', padding: '16px 16px 16px 48px',
                        borderRadius: '12px', backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border)', color: 'white',
                        fontSize: '15px'
                    }}
                />
            </div>

            <div className="stat-card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement du Ledger...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Date</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Flux (De / Vers)</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Montant</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Référence</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Statut</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTransactions.map(tx => {
                                const senderName = tx.senderWallet?.user?.name || 'Inconnu';
                                const senderPhone = tx.senderWallet?.user?.phone || 'N/A';
                                const receiverName = tx.receiverWallet?.user?.name || 'Inconnu';
                                const receiverPhone = tx.receiverWallet?.user?.phone || 'N/A';

                                const isFee = tx.reference?.startsWith('FEE');
                                const isMint = tx.reference?.startsWith('MINT');
                                const isDeposit = tx.reference?.startsWith('DEPOSIT');

                                return (
                                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                            {new Date(tx.createdAt).toLocaleString('fr-FR')}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#E11D48' }}>
                                                    <ArrowUpRight size={16} />
                                                    <span style={{ fontWeight: 'bold' }}>{senderName}</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>({senderPhone})</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10B981' }}>
                                                    <ArrowDownLeft size={16} />
                                                    <span style={{ fontWeight: 'bold' }}>{receiverName}</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>({receiverPhone})</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', fontWeight: 'bold', fontSize: '16px' }}>
                                            {tx.amount.toLocaleString('fr-FR')} FCFA
                                        </td>
                                        <td style={{ padding: '16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            {isFee && <span style={{ color: '#F59E0B', fontWeight: 'bold', marginRight: '4px' }}>[FEE]</span>}
                                            {isMint && <span style={{ color: '#4F46E5', fontWeight: 'bold', marginRight: '4px' }}>[MINT]</span>}
                                            {isDeposit && <span style={{ color: '#1DC5E9', fontWeight: 'bold', marginRight: '4px' }}>[CASH-IN]</span>}
                                            {tx.reference || tx.id.substring(0, 8)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <span style={{
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                                                backgroundColor: tx.status === 'COMPLETED' ? '#10B98120' : '#F59E0B20',
                                                color: tx.status === 'COMPLETED' ? '#10B981' : '#F59E0B'
                                            }}>
                                                {tx.status}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}

                            {filteredTransactions.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        Aucune transaction trouvée.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
