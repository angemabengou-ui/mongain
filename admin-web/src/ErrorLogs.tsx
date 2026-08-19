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

    useEffect(() => { fetchLogs(); }, [page, sourceFilter, resolvedFilter]);
    useEffect(() => { setPage(1); }, [sourceFilter, resolvedFilter]);

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

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <option value="">Toutes les sources</option>
                    {sources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <select value={resolvedFilter} onChange={e => setResolvedFilter(e.target.value as any)} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <option value="unresolved">Non résolues</option>
                    <option value="resolved">Résolues</option>
                    <option value="all">Toutes</option>
                </select>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{total} erreur{total !== 1 ? 's' : ''}</div>
            </div>

            <div className="table-container">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Source</th>
                            <th>Message</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                        ) : logs.length === 0 ? (
                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                                {resolvedFilter === 'unresolved' ? 'Aucune erreur non résolue. 🎉' : 'Aucune erreur enregistrée.'}
                            </td></tr>
                        ) : logs.map(log => (
                            <Fragment key={log.id}>
                                <tr style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                                    <td style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{formatDate(log.createdAt)}</td>
                                    <td>
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: 'var(--accent-bg)', color: 'var(--accent)' }}>{log.source}</span>
                                    </td>
                                    <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <ChevronDown size={14} style={{ transform: expandedId === log.id ? 'rotate(180deg)' : 'none', transition: '0.15s', flexShrink: 0 }} />
                                        <AlertTriangle size={14} color="var(--warning)" style={{ flexShrink: 0 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}>{log.message}</span>
                                    </td>
                                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                        {log.resolved ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--success)' }}><CheckCircle size={14} /> Résolue</span>
                                        ) : (
                                            <button
                                                onClick={() => handleResolve(log.id)}
                                                disabled={savingId === log.id}
                                                style={{ padding: '6px 12px', background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                                            >
                                                {savingId === log.id ? '...' : 'Marquer résolue'}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {expandedId === log.id && (
                                    <tr>
                                        <td colSpan={4} style={{ background: 'var(--bg-secondary)', padding: '14px 20px' }}>
                                            {log.path && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>Route : <code>{log.path}</code></div>}
                                            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                    <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page <= 1 ? 'not-allowed' : 'pointer', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        <ChevronLeft size={16} />
                    </button>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} / {pages} · {total} au total</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= pages} style={{ padding: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: page >= pages ? 'not-allowed' : 'pointer', color: page >= pages ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
