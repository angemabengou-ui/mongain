import { ArrowDownLeft, ArrowUpRight, Download, FileText, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

const STATUS_LABELS: Record<string, string> = {
    PENDING: 'En attente',
    COMPLETED: 'Terminée',
    FAILED: 'Échouée',
    REFUNDED: 'Remboursée',
    CANCELLED: 'Annulée',
};
const statusLabel = (status: string) => STATUS_LABELS[status] || status;

// Un wallet n'a pas toujours de `user` (Wallet.userId est optionnel) : agence, Trésorerie
// Centrale, ou désormais compte système (SystemAccount) — chacun porte son nom sur sa
// propre relation plutôt que sur `.user`.
const counterpartyName = (wallet: any) => wallet?.user?.name || wallet?.systemAccount?.name || wallet?.branch?.name || 'Inconnu';

export default function Ledger({ token, hasPerm }: { token: string; hasPerm: (perms: string[]) => boolean }) {
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
        // Chaînage optionnel complet jusqu'au bout de CHAQUE appel : senderWallet/receiverWallet
        // n'ont pas toujours de `user` (Wallet.userId est optionnel — le wallet d'une agence ou
        // de la Trésorerie Centrale n'en a aucun). Sans le `?.` sur `.includes()`/`.toLowerCase()`
        // eux-mêmes, une transaction de trésorerie (MINT/ISSUANCE/ADJUSTMENT, visibles et
        // étiquetées [MINT] dans ce même écran) faisait planter tout le Ledger dès la moindre
        // recherche : `undefined.includes(s)` lève une exception, pas juste un résultat "non
        // trouvé".
        return (
            tx.reference?.toLowerCase().includes(s) ||
            tx.senderWallet?.user?.phone?.includes(s) ||
            tx.receiverWallet?.user?.phone?.includes(s) ||
            counterpartyName(tx.senderWallet).toLowerCase().includes(s) ||
            counterpartyName(tx.receiverWallet).toLowerCase().includes(s)
        );
    });

    const exportCSV = () => {
        const headers = ["Date", "Expediteur", "Beneficiaire", "Montant", "Reference", "Statut"];
        const rows = filteredTransactions.map(tx => {
            const sender = `${counterpartyName(tx.senderWallet)} (${tx.senderWallet?.user?.phone || '—'})`;
            const receiver = `${counterpartyName(tx.receiverWallet)} (${tx.receiverWallet?.user?.phone || '—'})`;
            return [
                new Date(tx.createdAt).toLocaleString('fr-FR'),
                `"${sender}"`,
                `"${receiver}"`,
                tx.amount,
                tx.reference || tx.id,
                statusLabel(tx.status)
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
            counterpartyName(tx.senderWallet) + ' (' + (tx.senderWallet?.user?.phone || '—') + ')',
            counterpartyName(tx.receiverWallet) + ' (' + (tx.receiverWallet?.user?.phone || '—') + ')',
            tx.amount.toString(),
            tx.reference || tx.id,
            statusLabel(tx.status)
        ]);
        autoTable(doc, { head: [tableColumn], body: tableRows, startY: 40, theme: 'grid', styles: { fontSize: 10, cellPadding: 4 }, headStyles: { fillColor: [41, 128, 185], textColor: 255 } });
        doc.save('Mongain_Ledger_' + new Date().toISOString().split('T')[0] + '.pdf');
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60, position: 'relative' }}>
            <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4, letterSpacing: '-0.02em' }}>Grand Livre (Ledger AML)</h2>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Surveillance en temps réel de tous les flux financiers de la plateforme.</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={exportCSV} style={{ padding: '10px 18px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, transition: '0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                            <Download size={16} /> CSV
                        </button>
                        <button onClick={exportPDF} style={{ padding: '10px 18px', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 13, transition: '0.2s', boxShadow: '0 4px 12px rgba(220, 38, 38, 0.25)' }} onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'} onMouseLeave={e => e.currentTarget.style.transform = 'none'}>
                            <FileText size={16} /> Rapport PDF
                        </button>
                    </div>
                </div>
            </div>

            {/* ── FILTRES ── */}
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 24, padding: 20, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
                <div style={{ position: 'relative', flex: 1, maxWidth: 500 }}>
                    <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Rechercher par Numéro, Référence ou Nom..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px 12px 42px', color: 'var(--text-primary)', fontSize: 14, outline: 'none', transition: 'border-color 0.2s' }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 8px' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>Registre des transactions ({filteredTransactions.length})</span>
            </div>

            {/* ── TABLEAU ── */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Chargement du Ledger...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                {['Date', 'Flux (De / Vers)', 'Montant', 'Référence', 'Statut', 'Actions'].map((h, i) => (
                                    <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: (h === 'Statut' || h === 'Actions') ? 'right' : 'left' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTransactions.map(tx => {
                                const senderName = counterpartyName(tx.senderWallet);
                                const senderPhone = tx.senderWallet?.user?.phone || '—';
                                const receiverName = counterpartyName(tx.receiverWallet);
                                const receiverPhone = tx.receiverWallet?.user?.phone || '—';

                                const isFee = tx.reference?.startsWith('FEE');
                                const isMint = tx.reference?.startsWith('MINT');
                                const isDeposit = tx.reference?.startsWith('DEPOSIT') || tx.reference?.startsWith('CIN') || tx.reference?.startsWith('PULL');

                                return (
                                    <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
                                            {new Date(tx.createdAt).toLocaleString('fr-FR')}
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--danger-bg)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <ArrowUpRight size={12} />
                                                    </div>
                                                    <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 13 }}>{senderName}</span>
                                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>({senderPhone})</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <div style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--success-bg)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <ArrowDownLeft size={12} />
                                                    </div>
                                                    <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 13 }}>{receiverName}</span>
                                                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>({receiverPhone})</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ fontWeight: 900, fontSize: 15, color: 'var(--text-primary)' }}>{tx.amount.toLocaleString('fr-FR')} FCFA</div>
                                        </td>
                                        <td style={{ padding: '16px 20px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {isFee && <span style={{ padding: '2px 6px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', borderRadius: 6, fontSize: 10, fontWeight: 900 }}>FEE</span>}
                                                {isMint && <span style={{ padding: '2px 6px', background: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', borderRadius: 6, fontSize: 10, fontWeight: 900 }}>MINT</span>}
                                                {isDeposit && <span style={{ padding: '2px 6px', background: 'rgba(29, 197, 233, 0.1)', color: '#1DC5E9', borderRadius: 6, fontSize: 10, fontWeight: 900 }}>CASH-IN</span>}
                                                <code style={{ fontSize: 12, background: 'none', padding: 0, color: 'var(--text-secondary)', fontWeight: 600 }}>{tx.reference || tx.id.substring(0, 8)}</code>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                            <span style={{
                                                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
                                                backgroundColor: tx.status === 'COMPLETED' ? 'var(--success-bg)' : tx.status === 'REFUNDED' ? 'var(--danger-bg)' : 'var(--warning-bg)',
                                                color: tx.status === 'COMPLETED' ? 'var(--success)' : tx.status === 'REFUNDED' ? 'var(--danger)' : 'var(--warning)'
                                            }}>
                                                {statusLabel(tx.status)}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                                            {tx.status === 'COMPLETED' && !isMint && !isFee && !isDeposit && hasPerm(['perm_refund_request']) && (
                                                <button
                                                    onClick={() => handleRefund(tx)}
                                                    style={{
                                                        padding: '6px 12px', backgroundColor: 'transparent',
                                                        color: 'var(--danger)', border: '1px solid var(--danger-bg)',
                                                        borderRadius: 8, cursor: 'pointer',
                                                        display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 12, transition: '0.2s'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--danger-bg)'}
                                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                    <RotateCcw size={14} /> Annuler
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}

                            {filteredTransactions.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ padding: 80, textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                        <FileText size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
                                        <div style={{ fontWeight: 600, fontSize: 15 }}>{error ? `⚠️ ${error}` : 'Aucune transaction ne correspond à cette recherche.'}</div>
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
