import { ArrowDownLeft, ArrowUpRight, Search, ShieldCheck, User } from 'lucide-react';
import { useState } from 'react';
import { API_URL } from './config';

export default function TellerTerminal({ token }: { token: string }) {
    const [phone, setPhone] = useState('');
    const [client, setClient] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [amount, setAmount] = useState('');

    // Search Client in the Global Ledger
    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setClient(null);
        setLoading(true);

        try {
            const resp = await fetch(`${API_URL}/api/admin/teller/lookup/${phone}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data.error);
            setClient(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Customer gives Cash -> Teller credits e-Wallet
    const handleDeposit = async () => {
        if (!amount || parseFloat(amount) <= 0) return alert('Montant invalide');
        if (!window.confirm(`Confirmez-vous avoir reçu ${amount} FCFA en espèces de ${client.name} ?`)) return;

        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/teller/deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ phone: client.phone, amount: parseFloat(amount) })
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data.error);
            alert(data.message);
            setAmount('');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    // Customer wants Cash -> Teller debits e-Wallet
    const handleWithdraw = async () => {
        if (!amount || parseFloat(amount) <= 0) return alert('Montant invalide');
        if (!window.confirm(`Veuillez vérifier l'identité de ${client.name}. Confirmez-vous le retrait de ${amount} FCFA ?`)) return;

        setActionLoading(true);
        try {
            const resp = await fetch(`${API_URL}/api/admin/teller/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ phone: client.phone, amount: parseFloat(amount) })
            });
            const data = await resp.json();

            if (!resp.ok) throw new Error(data.error);
            alert(data.message);
            setAmount('');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 50 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Guichet Bancaire (Opérations)</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '5px 0' }}>Saisie des numéros clients pour dépôts et retraits physiques.</p>
                </div>
            </div>

            <div className="card" style={{ padding: 25, marginBottom: 20 }}>
                <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10 }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                        <Search size={18} style={{ position: 'absolute', top: 12, left: 12, color: 'var(--text-muted)' }} />
                        <input
                            type="text"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="Rechercher un client (ex: +24177000000)"
                            style={{ width: '100%', padding: '10px 10px 10px 38px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 16 }}
                            required
                        />
                    </div>
                    <button type="submit" disabled={loading} style={{ padding: '0 20px', background: 'var(--text-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
                        {loading ? 'Recherche...' : 'Scanner'}
                    </button>
                </form>
                {error && <div style={{ color: 'red', marginTop: 15, fontSize: 14 }}>{error}</div>}
            </div>

            {client && (
                <div className="card" style={{ padding: 30, display: 'flex', flexDirection: 'column', gap: 20 }}>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
                        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                            <User size={30} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <h3 style={{ margin: 0, fontSize: 20 }}>{client.name}</h3>
                            <div style={{ color: 'var(--text-muted)' }}>{client.phone} • Titulaire</div>
                        </div>

                        {client.kycStatus === 'APPROVED' ? (
                            <div style={{ padding: '8px 12px', background: '#ecfdf5', color: '#10b981', borderRadius: 8, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ShieldCheck size={16} /> Identité Vérifiée
                            </div>
                        ) : (
                            <div style={{ padding: '8px 12px', background: '#fef2f2', color: '#ef4444', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                                KYC Non-Vérifié
                            </div>
                        )}
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Montant de l'opération (FCFA)</label>
                        <input
                            type="number"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            placeholder="0 FCFA"
                            style={{ width: '100%', padding: '15px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 24, fontWeight: 'bold' }}
                        />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 10 }}>
                        <button
                            onClick={handleDeposit}
                            disabled={actionLoading}
                            style={{ padding: '15px', background: '#ecfdf5', color: '#10b981', border: '1px solid #10b98150', borderRadius: 12, cursor: actionLoading ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}
                        >
                            <ArrowUpRight size={24} />
                            <div style={{ fontWeight: 700, fontSize: 16 }}>Dépôt d'Espèces</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Le client verse l'argent au guichet</div>
                        </button>

                        <button
                            onClick={handleWithdraw}
                            disabled={actionLoading}
                            style={{ padding: '15px', background: '#fef2f2', color: '#ef4444', border: '1px solid #ef444450', borderRadius: 12, cursor: actionLoading ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}
                        >
                            <ArrowDownLeft size={24} />
                            <div style={{ fontWeight: 700, fontSize: 16 }}>Retrait d'Espèces</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>L'agence remet l'argent au client</div>
                        </button>
                    </div>

                </div>
            )}
        </div>
    );
}
