import { Activity, RefreshCw, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, ENDPOINTS } from './api';
import { fmtFCFA, fmtNumber, pickNumber } from './utils/format';

// Forme vérifiée dans backend/src/routes/merchant-portal.ts (GET /dashboard) : { balance,
// todaySalesAmount, todaySalesCount, monthSalesAmount, monthSalesCount }. On lit quand même
// défensivement (plusieurs noms de champs candidats) et on affiche toujours une carte même à 0
// plutôt que de planter ou de la masquer, au cas où cette forme évoluerait encore.
export default function Dashboard({ onSessionExpired }: { onSessionExpired: () => void }) {
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.dashboard);
            setData(res || {});
        } catch (err: any) {
            if (err.name === 'SessionExpiredError') { onSessionExpired(); return; }
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const balance = pickNumber(data, ['balance', 'walletBalance', 'availableBalance']);
    const todayAmount = pickNumber(data, ['todaySalesAmount', 'dailySalesAmount', 'todayAmount']);
    const todayCount = pickNumber(data, ['todaySalesCount', 'dailySalesCount', 'todayCount']);
    const monthAmount = pickNumber(data, ['monthSalesAmount', 'monthlySalesAmount', 'thisMonthSalesAmount']);
    const monthCount = pickNumber(data, ['monthSalesCount', 'monthlySalesCount', 'thisMonthSalesCount']);
    const allTimeAmount = pickNumber(data, ['allTimeSalesAmount', 'totalSalesAmount', 'lifetimeSalesAmount']);

    // Tout champ numérique renvoyé par l'API mais pas encore reconnu par la liste ci-dessus est
    // affiché génériquement plutôt que silencieusement ignoré — filet de sécurité pendant que
    // le backend est encore en développement actif.
    const KNOWN_KEYS = new Set([
        'balance', 'walletBalance', 'availableBalance',
        'todaySalesAmount', 'dailySalesAmount', 'todayAmount',
        'todaySalesCount', 'dailySalesCount', 'todayCount',
        'monthSalesAmount', 'monthlySalesAmount', 'thisMonthSalesAmount',
        'monthSalesCount', 'monthlySalesCount', 'thisMonthSalesCount',
        'allTimeSalesAmount', 'totalSalesAmount', 'lifetimeSalesAmount',
    ]);
    const extraFields = data ? Object.entries(data).filter(([k, v]) => !KNOWN_KEYS.has(k) && (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))))) : [];

    if (loading && !data) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement du tableau de bord...</div>;

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div className="flex-between" style={{ marginBottom: 28 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px' }}>Tableau de Bord</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Vue d'ensemble de votre compte marchand géant.</p>
                </div>
                <button onClick={load} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} /> Actualiser
                </button>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-header flex-between">
                        <div className="stat-icon revenue"><Wallet size={22} /></div>
                    </div>
                    <div className="stat-value">{fmtFCFA(balance ?? 0)}</div>
                    <div className="stat-label">Solde disponible</div>
                </div>

                <div className="stat-card">
                    <div className="stat-header flex-between">
                        <div className="stat-icon volume"><Activity size={22} /></div>
                    </div>
                    <div className="stat-value">{fmtFCFA(todayAmount ?? 0)}</div>
                    <div className="stat-label">Encaissements du jour{typeof todayCount === 'number' ? ` · ${fmtNumber(todayCount)} opération(s)` : ''}</div>
                </div>

                <div className="stat-card">
                    <div className="stat-header flex-between">
                        <div className="stat-icon users"><TrendingUp size={22} /></div>
                    </div>
                    <div className="stat-value">{typeof monthAmount === 'number' ? fmtFCFA(monthAmount) : (typeof allTimeAmount === 'number' ? fmtFCFA(allTimeAmount) : fmtFCFA(0))}</div>
                    <div className="stat-label">
                        {typeof monthAmount === 'number' ? `Encaissements du mois${typeof monthCount === 'number' ? ` · ${fmtNumber(monthCount)} opération(s)` : ''}` : 'Encaissements historiques (total)'}
                    </div>
                </div>
            </div>

            {extraFields.length > 0 && (
                <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, padding: '8px 0' }}>
                        Autres indicateurs renvoyés par le serveur ({extraFields.length})
                    </summary>
                    <div className="stats-grid" style={{ marginTop: 16 }}>
                        {extraFields.map(([key, value]) => (
                            <div className="stat-card" key={key} style={{ padding: 20 }}>
                                <div className="stat-value" style={{ fontSize: 22 }}>{typeof value === 'number' ? fmtNumber(value) : String(value)}</div>
                                <div className="stat-label">{key}</div>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}
