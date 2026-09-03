import axios from 'axios';
import { CheckCircle, Landmark, RefreshCw, ShieldAlert, TrendingUp, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function WealthManager({ token }: { token: string }) {
    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [stats, setStats] = useState({
        totalAum: 0,
        activeStakers: 0,
        averageApy: 0
    });

    const fetchVaults = async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${API_URL}/api/admin/wealth/vaults`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setVaults(res.data.vaults || []);
            setStats(res.data.stats || { totalAum: 0, activeStakers: 0, averageApy: 0 });
        } catch (error) {
            console.error("Wealth error", error);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchVaults();
    }, [token]);

    return (
        <div className="p-8 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                        <Landmark className="mr-3 text-emerald-600" size={32} /> Mongain Wealth Management
                    </h1>
                    <p className="text-gray-500 mt-1">Plateforme Trésorerie : Surveillance de l'AUM (Assets Under Management)</p>
                </div>
                <button
                    onClick={fetchVaults}
                    className="flex items-center space-x-2 text-emerald-600 hover:text-emerald-800 bg-emerald-50 px-4 py-2 rounded-lg"
                >
                    <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
                    <span>Actualiser DeFi</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-emerald-100 flex items-center">
                    <div className="p-4 bg-emerald-100 rounded-full text-emerald-600 mr-4">
                        <Landmark size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-500">AUM (Fonds Verouillés)</p>
                        <p className="text-2xl font-black text-gray-900">{stats.totalAum.toLocaleString()} FCFA</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100 flex items-center">
                    <div className="p-4 bg-blue-100 rounded-full text-blue-600 mr-4">
                        <Users size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-500">Stakers Actifs</p>
                        <p className="text-2xl font-black text-gray-900">{stats.activeStakers}</p>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-purple-100 flex items-center">
                    <div className="p-4 bg-purple-100 rounded-full text-purple-600 mr-4">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-gray-500">APY Moyen Global</p>
                        <p className="text-2xl font-black text-gray-900">{stats.averageApy}%</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-800">Contrats Smart-Coffre Actifs</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left border-collapse">
                        <thead className="bg-gray-50">
                            <tr className="text-gray-500 text-xs uppercase tracking-wider">
                                <th className="py-3 px-6 font-semibold">Référence</th>
                                <th className="py-3 px-6 font-semibold">Investisseur</th>
                                <th className="py-3 px-6 font-semibold">Capital Locked</th>
                                <th className="py-3 px-6 font-semibold">Rendement (APY)</th>
                                <th className="py-3 px-6 font-semibold">Date de Maturité</th>
                                <th className="py-3 px-6 font-semibold text-right">Statut</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {vaults.map(v => (
                                <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="py-4 px-6 text-sm font-mono text-gray-600">{v.id}</td>
                                    <td className="py-4 px-6 text-sm font-bold text-gray-900">{v.user.name}</td>
                                    <td className="py-4 px-6 font-black text-emerald-600">{v.amount.toLocaleString()} FCFA</td>
                                    <td className="py-4 px-6">
                                        <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold text-sm">
                                            {v.apy * 100}%
                                        </span>
                                    </td>
                                    <td className="py-4 px-6 text-sm text-gray-700">
                                        {new Date(v.lockedUntil).toLocaleDateString()}
                                    </td>
                                    <td className="py-4 px-6 text-right">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center justify-end w-max ml-auto ${v.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                                            }`}>
                                            {v.status === 'ACTIVE' && <CheckCircle size={14} className="mr-1" />}
                                            {v.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {vaults.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={6} className="text-center py-8 text-gray-500">
                                        <ShieldAlert size={48} className="mx-auto mb-4 text-gray-300" />
                                        Aucun contrat d'investissement actif.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
