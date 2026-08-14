import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ArrowDownLeft, ArrowUpRight, Download, FileText, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

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

    const handleRefund = async (txId: string) => {
        const reason = window.prompt("Motif de l'annulation (obligatoire) :");
        if (!reason) return;
        if (!window.confirm("Êtes-vous sûr de vouloir rembourser cette transaction ?")) return;

        try {
            const res = await fetch(API_URL + '/api/admin/transactions/' + txId + '/refund', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason })
            });
            const data = await res.json();
            if (res.ok) {
                alert("Transaction remboursée.");
                fetchLedger();
            } else {
                alert("Erreur : " + data.error);
            }
        } catch (e: any) {
            alert("Erreur de connexion.");
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

    const exportPDF = () => {
        const doc = new jsPDF('landscape');
        doc.setFontSize(22);
        doc.setTextColor(29, 197, 233);
        doc.text("Mongain - Grand Livre (Ledger AML)", 14, 22);
        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text("Rapport financier general. Genere le : " + new Date().toLocaleString('fr-FR'), 14, 32);
        const tableColumn = ["Date", "Expediteur", "Beneficiaire", "Montant (FCFA)", "Reference", "Statut"];
        const tableRows = filteredTransactions.map(tx => [
            new Date(tx.createdAt).toLocaleString('fr-FR'),
            (tx.senderWallet?.user?.name || 'Systeme') + ' (' + (tx.senderWallet?.user?.phone || 'N/A') + ')',
            (tx.receiverWallet?.user?.name || 'Systeme') + ' (' + (tx.receiverWallet?.user?.phone || 'N/A') + ')',
            tx.amount.toString(),
            tx.reference || tx.id,
            tx.status
        ]);
        autoTable(doc, { head: [tableColumn], body: tableRows, startY: 40, theme: 'grid', styles: { fontSize: 10, cellPadding: 4 }, headStyles: { fillColor: [41, 128, 185], textColor: 255 } });
        doc.save('Mongain_Ledger_' + new Date().toISOString().split('T')[0] + '.pdf');
    };

    return (
        <div className="dashboard-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Grand Livre (Ledger AML)</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Surveillance en temps réel de tous les flux financiers de la plateforme.</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={exportCSV} style={{ padding: '12px 20px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                        <Download size={18} />
                        CSV
                    </button>
                    <button onClick={exportPDF} style={{ padding: '12px 20px', backgroundColor: '#e11d48', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                        <FileText size={18} />
                        Télécharger PDF
                    </button>
                </div>
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
                                <th style={{ padding: '16px', color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
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
                                                backgroundColor: tx.status === 'COMPLETED' ? '#10B98120' : tx.status === 'REFUNDED' ? '#E11D4820' : '#F59E0B20',
                                                color: tx.status === 'COMPLETED' ? '#10B981' : tx.status === 'REFUNDED' ? '#E11D48' : '#F59E0B'
                                            }}>
                                                {tx.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            {tx.status === 'COMPLETED' && !isMint && !isFee && !isDeposit && (
                                                <button
                                                    onClick={() => handleRefund(tx.id)}
                                                    style={{
                                                        padding: '4px 8px', backgroundColor: 'transparent',
                                                        color: '#E11D48', border: '1px solid #E11D4860',
                                                        borderRadius: '6px', cursor: 'pointer',
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 'bold'
                                                    }}>
                                                    <RotateCcw size={14} /> Refund
                                                </button>
                                            )}
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
