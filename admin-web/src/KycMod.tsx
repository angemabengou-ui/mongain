import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function KycMod({ token }: { token: string }) {
    const [tab, setTab] = useState<'PENDING' | 'APPROVED'>('PENDING');
    const [pending, setPending] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchPending = async () => {
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/admin/users/kyc?status=' + tab, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPending(data);
            } else {
                setError('Erreur lors du chargement des KYC');
            }
        } catch (e) {
            setError('Erreur réseau');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPending();
    }, [tab]);

    const processKyc = async (userId: string, status: 'APPROVED' | 'REJECTED') => {
        if (!confirm(`Confirmez-vous le statut ${status} pour ce dossier ?`)) return;

        try {
            const res = await fetch(API_URL + `/api/admin/users/${userId}/kyc`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ status })
            });

            if (res.ok) {
                alert(`Dossier KYC ${status === 'APPROVED' ? 'approuvé' : 'rejeté'} avec succès !`);
                fetchPending(); // Refresh
            } else {
                const data = await res.json().catch(() => ({}));
                alert(`Erreur API (${res.status}): ${data.error || 'Inconnue'}`);
            }
        } catch (e: any) {
            alert(`Erreur réseau: ${e.message}`);
        }
    };

    return (
        <div className="card" style={{ maxWidth: '900px', margin: '0 auto' }}>
            <h2 style={{ fontSize: '24px', marginBottom: '20px', color: 'var(--accent)' }}>Base KYC & Identité</h2>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                <button onClick={() => setTab('PENDING')} style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', border: 'none', background: tab === 'PENDING' ? 'var(--accent)' : 'var(--bg-card)', color: tab === 'PENDING' ? '#fff' : 'var(--text-primary)', fontWeight: 'bold' }}>
                    Dossiers en attente
                </button>
                <button onClick={() => setTab('APPROVED')} style={{ padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', border: 'none', background: tab === 'APPROVED' ? 'var(--success)' : 'var(--bg-card)', color: tab === 'APPROVED' ? '#fff' : 'var(--text-primary)', fontWeight: 'bold' }}>
                    Identités Certifiées
                </button>
            </div>

            <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                {tab === 'PENDING' ? 'Les dossiers ci-dessous requièrent une validation manuelle.' : 'Liste des clients dont l\'identité a été formellement validée par le siège.'}
            </p>

            {error && <div style={{ color: 'var(--danger)', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ color: 'var(--text-muted)' }}>Chargement...</div>
            ) : pending.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    Aucun dossier KYC en attente ! 🎉
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {pending.map((p) => (
                        <div key={p.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', padding: '20px', marginBottom: '10px' }}>
                            <div>
                                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>{p.name}</h3>
                                <p style={{ margin: '5px 0', color: 'var(--text-muted)' }}>{p.phone} - Soumis le {new Date(p.createdAt).toLocaleDateString()}</p>

                                <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>CNI Recto</p>
                                        {p.idCardFront ? (
                                            <img src={p.idCardFront} alt="CNI Recto" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Manquant</div>
                                        )}
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>CNI Verso</p>
                                        {p.idCardBack ? (
                                            <img src={p.idCardBack} alt="CNI Verso" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Manquant</div>
                                        )}
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '5px' }}>Selfie</p>
                                        {p.selfie ? (
                                            <img src={p.selfie} alt="Selfie" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Manquant</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {tab === 'PENDING' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '150px' }}>
                                    <button onClick={() => processKyc(p.id, 'APPROVED')} style={{ backgroundColor: 'var(--success)', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <Check size={16} /> Approuver (Tier 1)
                                    </button>
                                    <button onClick={() => processKyc(p.id, 'REJECTED')} style={{ backgroundColor: 'var(--danger)', color: 'white', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <X size={16} /> Rejeter
                                    </button>
                                </div>
                            )}

                            {tab === 'APPROVED' && (
                                <div style={{ minWidth: '150px', textAlign: 'right' }}>
                                    <span style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success)', padding: '6px 12px', borderRadius: '12px', fontSize: 13, fontWeight: 'bold' }}>CERTIFIÉ ✅</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
