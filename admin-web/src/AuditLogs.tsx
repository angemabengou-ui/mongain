import { Activity, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import PageHeader from './components/PageHeader';
import { API_URL } from './config';
import { apiFetch } from './utils/apiFetch';

export default function AuditLogs({ token }: { token: string }) {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const data = await apiFetch(API_URL + '/api/admin/logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setLogs(data);
            setError('');
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Impossible de contacter le serveur.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const formatDate = (iso: string) => {
        return new Date(iso).toLocaleString('fr-FR', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    };

    const filteredLogs = logs.filter((log: any) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return log.admin?.name?.toLowerCase().includes(s) || log.action?.toLowerCase().includes(s) || log.details?.toLowerCase().includes(s);
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <PageHeader title="Journaux d'Audit (Sécurité)" subtitle="Trace complète des actions administratives sensibles et des accès système." />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', maxWidth: 400 }}>
                <Search size={16} color="var(--text-muted)" />
                <input
                    placeholder="Rechercher un administrateur, une action…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}
                />
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                        <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['Horodatage', 'Administrateur', 'Action', 'Détails de l\'évènement'].map((h, i) => (
                                <th key={i} style={{ padding: '16px 20px', color: 'var(--text-muted)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={4} style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600 }}>Chargement des logs...</td></tr>
                        ) : filteredLogs.length === 0 ? (
                            <tr><td colSpan={4} style={{ padding: 60, textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>{error ? `⚠️ ${error}` : 'Aucun log ne correspond à la recherche.'}</td></tr>
                        ) : filteredLogs.map(log => (
                            <tr key={log.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {formatDate(log.createdAt)}
                                </td>
                                <td style={{ padding: '16px 20px', fontWeight: 800 }}>
                                    {log.admin?.name || 'Inconnu / supprimé'} <br />
                                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{log.admin?.phone || '—'}</span>
                                </td>
                                <td style={{ padding: '16px 20px' }}>
                                    <span style={{ padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800, backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}>
                                        {log.action}
                                    </span>
                                </td>
                                <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
                                    <Activity size={12} style={{ marginRight: 6, display: 'inline-block', color: 'var(--text-muted)' }} />
                                    {log.details}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

