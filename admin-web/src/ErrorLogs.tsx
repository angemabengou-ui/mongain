import { AlertTriangle, CheckCircle, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

const PAGE_SIZE = 30;

// Journal technique des erreurs backend (intégrations externes, exceptions non gérées) —
// distinct de "Support & Réclamations" (signalements client) : ici ce sont les échecs
// techniques réels, visibles sans avoir à fouiller les logs Render à chaque test.
export default function ErrorLogs({ token }: { token: string }) {
    const [logs, setLogs] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sources, setSources] = useState<string[]>([]);
    const [sourceFilter, setSourceFilter] = useState('');
    const [resolvedFilter, setResolvedFilter] = useState<'unresolved' | 'all' | 'resolved'>('unresolved');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
            if (sourceFilter) params.set('source', sourceFilter);
            if (resolvedFilter === 'resolved') params.set('resolved', 'true');
            else if (resolvedFilter === 'unresolved') params.set('resolved', 'false');
            const data = await apiFetch(`${API_URL}/api/admin/error-logs?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
            // Si on vient de résoudre la dernière erreur d'une page (ou de changer de filtre)
            // et que `page` dépasse maintenant le nombre réel de pages, on se recale au lieu
            // d'afficher une page vide alors que des résultats existent bien sur une page antérieure.
            const newPages = Math.ceil(data.total / PAGE_SIZE) || 1;
            if (page > newPages) { setPage(newPages); return; }
            setLogs(data.logs);
            setTotal(data.total);
            setSources(data.sources || []);
            setError('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Un seul effet, déclenché par page/filtres : changer un filtre remet aussi `page` à 1 dans
    // le même geste (voir les onChange ci-dessous) plutôt que via un effet séparé, qui aurait
    // déclenché un premier fetch avec l'ancienne page avant qu'un second ne le corrige juste après.
    useEffect(() => { fetchLogs(); }, [page, sourceFilter, resolvedFilter]);

    const handleResolve = async (id: string) => {
        setSavingId(id);
        try {
            await apiFetch(`${API_URL}/api/admin/error-logs/${id}/resolve`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
            fetchLogs();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setSavingId(null);
        }
    };

    const formatDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const pages = Math.ceil(total / PAGE_SIZE) || 1;

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Erreurs Système" subtitle="Journal technique des échecs backend (intégrations externes, exceptions non gérées) — pas les signalements client, voir Support & Réclamations pour ça." />
            </div>

            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--danger)', background: 'var(--danger-bg)', padding: '10px 16px', borderRadius: 8, marginBottom: 20 }}>
                    <span style={{ flex: 1 }}>{error}</span>
                    <button onClick={fetchLogs} style={{ padding: '6px 12px', background: 'var(--btn-dark-bg)', color: 'var(--btn-dark-text)', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>Réessayer</button>
                </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20, background: 'var(--bg-card)', padding: '12px 16px', borderRadius: 12, border: '1px solid var(--border)' }}>
                <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                    <option value="">Toutes les sources</option>
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={resolvedFilter} onChange={e => { setResolvedFilter(e.target.value as any); setPage(1); }} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>
                    <option value="unresolved">Non résolues</option>
                    <option value="resolved">Résolues</option>
                    <option value="all">Toutes</option>
                </select>
                <div style={{ flex: 1 }}></div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 700 }}>{total} erreur{total !== 1 ? 's' : ''} au total</div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['Date', 'Source', 'Message', 'Action'].map((h, i) => (
                                <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: h === 'Action' ? 'right' : 'left' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>Chargement...</td></tr>
                        ) : logs.length === 0 ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontWeight: 600 }}>
                                {resolvedFilter === 'unresolved' ? 'Aucune erreur non résolue. 🎉' : resolvedFilter === 'resolved' ? 'Aucune erreur résolue pour l\'instant.' : 'Aucune erreur enregistrée.'}
                            </td></tr>
                        ) : logs.map(log => (
                            <Fragment key={log.id}>
                                <tr style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.2s', backgroundColor: expandedId === log.id ? 'var(--bg-secondary)' : 'transparent' }} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)} onMouseEnter={e => { if (expandedId !== log.id) e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'; }} onMouseLeave={e => { if (expandedId !== log.id) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                    <td style={{ padding: '16px 20px', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 600 }}>{formatDate(log.createdAt)}</td>
                                    <td style={{ padding: '16px 20px' }}>
                                        <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: 'var(--accent-bg)', color: 'var(--accent)' }}>{log.source}</span>
                                    </td>
                                    <td style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, color: 'var(--text-primary)' }}>
                                        <ChevronDown size={16} style={{ transform: expandedId === log.id ? 'rotate(180deg)' : 'none', transition: '0.2s ease', flexShrink: 0, color: 'var(--text-muted)' }} />
                                        <AlertTriangle size={16} color="var(--warning)" style={{ flexShrink: 0 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>{log.message}</span>
                                    </td>
                                    <td style={{ padding: '16px 20px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                        {log.resolved ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: 'var(--success)' }}><CheckCircle size={15} /> Résolue</span>
                                        ) : (
                                            <button
                                                onClick={() => handleResolve(log.id)}
                                                disabled={savingId === log.id}
                                                style={{ padding: '8px 14px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 }}
                                            >
                                                {savingId === log.id ? '...' : 'Marquer résolue'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {expandedId === log.id && (
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                        <td colSpan={4} style={{ padding: '20px 24px', boxShadow: 'inset 0 4px 6px -4px rgba(0,0,0,0.05)' }}>
                                            {log.path && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, fontWeight: 700 }}>Route : <code style={{ padding: '2px 6px', background: 'var(--bg-card)', borderRadius: 4, color: 'var(--text-primary)' }}>{log.path}</code></div>}
                                            <pre style={{ margin: 0, padding: 16, background: '#1e293b', borderRadius: 12, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#f8fafc', fontFamily: 'monospace', border: '1px solid #334155' }}>
                                                {log.details ? (() => { try { return JSON.stringify(JSON.parse(log.details), null, 2); } catch { return log.details; } })() : 'Aucun détail supplémentaire.'}
                                            </pre>
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            {pages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 24, paddingBottom: 24 }}>
                    <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                        <ChevronLeft size={18} />
                    </button>
                    <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 700 }}>Page <span style={{ color: 'var(--text-primary)' }}>{page}</span> sur {pages}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= pages} style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </div>
    );
}
