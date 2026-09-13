import { BarChart3, FileDown, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, ENDPOINTS } from './api';
import { fmtFCFA, fmtNumber, pickNumber, pickString } from './utils/format';

type ReportPoint = {
    label: string;
    amount: number;
    count?: number;
};

// Forme vérifiée dans backend/src/routes/merchant-portal.ts (GET /reports) :
// { period, series: [{ period: label, amount, count }] } — label ISO "YYYY-MM-DD" (jour) ou
// "YYYY-MM" (mois). On accepte quand même un tableau brut ou d'autres clés usuelles
// (series/data/report/points) et on lit chaque point défensivement, au cas où cette forme
// évoluerait encore.
function normalizeSeries(raw: any): ReportPoint[] {
    const arr: any[] = Array.isArray(raw) ? raw : (raw?.series || raw?.data || raw?.report || raw?.points || []);
    if (!Array.isArray(arr)) return [];
    return arr.map((item, idx) => ({
        label: pickString(item, ['label', 'date', 'day', 'month', 'period']) || `#${idx + 1}`,
        amount: pickNumber(item, ['amount', 'total', 'sum', 'salesAmount', 'value']) ?? 0,
        count: pickNumber(item, ['count', 'salesCount', 'transactions', 'transactionCount']),
    }));
}

function formatLabel(label: string): string {
    // Si le backend renvoie une date ISO, on l'affiche en format local lisible ; sinon on
    // garde le libellé tel quel (ex: "2026-09" ou "Semaine 37").
    const d = new Date(label);
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}(-\d{2})?/.test(label)) {
        return label.length > 7
            ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
            : d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }
    return label;
}

export default function Reports({ onSessionExpired }: { onSessionExpired: () => void }) {
    const [period, setPeriod] = useState<'day' | 'month'>('day');
    const [points, setPoints] = useState<ReportPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = async (p: 'day' | 'month') => {
        setLoading(true);
        setError('');
        try {
            const res = await apiRequest(ENDPOINTS.reports(p));
            setPoints(normalizeSeries(res));
        } catch (err: any) {
            if (err.name === 'SessionExpiredError') { onSessionExpired(); return; }
            setError(err.message);
            setPoints([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(period); }, [period]);

    const maxAmount = Math.max(1, ...points.map(p => p.amount));
    const totalAmount = points.reduce((sum, p) => sum + p.amount, 0);

    // Export CSV généré entièrement côté client à partir des points déjà chargés (pas de
    // nouvelle route backend) : colonnes période / montant / nombre d'opérations, montants FCFA
    // arrondis en entiers (jamais de décimales). BOM UTF-8 en tête pour qu'Excel affiche
    // correctement les accents français à l'ouverture directe du fichier. Téléchargement via le
    // pattern standard Blob + <a download> temporaire, sans dépendance supplémentaire.
    const handleExportCsv = () => {
        if (points.length === 0) return;
        const header = ['Période', 'Montant (FCFA)', "Nombre d'opérations"];
        const rows = points.map(p => [
            formatLabel(p.label),
            String(Math.round(p.amount)),
            typeof p.count === 'number' ? String(Math.round(p.count)) : '',
        ]);
        const escapeCell = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
        const csv = '﻿' + [header, ...rows].map(row => row.map(escapeCell).join(';')).join('\r\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const periodLabel = period === 'month' ? 'mensuel' : 'journalier';
        const now = new Date();
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const link = document.createElement('a');
        link.href = url;
        link.download = `rapport-mongain-${periodLabel}-${stamp}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 40 }}>
            <div className="flex-between" style={{ marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'var(--accent-bg)', color: 'var(--accent)', padding: 10, borderRadius: 12, display: 'flex' }}><BarChart3 size={22} /></div>
                        Rapports
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>Historique de vos encaissements.</p>
                </div>

                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ display: 'flex', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 4 }}>
                        <button
                            onClick={() => setPeriod('day')}
                            style={{
                                padding: '10px 18px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                                background: period === 'day' ? 'var(--accent)' : 'transparent',
                                color: period === 'day' ? '#fff' : 'var(--text-secondary)'
                            }}
                        >
                            Par jour
                        </button>
                        <button
                            onClick={() => setPeriod('month')}
                            style={{
                                padding: '10px 18px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                                background: period === 'month' ? 'var(--accent)' : 'transparent',
                                color: period === 'month' ? '#fff' : 'var(--text-secondary)'
                            }}
                        >
                            Par mois
                        </button>
                    </div>
                    <button onClick={handleExportCsv} disabled={points.length === 0} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileDown size={16} /> Exporter en CSV
                    </button>
                    <button onClick={() => load(period)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RefreshCw size={16} className={loading ? 'spin' : ''} /> Actualiser
                    </button>
                </div>
            </div>

            {error && <div className="banner error mb-8">⚠️ {error}</div>}

            <div className="stat-card" style={{ marginBottom: 24 }}>
                <div className="stat-value">{fmtFCFA(totalAmount)}</div>
                <div className="stat-label">Total encaissé sur la période affichée{points.length > 0 ? ` · ${points.length} période(s)` : ''}</div>
            </div>

            <div className="card">
                {loading ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement...</div>
                ) : points.length === 0 ? (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Aucune donnée pour cette période.</div>
                ) : (
                    <div>
                        {points.map((p, idx) => (
                            <div className="bar-row" key={idx}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{formatLabel(p.label)}</div>
                                <div className="bar-track">
                                    <div className="bar-fill" style={{ width: `${Math.max(2, Math.round((p.amount / maxAmount) * 100))}%` }} />
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>
                                    {fmtFCFA(p.amount)}
                                    {typeof p.count === 'number' && (
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{fmtNumber(p.count)} op.</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {points.length > 0 && (
                <div className="table-container" style={{ marginTop: 24 }}>
                    <table>
                        <thead>
                            <tr>
                                <th>Période</th>
                                <th>Montant</th>
                                <th>Nombre d'opérations</th>
                            </tr>
                        </thead>
                        <tbody>
                            {points.map((p, idx) => (
                                <tr key={idx}>
                                    <td>{formatLabel(p.label)}</td>
                                    <td style={{ fontWeight: 700 }}>{fmtFCFA(p.amount)}</td>
                                    <td>{typeof p.count === 'number' ? fmtNumber(p.count) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
