import { API_URL } from './config';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AuditLogs({ token }: { token: string }) {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/admin/logs', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            // Sans le cas d'erreur, un 403 laissait croire à un journal vide au lieu
            // d'un accès refusé.
            if (resp.ok) { setLogs(data); setError(''); }
            else setError(data.error || 'Accès au journal d\'audit refusé.');
        } catch (e) {
            console.error(e);
            setError('Impossible de contacter le serveur.');
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
        <div className="dashboard-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Journaux d'Audit (Sécurité)</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Trace complète des actions administratives sensibles.</p>
                </div>
            </div>

            <input
                placeholder="🔍 Rechercher un administrateur, une action, un détail…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%', maxWidth: 400, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13 }}
            />

            <div className="stat-card" style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement des logs...</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Horodatage</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Administrateur</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Action</th>
                                <th style={{ padding: '16px', color: 'var(--text-secondary)' }}>Détails de l'évènement</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredLogs.map(log => (
                                <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                        {formatDate(log.createdAt)}
                                    </td>
                                    <td style={{ padding: '16px', fontWeight: 'bold' }}>
                                        {log.admin?.name || 'Compte inconnu / supprimé'} <br />
                                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{log.admin?.phone || '—'}</span>
                                    </td>
                                    <td style={{ padding: '16px' }}>
                                        <span style={{
                                            padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold',
                                            backgroundColor: 'var(--accent-bg)', color: 'var(--accent)'
                                        }}>
                                            {log.action}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
                                        <Activity size={12} style={{ marginRight: '6px', display: 'inline-block' }} />
                                        {log.details}
                                    </td>
                                </tr>
                            ))}
                            {filteredLogs.length === 0 && (
                                <tr>
                                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                        {error ? `⚠️ ${error}` : logs.length === 0 ? "Aucun log d'audit disponible." : 'Aucun log ne correspond à la recherche.'}
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
