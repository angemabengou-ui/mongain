import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function KycMod({ token }: { token: string }) {
    const [pending, setPending] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchPending = async () => {
        setLoading(true);
        try {
            const res = await fetch(API_URL + '/api/admin/users/kyc', {
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
    }, []);

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
                fetchPending(); // Refresh
            } else {
                alert('Erreur lors du traitement.');
            }
        } catch (e) {
            alert('Erreur réseau.');
        }
    };

    return (
        <div style={{ maxWidth: '900px' }}>
            <h2 style={{ fontSize: '24px', marginBottom: '20px', color: '#6366f1' }}>Modération KYC (Identités)</h2>
            <p style={{ color: '#aaa', marginBottom: '20px' }}>Les dossiers en attente ci-dessous requièrent une validation manuelle pour augmenter leur plafond (Tier 1).</p>

            {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}

            {loading ? (
                <div style={{ color: '#aaa' }}>Chargement...</div>
            ) : pending.length === 0 ? (
                <div style={{ padding: '20px', backgroundColor: 'var(--bg-card)', borderRadius: '8px', textAlign: 'center', color: '#94a3b8' }}>
                    Aucun dossier KYC en attente ! 🎉
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {pending.map((p) => (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: 'var(--bg-card)', padding: '15px', borderRadius: '12px' }}>
                            <div>
                                <h3 style={{ margin: 0, color: '#f8fafc' }}>{p.name}</h3>
                                <p style={{ margin: '5px 0', color: '#94a3b8' }}>{p.phone} - Soumis le {new Date(p.createdAt).toLocaleDateString()}</p>

                                <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>CNI Recto</p>
                                        {p.idCardFront ? (
                                            <img src={p.idCardFront} alt="CNI Recto" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #334155' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Manquant</div>
                                        )}
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>CNI Verso</p>
                                        {p.idCardBack ? (
                                            <img src={p.idCardBack} alt="CNI Verso" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #334155' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Manquant</div>
                                        )}
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                        <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '5px' }}>Selfie</p>
                                        {p.selfie ? (
                                            <img src={p.selfie} alt="Selfie" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #334155' }} />
                                        ) : (
                                            <div style={{ width: '120px', height: '80px', backgroundColor: 'var(--bg-secondary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>Manquant</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', justifyContent: 'center' }}>
                                <button
                                    onClick={() => processKyc(p.id, 'APPROVED')}
                                    style={{ backgroundColor: '#10b981', color: 'var(--text-primary)', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <Check size={16} /> Approuver (Tier 1)
                                </button>
                                <button
                                    onClick={() => processKyc(p.id, 'REJECTED')}
                                    style={{ backgroundColor: '#ef4444', color: 'var(--text-primary)', border: 'none', padding: '8px 15px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <X size={16} /> Rejeter
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
