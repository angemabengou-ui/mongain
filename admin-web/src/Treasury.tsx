import { API_URL } from './config';
import { Landmark, Store } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Treasury({ token }: { token: string }) {
    const [phone, setPhone] = useState('');
    const [amountMint, setAmountMint] = useState('');
    const [amountFund, setAmountFund] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [stats, setStats] = useState<any>(null);
    const [proUsers, setProUsers] = useState<any[]>([]);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const resp = await fetch(API_URL + '/api/admin/stats', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) {
                    setStats(await resp.json());
                }

                const respUsers = await fetch(API_URL + '/api/admin/users', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (respUsers.ok) {
                    const dataUsers = await respUsers.json();
                    setProUsers(dataUsers.filter((u: any) => u.role === 'AGENT' || u.role === 'MERCHANT'));
                }
            } catch (e) {
                console.error(e);
            }
        };
        fetchStats();
    }, [token, message]);

    const handleMint = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setMessage('');
        const formattedAmount = parseFloat(amountMint);
        if (isNaN(formattedAmount) || formattedAmount <= 0) {
            setError('Veuillez fournir un montant valide pour la voûte.');
            return;
        }

        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/admin/mint', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount: formattedAmount }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            setMessage(`✅ ${formattedAmount.toLocaleString('fr-FR')} FCFA ajoutés à la Voûte Centrale !`);
            setAmountMint('');
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    const handleFund = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setMessage('');
        const formattedAmount = parseFloat(amountFund);
        if (!phone || isNaN(formattedAmount) || formattedAmount <= 0) {
            setError('Veuillez sélectionner un bénéficiaire et un montant.');
            return;
        }

        setLoading(true);
        try {
            const resp = await fetch(API_URL + '/api/admin/fund-agent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ phone, amount: formattedAmount }),
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error);

            setMessage(`✅ Transfert de ${formattedAmount.toLocaleString('fr-FR')} FCFA effectué avec succès depuis la Voûte !`);
            setPhone('');
            setAmountFund('');
        } catch (e: any) { setError(e.message); }
        finally { setLoading(false); }
    };

    return (
        <div className="dashboard-content">
            {stats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
                    <div className="stat-card" style={{ backgroundColor: '#10B98115', border: '1px solid #10B98130' }}>
                        <div style={{ fontSize: '13px', color: '#6EE7B7', fontWeight: 'bold' }}>SOLDE RÉSERVE (VOÛTE)</div>
                        <div style={{ fontSize: '24px', fontWeight: '900', color: '#34D399', marginTop: '8px' }}>
                            {stats.reserve?.toLocaleString('fr-FR')} <span style={{ fontSize: '12px' }}>FCFA</span>
                        </div>
                    </div>
                    <div className="stat-card" style={{ backgroundColor: '#3B82F615', border: '1px solid #3B82F630' }}>
                        <div style={{ fontSize: '13px', color: '#93C5FD', fontWeight: 'bold' }}>MONNAIE MINT (TOTAL)</div>
                        <div style={{ fontSize: '24px', fontWeight: '900', color: '#60A5FA', marginTop: '8px' }}>
                            {stats.totalMinted?.toLocaleString('fr-FR')} <span style={{ fontSize: '12px' }}>FCFA</span>
                        </div>
                    </div>
                    <div className="stat-card" style={{ backgroundColor: '#8B5CF615', border: '1px solid #8B5CF630' }}>
                        <div style={{ fontSize: '13px', color: '#C4B5FD', fontWeight: 'bold' }}>DISTRIBUÉ (AGENTS)</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#A78BFA', marginTop: '8px' }}>
                            {stats.mintedToAgents?.toLocaleString('fr-FR')} <span style={{ fontSize: '12px' }}>FCFA</span>
                        </div>
                    </div>
                    <div className="stat-card" style={{ backgroundColor: '#F59E0B15', border: '1px solid #F59E0B30' }}>
                        <div style={{ fontSize: '13px', color: '#FCD34D', fontWeight: 'bold' }}>DISTRIBUÉ (MARCHANDS)</div>
                        <div style={{ fontSize: '24px', fontWeight: '800', color: '#FBBF24', marginTop: '8px' }}>
                            {stats.mintedToMerchants?.toLocaleString('fr-FR')} <span style={{ fontSize: '12px' }}>FCFA</span>
                        </div>
                    </div>
                </div>
            )}

            {error && <div style={{ padding: '16px', backgroundColor: 'var(--danger)', color: 'white', borderRadius: '8px', marginBottom: '20px' }}>{error}</div>}
            {message && <div style={{ padding: '16px', backgroundColor: 'var(--success)', color: 'white', borderRadius: '8px', marginBottom: '20px' }}>{message}</div>}

            <div style={{ display: 'flex', gap: '24px' }}>
                <div className="stat-card" style={{ flex: 1, borderTop: '4px solid #3B82F6', alignSelf: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                        <div style={{ padding: '12px', backgroundColor: '#3B82F620', borderRadius: '12px', color: '#3B82F6' }}>
                            <Landmark size={32} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Banque Centrale (Mint)</h2>
                            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>Créer de la monnaie (Voûte)</p>
                        </div>
                    </div>

                    <form onSubmit={handleMint} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Montant à imprimer (FCFA)</label>
                            <input
                                type="number" placeholder="1000000" value={amountMint} onChange={(e) => setAmountMint(e.target.value)}
                                style={{ padding: '16px', width: '100%', borderRadius: '12px', boxSizing: 'border-box', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white', fontSize: '16px' }}
                            />
                        </div>
                        <button type="submit" disabled={loading} style={{ padding: '16px', backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Émission...' : 'Imprimer → Voûte'}
                        </button>
                    </form>
                </div>

                <div className="stat-card" style={{ flex: 1, borderTop: '4px solid #10B981', alignSelf: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                        <div style={{ padding: '12px', backgroundColor: '#10B98120', borderRadius: '12px', color: '#10B981' }}>
                            <Store size={32} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Pôle Distribution</h2>
                            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>Envoyer depuis la Voûte (Agent)</p>
                        </div>
                    </div>

                    <form onSubmit={handleFund} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Agent / Marchand Bénéficiaire</label>
                            <select value={phone} onChange={(e) => setPhone(e.target.value)} style={{ padding: '16px', width: '100%', borderRadius: '12px', boxSizing: 'border-box', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white', fontSize: '16px', marginBottom: '12px' }}>
                                <option value="">-- Sélectionnez un professionnel --</option>
                                {proUsers.map((u: any) => (<option key={u.phone} value={u.phone}>{u.name} ({u.role})</option>))}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Montant Alloué (FCFA)</label>
                            <input
                                type="number" placeholder="50000" value={amountFund} onChange={(e) => setAmountFund(e.target.value)}
                                style={{ padding: '16px', width: '100%', borderRadius: '12px', boxSizing: 'border-box', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'white', fontSize: '16px' }}
                            />
                        </div>
                        <button type="submit" disabled={loading} style={{ padding: '16px', backgroundColor: '#10B981', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                            {loading ? 'Transfert...' : 'Distribuer (Voûte)'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
