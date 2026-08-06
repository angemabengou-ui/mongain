import { ArrowDownLeft, ArrowUpRight, Banknote, Calendar, CreditCard, RefreshCcw, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function MerchantDashboard({ token }: { token: string }) {
    const [stats, setStats] = useState<any>(null);
    const [txs, setTxs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        setLoading(true);
        try {
            const [statsRes, txsRes] = await Promise.all([
                fetch(API_URL + '/api/merchant/stats', { headers: { Authorization: `Bearer ${token}` } }),
                fetch(API_URL + '/api/merchant/transactions', { headers: { Authorization: `Bearer ${token}` } })
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (txsRes.ok) setTxs(await txsRes.json());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, []);

    if (loading) return <div className="loading">Mise à jour en direct...</div>;
    if (!stats) return <div className="error">Impossible de charger le dashboard.</div>;

    return (
        <div className="dashboard-content animate-fade">
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(79,70,229,0.1)', color: 'var(--primary)' }}>
                        <TrendingUp size={24} />
                    </div>
                    <div className="stat-info">
                        <h3>Ventes Aujourd'hui</h3>
                        <p>{stats.todaySalesAmount.toLocaleString('fr-FR')} FCFA</p>
                        <span className="badge" style={{ marginTop: 8, display: 'inline-block' }}>{stats.todaySalesCount} transaction(s)</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>
                        <Banknote size={24} />
                    </div>
                    <div className="stat-info">
                        <h3>Solde Actuel Encaissement</h3>
                        <p>{stats.balance.toLocaleString('fr-FR')} FCFA</p>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon" style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: 'var(--warning)' }}>
                        <CreditCard size={24} />
                    </div>
                    <div className="stat-info">
                        <h3>Total Historique Encaissé</h3>
                        <p>{stats.allTimeSalesAmount.toLocaleString('fr-FR')} FCFA</p>
                    </div>
                </div>
            </div>

            <div className="db-controls" style={{ marginTop: 30, marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, color: 'var(--text-primary)' }}>Historique des ventes</h2>
                <button className="btn-secondary" onClick={loadData}>
                    <RefreshCcw size={16} /> Actualiser
                </button>
            </div>

            <div className="table-card">
                <table>
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Référence</th>
                            <th>Date / Heure</th>
                            <th>Montant</th>
                            <th>Client (Numéro)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {txs.map((tx) => {
                            const isCredit = tx.amount > 0;
                            return (
                                <tr key={tx.id}>
                                    <td>
                                        <div className={`status-badge ${isCredit ? 'success' : 'danger'}`}>
                                            {isCredit ? <ArrowDownLeft size={14} style={{ marginRight: 4 }} /> : <ArrowUpRight size={14} style={{ marginRight: 4 }} />}
                                            {isCredit ? 'Encaissement' : 'Retrait / Débit'}
                                        </div>
                                    </td>
                                    <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{tx.reference}</td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Calendar size={14} color="var(--text-secondary)" />
                                            {new Date(tx.createdAt).toLocaleString('fr-FR')}
                                        </div>
                                    </td>
                                    <td style={{ fontWeight: 600, color: isCredit ? 'var(--success)' : 'var(--danger)' }}>
                                        {isCredit ? '+' : '-'}{tx.amount.toLocaleString('fr-FR')} FCFA
                                    </td>
                                    <td>{tx.senderWallet?.user?.phone || 'Compte Inconnu'}</td>
                                </tr>
                            );
                        })}
                        {txs.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-secondary)' }}>
                                    Aucune transaction récente.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
