import axios from 'axios';
import { CheckCircle, DollarSign, FileText, Plus, RefreshCw, Send, Users, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

const fmt = (n: number) => n.toLocaleString('fr-GA');

export default function B2BHub({ token }: { token: string }) {
    const [invoices, setInvoices] = useState<any[]>([]);
    const [payouts, setPayouts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'INVOICES' | 'PAYOUTS'>('INVOICES');

    // Forms
    const [newInvoice, setNewInvoice] = useState({ phone: '', amount: '', description: '' });
    const [payoutName, setPayoutName] = useState('');
    const [payoutEntries, setPayoutEntries] = useState([{ phone: '', amount: '' }]);

    const fetchB2B = async () => {
        setLoading(true);
        try {
            const invRes = await axios.get(`${import.meta.env.VITE_API_URL}/api/b2b/invoices`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setInvoices(invRes.data.invoices || []);

            const payRes = await axios.get(`${import.meta.env.VITE_API_URL}/api/b2b/payouts`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setPayouts(payRes.data.bulks || []);
        } catch (error) {
            console.error("Failed to fetch B2B metrics", error);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchB2B();
    }, [token]);

    const handleCreateInvoice = async () => {
        try {
            await axios.post(`${import.meta.env.VITE_API_URL}/api/b2b/invoices`, {
                customerPhone: newInvoice.phone,
                amount: newInvoice.amount,
                description: newInvoice.description
            }, { headers: { Authorization: `Bearer ${token}` } });

            setNewInvoice({ phone: '', amount: '', description: '' });
            fetchB2B();
            alert("Facture émise !");
        } catch (e: any) {
            alert(e.response?.data?.error || "Erreur de création");
        }
    };

    const handleCreatePayout = async () => {
        try {
            await axios.post(`${import.meta.env.VITE_API_URL}/api/b2b/payouts`, {
                name: payoutName,
                entries: payoutEntries
            }, { headers: { Authorization: `Bearer ${token}` } });

            setPayoutName('');
            setPayoutEntries([{ phone: '', amount: '' }]);
            setActiveTab('PAYOUTS');
            fetchB2B();
            alert("Paie groupée synchronisée avec le Ledger !");
        } catch (e: any) {
            alert(e.response?.data?.error || "Erreur de paiement en masse");
        }
    };

    const StatusBadge = ({ status }: { status: string }) => {
        switch (status) {
            case 'PAID':
            case 'COMPLETED':
            case 'SUCCESS':
                return <span className="status-pill success">{status}</span>;
            case 'PENDING':
            case 'PROCESSING':
                return <span className="status-pill warning">{status}</span>;
            default:
                return <span className="status-pill danger">{status}</span>;
        }
    };

    const tabStyle = (isActive: boolean) => ({
        padding: '16px 24px',
        background: isActive ? 'var(--text-primary)' : 'var(--bg-secondary)',
        color: isActive ? 'var(--bg-primary)' : 'var(--text-secondary)',
        border: `1px solid ${isActive ? 'var(--text-primary)' : 'var(--border)'}`,
        borderRadius: 12,
        fontWeight: 700,
        fontSize: 15,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: isActive ? 'var(--shadow-md)' : 'none',
        transition: 'all 0.2s ease'
    });

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 60 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                <div>
                    <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 12, borderRadius: 12 }}><DollarSign size={28} /></div>
                        Mongain PRO
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Plateforme Business : Facturation B2B & Payouts Massifs</p>
                </div>
                <button
                    onClick={fetchB2B}
                    className="btn-primary"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', boxShadow: 'none' }}
                >
                    <RefreshCw size={20} className={loading ? "spin" : ""} />
                    <span>Synchroniser</span>
                </button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
                <button onClick={() => setActiveTab('INVOICES')} style={tabStyle(activeTab === 'INVOICES')}>
                    <FileText size={20} /> Liens de Paiement (Invoices)
                </button>
                <button onClick={() => setActiveTab('PAYOUTS')} style={tabStyle(activeTab === 'PAYOUTS')}>
                    <Users size={20} /> Paie Groupée (Mass Payouts)
                </button>
            </div>

            {activeTab === 'INVOICES' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 32 }}>
                    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Émettre une Facture</h2>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Téléphone Client</label>
                            <input type="text" value={newInvoice.phone} onChange={e => setNewInvoice({ ...newInvoice, phone: e.target.value })} placeholder="Ex: 074XXXXX" />
                        </div>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Montant (FCFA)</label>
                            <input type="number" value={newInvoice.amount} onChange={e => setNewInvoice({ ...newInvoice, amount: e.target.value })} placeholder="Ex: 50000" />
                        </div>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Description</label>
                            <input type="text" value={newInvoice.description} onChange={e => setNewInvoice({ ...newInvoice, description: e.target.value })} placeholder="Motif de la facture..." />
                        </div>
                        <button onClick={handleCreateInvoice} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', marginTop: 'auto' }}>
                            <Plus size={20} /> Générer
                        </button>
                    </div>

                    <div className="table-container">
                        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--border)' }}>
                            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Historique des Factures</h2>
                        </div>
                        <table style={{ width: '100%' }}>
                            <thead>
                                <tr>
                                    <th>Référence</th>
                                    <th>Date</th>
                                    <th>Client</th>
                                    <th>Montant</th>
                                    <th>Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv: any) => (
                                    <tr key={inv.id}>
                                        <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{inv.id.split('-')[0]}</td>
                                        <td>{new Date(inv.createdAt).toLocaleDateString('fr-GA')}</td>
                                        <td style={{ fontWeight: 600 }}>{inv.customerPhone}</td>
                                        <td style={{ fontWeight: 800, color: 'var(--accent)' }}>{fmt(inv.amount)} FCFA</td>
                                        <td><StatusBadge status={inv.status} /></td>
                                    </tr>
                                ))}
                                {invoices.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucune facture émise.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'PAYOUTS' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 32 }}>
                    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Lancer une Paie (Mass Payout)</h2>
                        <div>
                            <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Nom du Batch</label>
                            <input type="text" value={payoutName} onChange={e => setPayoutName(e.target.value)} placeholder="Ex: Salaires Mars 2026" />
                        </div>

                        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Bénéficiaires</label>
                                <button onClick={() => setPayoutEntries([...payoutEntries, { phone: '', amount: '' }])} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                    <Plus size={16} style={{ marginRight: 4 }} /> Ajouter
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {payoutEntries.map((e, idx) => (
                                    <div key={idx} style={{ display: 'flex', gap: 8 }}>
                                        <input type="text" value={e.phone} onChange={evt => {
                                            const ne = [...payoutEntries]; ne[idx].phone = evt.target.value; setPayoutEntries(ne);
                                        }} style={{ flex: 1, padding: '10px 12px' }} placeholder="Téléphone" />
                                        <input type="number" value={e.amount} onChange={evt => {
                                            const ne = [...payoutEntries]; ne[idx].amount = evt.target.value; setPayoutEntries(ne);
                                        }} style={{ flex: 1, padding: '10px 12px' }} placeholder="Montant" />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button onClick={handleCreatePayout} className="btn-primary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '16px', marginTop: 'auto' }}>
                            <Send size={20} /> Exécuter le Transfert
                        </button>
                    </div>

                    <div className="card" style={{ padding: 32 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 24px' }}>Logs de Distribution</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {payouts.map((bulk: any) => (
                                <div key={bulk.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 20, background: 'var(--bg-secondary)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                        <div>
                                            <h4 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 4px' }}>{bulk.name}</h4>
                                            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{new Date(bulk.createdAt).toLocaleString('fr-GA')}</p>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4 }}>{fmt(bulk.totalAmount)} FCFA</div>
                                            <StatusBadge status={bulk.status} />
                                        </div>
                                    </div>

                                    <div style={{ background: 'var(--bg-primary)', borderRadius: 8, padding: 12 }}>
                                        <table style={{ width: '100%', fontSize: 13 }}>
                                            <tbody>
                                                {bulk.entries.map((entry: any) => (
                                                    <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        <td style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>{entry.phone}</td>
                                                        <td style={{ padding: '8px 0', fontWeight: 600 }}>{fmt(entry.amount)} FCFA</td>
                                                        <td style={{ padding: '8px 0', textAlign: 'right' }}>
                                                            {entry.status === 'SUCCESS' && <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}><CheckCircle size={14} /> Validé</span>}
                                                            {entry.status === 'FAILED' && <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }} title={entry.errorReason}><XCircle size={14} /> Erreur</span>}
                                                            {entry.status === 'PENDING' && <span style={{ color: 'var(--warning)' }}>En cours...</span>}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                            {payouts.length === 0 && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Aucun historique de paie massive.</div>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
