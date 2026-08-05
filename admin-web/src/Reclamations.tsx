import {
    CheckCircle,
    Clock,
    MessageSquareWarning,
    User
} from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Reclamations({ token }: { token: string }) {
    const [reclamations, setReclamations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchReclamations();
    }, []);

    const fetchReclamations = async () => {
        try {
            const res = await fetch('http://localhost:3000/api/reclamation', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                const data = await res.json();
                setReclamations(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const closeTicket = async (id: string) => {
        if (!window.confirm("Voulez-vous vraiment clôturer ce ticket ?")) return;
        try {
            const res = await fetch(`http://localhost:3000/api/reclamation/${id}/close`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                setReclamations(reclamations.map(r => r.id === id ? { ...r, status: 'CLOSED' } : r));
            }
        } catch (e) {
            console.error(e);
        }
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center' }}>Chargement des tickets...</div>;
    }

    return (
        <div className="dashboard-content">
            <div className="dashboard-header" style={{ marginBottom: 30 }}>
                <h2>Support & Réclamations</h2>
                <p>Gérez les litiges et les requêtes du service client.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {reclamations.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px', color: '#64748b', backgroundColor: 'white', borderRadius: '16px' }}>
                        <MessageSquareWarning size={48} style={{ marginBottom: 12, opacity: 0.5 }} />
                        <p>Aucun ticket de réclamation pour le moment.</p>
                    </div>
                ) : (
                    reclamations.map(rec => (
                        <div key={rec.id} style={{
                            backgroundColor: 'white',
                            padding: '24px',
                            borderRadius: '16px',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '16px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <h3 style={{ margin: 0, fontSize: '18px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {rec.title}
                                        {rec.status === 'OPEN' ? (
                                            <span style={{ fontSize: '12px', backgroundColor: '#FEF3C7', color: '#D97706', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold' }}>EN COURS</span>
                                        ) : (
                                            <span style={{ fontSize: '12px', backgroundColor: '#D1FAE5', color: '#059669', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold' }}>RÉSOLU</span>
                                        )}
                                    </h3>
                                    <div style={{ display: 'flex', gap: '16px', color: '#64748b', fontSize: '14px' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <User size={16} /> {rec.user.name} ({rec.user.phone})
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <Clock size={16} /> {new Date(rec.createdAt).toLocaleString('fr-FR')}
                                        </span>
                                    </div>
                                </div>
                                {rec.status === 'OPEN' && (
                                    <button
                                        onClick={() => closeTicket(rec.id)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            backgroundColor: '#10B981', color: 'white', border: 'none',
                                            padding: '10px 16px', borderRadius: '8px', cursor: 'pointer',
                                            fontWeight: 'bold'
                                        }}
                                    >
                                        <CheckCircle size={18} /> Clôturer
                                    </button>
                                )}
                            </div>

                            <div style={{
                                backgroundColor: '#f8fafc',
                                padding: '16px',
                                borderRadius: '8px',
                                borderLeft: '4px solid #3b82f6',
                                color: '#334155',
                                lineHeight: '1.6'
                            }}>
                                {rec.description}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
