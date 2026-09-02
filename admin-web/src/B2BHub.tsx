import axios from 'axios';
import { CheckCircle, DollarSign, FileText, Plus, RefreshCw, Send, Users, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

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
                return <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">{status}</span>;
            case 'PENDING':
            case 'PROCESSING':
                return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-semibold">{status}</span>;
            default:
                return <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">{status}</span>;
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                        <DollarSign className="mr-3 text-blue-600" size={32} /> Mongain PRO
                    </h1>
                    <p className="text-gray-500 mt-1">Plateforme Business : Facturation B2B & Payouts Massifs</p>
                </div>
                <button
                    onClick={fetchB2B}
                    className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 bg-blue-50 px-4 py-2 rounded-lg"
                >
                    <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
                    <span>Synchroniser</span>
                </button>
            </div>

            <div className="flex space-x-4 mb-8">
                <button
                    onClick={() => setActiveTab('INVOICES')}
                    className={`flex items-center px-6 py-3 rounded-lg font-semibold transition-all ${activeTab === 'INVOICES' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-600 shadow border border-gray-200'}`}
                >
                    <FileText className="mr-2" size={20} /> Liens de Paiement (Invoices)
                </button>
                <button
                    onClick={() => setActiveTab('PAYOUTS')}
                    className={`flex items-center px-6 py-3 rounded-lg font-semibold transition-all ${activeTab === 'PAYOUTS' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 shadow border border-gray-200'}`}
                >
                    <Users className="mr-2" size={20} /> Paie Groupée (Mass Payouts)
                </button>
            </div>

            {activeTab === 'INVOICES' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Invoice Generator */}
                    <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                        <h2 className="text-xl font-bold text-gray-800 mb-6">Émettre une Facture</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone Client</label>
                                <input type="text" value={newInvoice.phone} onChange={e => setNewInvoice({ ...newInvoice, phone: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3" placeholder="Ex: 074XXXXX" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Montant (FCFA)</label>
                                <input type="number" value={newInvoice.amount} onChange={e => setNewInvoice({ ...newInvoice, amount: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3" placeholder="Ex: 50000" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <input type="text" value={newInvoice.description} onChange={e => setNewInvoice({ ...newInvoice, description: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3" placeholder="Motif de la facture..." />
                            </div>
                            <button onClick={handleCreateInvoice} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center">
                                <Plus size={20} className="mr-2" /> Générer
                            </button>
                        </div>
                    </div>

                    {/* Invoices List */}
                    <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                        <h2 className="text-xl font-bold text-gray-800 mb-6">Historique des Factures</h2>
                        <table className="min-w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-gray-100 text-gray-500 text-sm">
                                    <th className="pb-3 px-4">Référence</th>
                                    <th className="pb-3 px-4">Date</th>
                                    <th className="pb-3 px-4">Client</th>
                                    <th className="pb-3 px-4">Montant</th>
                                    <th className="pb-3 px-4">Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                                {invoices.map((inv: any) => (
                                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-4 px-4 font-mono text-sm uppercase text-gray-600">{inv.id.split('-')[0]}</td>
                                        <td className="py-4 px-4 text-sm text-gray-700">{new Date(inv.createdAt).toLocaleDateString()}</td>
                                        <td className="py-4 px-4 font-semibold text-gray-900">{inv.customerPhone}</td>
                                        <td className="py-4 px-4 font-bold text-blue-600">{inv.amount.toLocaleString()} FCFA</td>
                                        <td className="py-4 px-4">
                                            <StatusBadge status={inv.status} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'PAYOUTS' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Generator */}
                    <div className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-indigo-100">
                        <h2 className="text-xl font-bold text-gray-800 mb-6">Lancer une Paie</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du Batch</label>
                                <input type="text" value={payoutName} onChange={e => setPayoutName(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3" placeholder="Ex: Salaires Mars 2026" />
                            </div>

                            <div className="border border-indigo-100 rounded-lg p-4 bg-indigo-50/30">
                                <h3 className="font-semibold text-indigo-900 mb-3 flex items-center justify-between">
                                    Bénéficiaires
                                    <button onClick={() => setPayoutEntries([...payoutEntries, { phone: '', amount: '' }])} className="text-indigo-600 text-sm font-bold flex items-center hover:underline">
                                        <Plus size={16} className="mr-1" /> Ajouter
                                    </button>
                                </h3>
                                {payoutEntries.map((e, idx) => (
                                    <div key={idx} className="flex space-x-2 mb-2">
                                        <input type="text" value={e.phone} onChange={evt => {
                                            const ne = [...payoutEntries]; ne[idx].phone = evt.target.value; setPayoutEntries(ne);
                                        }} className="w-1/2 border border-gray-300 rounded-md p-2 text-sm" placeholder="Téléphone" />
                                        <input type="number" value={e.amount} onChange={evt => {
                                            const ne = [...payoutEntries]; ne[idx].amount = evt.target.value; setPayoutEntries(ne);
                                        }} className="w-1/2 border border-gray-300 rounded-md p-2 text-sm" placeholder="Montant" />
                                    </div>
                                ))}
                            </div>

                            <button onClick={handleCreatePayout} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center">
                                <Send size={20} className="mr-2" /> Exécuter le Transfert
                            </button>
                        </div>
                    </div>

                    {/* Batches */}
                    <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                        <h2 className="text-xl font-bold text-gray-800 mb-6">Logs de Distribution</h2>
                        <div className="space-y-4">
                            {payouts.map((bulk: any) => (
                                <div key={bulk.id} className="border border-gray-200 rounded-xl p-4">
                                    <div className="flex justify-between items-center mb-4">
                                        <div>
                                            <h4 className="font-bold text-lg text-gray-900">{bulk.name}</h4>
                                            <p className="text-sm text-gray-500">{new Date(bulk.createdAt).toLocaleString()}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-xl text-indigo-600">{bulk.totalAmount.toLocaleString()} FCFA</p>
                                            <StatusBadge status={bulk.status} />
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg p-3 text-sm">
                                        <table className="w-full text-left">
                                            <tbody>
                                                {bulk.entries.map((entry: any) => (
                                                    <tr key={entry.id} className="border-b border-gray-200 last:border-0">
                                                        <td className="py-2 text-gray-700">{entry.phone}</td>
                                                        <td className="py-2 font-semibold text-gray-900">{entry.amount.toLocaleString()} FCFA</td>
                                                        <td className="py-2 text-right text-xs">
                                                            {entry.status === 'SUCCESS' ? <span className="text-green-600 flex items-center justify-end"><CheckCircle size={14} className="mr-1" /> Validé</span> : null}
                                                            {entry.status === 'FAILED' ? <span className="text-red-500 flex items-center justify-end" title={entry.errorReason}><XCircle size={14} className="mr-1" /> Erreur</span> : null}
                                                            {entry.status === 'PENDING' ? <span className="text-yellow-600">En cours...</span> : null}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))}
                            {payouts.length === 0 && <p className="text-gray-500 text-center py-8">Aucun historique de paie massive.</p>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
