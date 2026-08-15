import { Building2, Plus, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function Branches({ token }: { token: string }) {
    const [branches, setBranches] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal states
    const [selectedBranch, setSelectedBranch] = useState<any>(null);
    const [fundAmount, setFundAmount] = useState('');

    // Inter-Transfer states
    const [transferSource, setTransferSource] = useState<any>(null);
    const [transferTargetId, setTransferTargetId] = useState('');
    const [transferAmount, setTransferAmount] = useState('');

    const [actionLoading, setActionLoading] = useState(false);

    const [showCreate, setShowCreate] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');
    const [newBranchCity, setNewBranchCity] = useState('');

    const fetchBranches = async () => {
        try {
            const resp = await fetch(API_URL + '/api/admin/branches', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();
            if (resp.ok) setBranches(data);
            else throw new Error(data.error);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBranches();
    }, [token]);

    const handleFund = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(fundAmount);
        if (!amount || amount <= 0) return alert('Montant invalide');

        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/branches/${selectedBranch.id}/fund`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount })
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data.error);

            alert(data.message);
            setSelectedBranch(null);
            setFundAmount('');
            fetchBranches();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleInterTransfer = async (e: React.FormEvent) => {
        e.preventDefault();
        const amount = parseFloat(transferAmount);
        if (!amount || amount <= 0 || !transferTargetId) return alert('Saisie invalide');

        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/branches/inter-transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ sourceBranchId: transferSource.id, targetBranchId: transferTargetId, amount })
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data.error);

            alert(data.message);
            setTransferSource(null);
            setTransferTargetId('');
            setTransferAmount('');
            fetchBranches();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleCreateBranch = async (e: React.FormEvent) => {
        e.preventDefault();
        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/branches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ name: newBranchName, city: newBranchCity })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            alert(`Agence ${data.branch.name} créée avec succès.`);
            setShowCreate(false);
            setNewBranchName('');
            setNewBranchCity('');
            fetchBranches();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) return <div>Chargement des agences...</div>;

    const masterVault = branches.find(b => b.isHQ);
    const regionalBranches = branches.filter(b => !b.isHQ);

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700 }}>Réseau Physique (Agences)</h2>
                    <p style={{ color: 'var(--text-secondary)' }}>Gestion de la liquidité et déploiement de nouvelles succursales.</p>
                </div>
                <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                    <Plus size={18} /> Nouvelle Agence
                </button>
            </div>

            {error && <div style={{ color: 'red', marginBottom: 20 }}>{error}</div>}

            {/* Master Vault */}
            {masterVault && (
                <div className="card" style={{ marginBottom: 40, borderLeft: '4px solid var(--accent)', background: 'linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 20 }}>
                        <div style={{ padding: 12, background: 'var(--accent)', color: 'white', borderRadius: 12 }}>
                            <Building2 size={28} />
                        </div>
                        <div>
                            <h3 style={{ fontSize: 20, margin: 0 }}>Caisse Centrale (HQ)</h3>
                            <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Liquidité disponible pour injection manuelle.</p>
                        </div>
                    </div>
                </div>
            )}

            <h3 style={{ fontSize: 18, marginBottom: 15, color: 'var(--text-secondary)' }}>Succursales & Agences</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                {regionalBranches.map(branch => (
                    <div key={branch.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h4 style={{ margin: 0, fontSize: 16 }}>{branch.name}</h4>
                                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{branch.city || 'Non défini'} • {branch.staff?.length || 0} employé(s)</span>
                            </div>
                            <div style={{ padding: '4px 8px', background: branch.isActive ? '#ecfdf5' : '#fef2f2', color: branch.isActive ? '#10b981' : '#ef4444', borderRadius: 6, fontSize: 12, fontWeight: 'bold' }}>
                                {branch.isActive ? 'ACTIF' : 'FERMÉ'}
                            </div>
                        </div>

                        <div style={{ padding: '15px', background: 'var(--bg-primary)', borderRadius: 8, textAlign: 'center' }}>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>TIRAGE / FLOAT DISPONIBLE</div>
                            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginTop: 5 }}>
                                {branch.balance.toLocaleString('fr-FR')} <span style={{ fontSize: 14 }}>FCFA</span>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <button
                                onClick={() => setSelectedBranch(branch)}
                                style={{ padding: '10px', background: 'var(--accent-bg)', color: 'var(--accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
                            >
                                <Zap size={15} /> HQ Ingest
                            </button>
                            <button
                                onClick={() => setTransferSource(branch)}
                                style={{ padding: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5 }}
                            >
                                Transfert P2P
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modal Create Branch */}
            {showCreate && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 400, padding: 30 }}>
                        <h3 style={{ marginTop: 0, marginBottom: 5 }}>Déployer une Agence</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 20 }}>Création d'une nouvelle succursale régionale.</p>

                        <form onSubmit={handleCreateBranch}>
                            <div style={{ marginBottom: 15 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Nom de l'Agence</label>
                                <input value={newBranchName} onChange={e => setNewBranchName(e.target.value)} placeholder="Ex: Agence PK8" style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }} required />
                            </div>
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Ville / Emplacement</label>
                                <input value={newBranchCity} onChange={e => setNewBranchCity(e.target.value)} placeholder="Ex: Libreville" style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14 }} required />
                            </div>

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={() => setShowCreate(false)} style={{ flex: 1, padding: 12, background: 'var(--bg-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>Annuler</button>
                                <button type="submit" disabled={actionLoading} style={{ flex: 2, padding: 12, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Créer l'Agence</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Injection */}
            {selectedBranch && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 400, padding: 30 }}>
                        <h3 style={{ marginTop: 0, marginBottom: 5 }}>Ingestion de Liquidité</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
                            Émission de fonds depuis le **Compte Principal (Réserve Digital)** vers le coffre de <strong>{selectedBranch.name}</strong>.
                        </p>

                        <form onSubmit={handleFund}>
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Montant (FCFA)</label>
                                <input type="number" value={fundAmount} onChange={e => setFundAmount(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16 }} required />
                            </div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={() => setSelectedBranch(null)} style={{ flex: 1, padding: 12, background: 'var(--bg-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>Annuler</button>
                                <button type="submit" disabled={actionLoading} style={{ flex: 2, padding: 12, background: '#10b981', color: 'white', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Valider l'injection</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal Inter-Transfer */}
            {transferSource && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 400, padding: 30 }}>
                        <h3 style={{ marginTop: 0, marginBottom: 5 }}>Transfert Inter-Agence (0%)</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
                            Convoyez de la liquidité depuis <strong>{transferSource.name}</strong> vers une autre succursale. (Frais 0%)
                        </p>

                        <form onSubmit={handleInterTransfer}>
                            <div style={{ marginBottom: 15 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Destination (Branche)</label>
                                <select value={transferTargetId} onChange={e => setTransferTargetId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid var(--border)' }} required>
                                    <option value="">Sélectionnez l'agence cible</option>
                                    {branches.filter(b => b.id !== transferSource.id).map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Montant (FCFA)</label>
                                <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16 }} required />
                            </div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={() => setTransferSource(null)} style={{ flex: 1, padding: 12, background: 'var(--bg-primary)', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: 'var(--text-secondary)' }}>Annuler</button>
                                <button type="submit" disabled={actionLoading} style={{ flex: 2, padding: 12, background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>Effectuer le Transfert</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
