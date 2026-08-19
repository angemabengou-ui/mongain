import { API_URL } from './config';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AuditLogs({ token }: { token: string }) {
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

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

    return (
        <div className="dashboard-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                    <h2>Journaux d'Audit (Sécurité)</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Trace complète des actions administratives sensibles.</p>
                </div>
            </div>

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
                            {logs.map(log => (
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
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                                        {error ? `⚠️ ${error}` : "Aucun log d'audit disponible."}
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
