import { ArrowDownLeft, ArrowUpRight, Download, FileText, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function Ledger({ token }: { token: string }) {
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [error, setError] = useState('');

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
                setError('');
            } else {
                // Sans ce cas, un 403 laissait croire à un registre vide au lieu d'un
                // accès refusé — les deux affichaient le même "Aucune transaction trouvée."
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Accès au grand livre refusé.');
            }
        } catch (e) {
            console.error(e);
            setError('Impossible de contacter le serveur.');
        } finally {
            setLoading(false);
        }
    };

    const handleRefund = async (tx: any) => {
        const reason = window.prompt("Motif du remboursement (obligatoire) :");
        if (!reason) return;

        const beneficiaryId = tx.senderWallet?.user?.id;
        if (!beneficiaryId) {
            alert("Impossible de déterminer le bénéficiaire du remboursement pour cette transaction.");
            return;
        }

        if (!window.confirm("Soumettre une demande de remboursement pour cette transaction ? Elle devra être validée par un second agent (règle Maker/Checker) avant exécution.")) return;

        try {
            const res = await fetch(API_URL + '/api/admin/refund-requests', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId: tx.id,
                    userId: beneficiaryId,
                    amount: tx.amount,
                    refundType: 'FULL',
                    reason,
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert("Demande de remboursement soumise. Elle apparaît maintenant dans Support > Remboursements, en attente de validation par un second agent.");
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

    // jsPDF + jspdf-autotable (et html2canvas, dont jsPDF dépend) pesaient ~230 Ko à eux
    // seuls dans le bundle principal, chargés sur CHAQUE page de l'admin-web alors qu'ils
    // ne servent qu'à ce seul export PDF ponctuel. Import dynamique : le code n'est
    // récupéré qu'au moment où l'utilisateur clique réellement sur "Exporter PDF".
    const exportPDF = async () => {
        const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
            import('jspdf'),
            import('jspdf-autotable'),
        ]);
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
                    <button onClick={exportCSV} style={{ padding: '12px 20px', backgroundColor: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
                        <Download size={18} />
                        CSV
                    </button>
                    <button onClick={exportPDF} style={{ padding: '12px 20px', backgroundColor: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}>
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
                        border: '1px solid var(--border)', color: 'var(--text-primary)',
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
                                // CIN = cash-in guichet (CashOperationService), PULL = dépôt Mobile Money PVit
                                // (backend/src/routes/wallet.ts POST /pull) — aucune écriture ne génère plus
                                // de préfixe "DEPOSIT" à ce jour, mais on le garde pour compat avec d'anciennes
                                // transactions historiques.
                                const isDeposit = tx.reference?.startsWith('DEPOSIT') || tx.reference?.startsWith('CIN') || tx.reference?.startsWith('PULL');

                                return (
                                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                            {new Date(tx.createdAt).toLocaleString('fr-FR')}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
                                                    <ArrowUpRight size={16} />
                                                    <span style={{ fontWeight: 'bold' }}>{senderName}</span>
                                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>({senderPhone})</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)' }}>
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
                                            {isFee && <span style={{ color: 'var(--warning)', fontWeight: 'bold', marginRight: '4px' }}>[FEE]</span>}
                                            {isMint && <span style={{ color: 'var(--accent)', fontWeight: 'bold', marginRight: '4px' }}>[MINT]</span>}
                                            {isDeposit && <span style={{ color: '#1DC5E9', fontWeight: 'bold', marginRight: '4px' }}>[CASH-IN]</span>}
                                            {tx.reference || tx.id.substring(0, 8)}
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            <span style={{
                                                padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                                                backgroundColor: tx.status === 'COMPLETED' ? 'var(--success-bg)' : tx.status === 'REFUNDED' ? 'var(--danger-bg)' : 'var(--warning-bg)',
                                                color: tx.status === 'COMPLETED' ? 'var(--success)' : tx.status === 'REFUNDED' ? 'var(--danger)' : 'var(--warning)'
                                            }}>
                                                {tx.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', textAlign: 'right' }}>
                                            {tx.status === 'COMPLETED' && !isMint && !isFee && !isDeposit && (
                                                <button
                                                    onClick={() => handleRefund(tx)}
                                                    style={{
                                                        padding: '4px 8px', backgroundColor: 'transparent',
                                                        color: 'var(--danger)', border: '1px solid var(--danger-bg)',
                                                        borderRadius: '6px', cursor: 'pointer',
                                                        display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 'bold'
                                                    }}>
                                                    <RotateCcw size={14} /> Rembourser
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}

                            {filteredTransactions.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                        {error ? `⚠️ ${error}` : 'Aucune transaction trouvée.'}
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
