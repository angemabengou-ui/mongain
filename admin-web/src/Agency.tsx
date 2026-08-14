import { ArrowDownCircle, ArrowUpCircle, CheckCircle, Printer, QrCode, ShieldCheck, User2, Wallet } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function Agency({ token, agentPhone, agentName }: { token: string, agentPhone: string, agentName: string }) {
    const [action, setAction] = useState<'deposit' | 'withdraw' | 'qr' | 'history'>('deposit');
    const [phone, setPhone] = useState('+241');
    const [amount, setAmount] = useState('');
    const [balance, setBalance] = useState<number | null>(null);

    const [history, setHistory] = useState<any[]>([]);

    const [loading, setLoading] = useState(false);
    const [successMessage, setSuccessMessage] = useState('');
    const [error, setError] = useState('');

    const handlePrint = () => {
        const svgElement = document.querySelector('.print-only svg');
        const svgStr = svgElement ? svgElement.outerHTML : '';

        const printWindow = window.open('', '_blank', 'width=800,height=900');
        if (!printWindow) {
            alert('Veuillez autoriser les pop-ups pour imprimer.');
            return;
        }

        printWindow.document.write(`
            <html>
                <head>
                    <title>Affiche QR - Mongain Agence</title>
                    <style>
                        body { text-align: center; font-family: 'Inter', sans-serif; padding: 40px; background: white; color: black; }
                        .title { font-size: 60px; font-weight: 900; margin-bottom: 20px; letter-spacing: -2px; }
                        .subtitle { font-size: 24px; color: #555; margin-bottom: 60px; font-weight: 700; text-transform: uppercase; letter-spacing: 4px; }
                        .qr-box { padding: 40px; border: 6px solid #111; border-radius: 40px; display: inline-block; background: white; }
                        .footer { margin-top: 60px; }
                        .agent-name { font-size: 32px; font-weight: 800; }
                        .agent-phone { font-size: 24px; color: #333; margin-top: 15px; }
                    </style>
                </head>
                <body>
                    <div class="title">MONGAIN AGENCE</div>
                    <div class="subtitle">Scannez pour retirer des espèces</div>
                    <div class="qr-box">${svgStr}</div>
                    <div class="footer">
                        <div class="agent-name">Agent: ${agentName}</div>
                        <div class="agent-phone">Tel: ${agentPhone}</div>
                    </div>
                    <script>
                        window.onload = () => {
                            window.print();
                        };
                    </script>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
    };

    const fetchBalance = async () => {
        try {
            const res = await fetch(API_URL + '/api/wallet/balance', {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (res.ok) setBalance(data.balance);
        } catch (e) {
            console.error("Could not fetch balance", e);
        }
    };

    useEffect(() => {
        fetchBalance();
        const interval = setInterval(fetchBalance, 10000);
        return () => clearInterval(interval);
    }, [token]);

    const fetchHistory = async () => {
        try {
            const res = await fetch(API_URL + '/api/wallet/history', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) setHistory(await res.json());
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (action === 'history') fetchHistory();
    }, [action]);

    const [agentPin, setAgentPin] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setLoading(true);

        const numAmount = parseFloat(amount);
        if (action === 'deposit' && (isNaN(numAmount) || numAmount <= 0)) {
            setError('Veuillez entrer un montant valide.');
            setLoading(false);
            return;
        }

        try {
            if (action === 'deposit') {
                if (!agentPin || agentPin.length !== 4) throw new Error('Veuillez entrer votre code PIN PIN Agent (4 chiffres).');

                // Le Dépôt = L'Agent transfère son argent numérique au Client
                const res = await fetch(API_URL + '/api/wallet/transfer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ receiverPhone: phone, amount: numAmount, pin: agentPin })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || data.message || 'Erreur transfert');

                setSuccessMessage(`Dépôt effectué avec succès vers le client ${phone}.`);
            } else if (action === 'withdraw') {
                // Le Retrait distant nécessite que l'Agent envoie une notification PUSH au client
                const res = await fetch(API_URL + '/api/wallet/request-withdraw', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ targetPhone: phone, amount: numAmount })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);

                setSuccessMessage(`Demande de validation envoyée au client ! Préparez ${numAmount.toLocaleString('fr-FR')} FCFA en espèces.`);
            }
            fetchBalance(); // Refresh balance immediately after success
            // Reset fields (except phone to ease next operation)
            setAmount('');
            setAgentPin('');
        } catch (err: any) {
            setError(err.message || 'Une erreur est survenue.');
        } finally {
            setLoading(false);
        }
    };

    const qrData = `mongain://agent-withdraw-desk?phone=${encodeURIComponent(agentPhone || '')}&name=${encodeURIComponent(agentName || '')}`;

    return (
        <>
            <div style={{ maxWidth: 1000, margin: '0 auto', width: '100%' }}>

                {/* Header Dashboard Agent */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40, borderBottom: '1px solid var(--glass-border)', paddingBottom: 20 }}>
                    <div>
                        <h1 style={{ fontSize: '28px', margin: 0, fontWeight: 800, color: 'var(--text-primary)' }}>Espace Guichet</h1>
                        <p style={{ color: 'var(--text-secondary)', marginTop: 5, fontSize: 16 }}>Agent : <strong style={{ color: 'var(--text-primary)' }}>{agentName}</strong></p>
                    </div>

                    {balance !== null && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            padding: '15px 30px',
                            borderRadius: 20,
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            boxShadow: '0 10px 25px rgba(16, 185, 129, 0.15)'
                        }}>
                            <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', padding: 10, borderRadius: 50, marginRight: 15 }}>
                                <Wallet size={24} color="#10b981" />
                            </div>
                            <div>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 1 }}>Caisse Digitale</p>
                                <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{balance.toLocaleString('fr-FR')} <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>FCFA</span></h2>
                            </div>
                        </div>
                    )}
                </div>

                {/* Split POS Layout */}
                <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 30 }}>

                    {/* Menu de sélection d'Opération */}
                    <div className="card" style={{ padding: 20 }}>
                        <h3 style={{ marginBottom: 20, color: 'var(--text-secondary)', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Opération</h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                            <button
                                style={{
                                    display: 'flex', alignItems: 'center', padding: '16px 20px', borderRadius: 16, cursor: 'pointer',
                                    background: action === 'deposit' ? 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(99,102,241,0.1))' : 'var(--bg-secondary)',
                                    border: `1px solid ${action === 'deposit' ? 'var(--accent)' : 'var(--glass-border)'}`,
                                    color: action === 'deposit' ? 'var(--accent-light)' : 'var(--text-primary)',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'left'
                                }}
                                onClick={() => { setAction('deposit'); setSuccessMessage(''); setError(''); }}
                            >
                                <div style={{ width: 40, height: 40, borderRadius: 20, background: action === 'deposit' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                                    <ArrowDownCircle size={20} color="#fff" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>Dépôt Espèces</div>
                                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Alimenter un compte Client</div>
                                </div>
                            </button>

                            <button
                                style={{
                                    display: 'flex', alignItems: 'center', padding: '16px 20px', borderRadius: 16, cursor: 'pointer',
                                    background: action === 'withdraw' ? 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.1))' : 'var(--bg-secondary)',
                                    border: `1px solid ${action === 'withdraw' ? '#f59e0b' : 'var(--glass-border)'}`,
                                    color: action === 'withdraw' ? '#fcd34d' : 'var(--text-primary)',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'left'
                                }}
                                onClick={() => { setAction('withdraw'); setSuccessMessage(''); setError(''); }}
                            >
                                <div style={{ width: 40, height: 40, borderRadius: 20, background: action === 'withdraw' ? '#f59e0b' : 'rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                                    <ArrowUpCircle size={20} color="#fff" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>Retrait Espèces</div>
                                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Paiement à un Client</div>
                                </div>
                            </button>

                            <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />

                            <button
                                style={{
                                    display: 'flex', alignItems: 'center', padding: '16px 20px', borderRadius: 16, cursor: 'pointer',
                                    background: action === 'qr' ? 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.1))' : 'var(--bg-secondary)',
                                    border: `1px solid ${action === 'qr' ? '#10b981' : 'var(--glass-border)'}`,
                                    color: action === 'qr' ? '#6ee7b7' : 'var(--text-primary)',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'left'
                                }}
                                onClick={() => { setAction('qr'); setSuccessMessage(''); setError(''); }}
                            >
                                <div style={{ width: 40, height: 40, borderRadius: 20, background: action === 'qr' ? '#10b981' : 'rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                                    <QrCode size={20} color="#fff" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>Code QR Agence</div>
                                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Vitrine Client Fixe</div>
                                </div>
                            </button>

                            <div style={{ height: 1, background: 'var(--glass-border)', margin: '10px 0' }} />

                            <button
                                style={{
                                    display: 'flex', alignItems: 'center', padding: '16px 20px', borderRadius: 16, cursor: 'pointer',
                                    background: action === 'history' ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                                    border: `1px solid ${action === 'history' ? 'var(--accent)' : 'var(--glass-border)'}`,
                                    color: action === 'history' ? 'var(--accent)' : 'var(--text-primary)',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'left'
                                }}
                                onClick={() => { setAction('history'); setSuccessMessage(''); setError(''); }}
                            >
                                <div style={{ width: 40, height: 40, borderRadius: 20, background: action === 'history' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                                    <User2 size={20} color="#fff" />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>Historique de Caisse</div>
                                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>Dépôts & Retraits du jour</div>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Espace de saisie (Right Pane) */}
                    <div className="card" style={{ padding: 40, minHeight: 500, display: 'flex', flexDirection: 'column' }}>

                        {error && (
                            <div style={{ backgroundColor: 'rgba(225, 29, 72, 0.1)', padding: '15px 20px', borderRadius: 12, marginBottom: 25, borderLeft: '4px solid var(--danger)', display: 'flex', alignItems: 'center' }}>
                                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</span>
                            </div>
                        )}

                        {successMessage && (
                            <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '20px', borderRadius: 12, marginBottom: 25, border: '1px solid rgba(16,185,129,0.3)', display: 'flex', alignItems: 'center' }}>
                                <CheckCircle color="#10B981" size={28} style={{ marginRight: 15 }} />
                                <div>
                                    <h4 style={{ color: '#10B981', margin: '0 0 5px 0', fontSize: 18 }}>Opération Réussie</h4>
                                    <p style={{ color: 'var(--text-primary)', margin: 0 }}>{successMessage}</p>
                                </div>
                            </div>
                        )}

                        {action === 'history' && (
                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                <h2 style={{ marginTop: 0 }}>Historique de la Caisse Digitale</h2>
                                <table className="data-table" style={{ width: '100%', marginTop: 20 }}>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Type</th>
                                            <th>Client</th>
                                            <th>Montant</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.length === 0 ? (
                                            <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>Aucune transaction récente.</td></tr>
                                        ) : history.map((tx: any) => {
                                            const isDeposit = tx.senderWallet?.user?.phone === agentPhone; // Agent sent money (Cash Deposit for client)
                                            const counterpart = isDeposit ? tx.receiverWallet?.user : tx.senderWallet?.user;
                                            return (
                                                <tr key={tx.id}>
                                                    <td>{new Date(tx.createdAt).toLocaleString('fr-FR')}</td>
                                                    <td>
                                                        <span className="status-badge" style={{ backgroundColor: isDeposit ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)', color: isDeposit ? 'var(--accent)' : '#f59e0b' }}>
                                                            {isDeposit ? 'DÉPÔT' : 'RETRAIT'}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{counterpart?.name || 'Inconnu'}</div>
                                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{counterpart?.phone}</div>
                                                    </td>
                                                    <td style={{ fontWeight: 800, color: isDeposit ? 'var(--danger)' : '#10b981' }}>
                                                        {isDeposit ? '-' : '+'}{tx.amount.toLocaleString('fr-FR')} F
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {action === 'qr' ? (
                            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, justifyContent: 'center' }}>
                                <h2 style={{ fontSize: 24, marginBottom: 15, fontWeight: 700 }}>Affiche QR Code (Libre-Service)</h2>
                                <p style={{ color: 'var(--text-secondary)', maxWidth: 400, marginBottom: 40, lineHeight: 1.5 }}>
                                    Placer ce QR Code sur votre comptoir vitré permet à vos clients de scanner avec leur application Mongain et d'initier un retrait d'espèces eux-mêmes.
                                </p>

                                <div style={{ background: '#fff', padding: 25, borderRadius: 24, boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)' }}>
                                    <QRCodeSVG value={qrData} size={250} />
                                </div>

                                <button
                                    onClick={handlePrint}
                                    style={{
                                        marginTop: 40, display: 'flex', alignItems: 'center', gap: 10, background: '#fff', color: '#111',
                                        padding: '16px 32px', borderRadius: 50, fontSize: 16, fontWeight: 'bold', cursor: 'pointer', border: 'none',
                                        boxShadow: '0 4px 15px rgba(255,255,255,0.1)'
                                    }}
                                >
                                    <Printer size={20} />
                                    Imprimer l'Affiche Comptoir
                                </button>

                                {/* Format Impression moved to root to fix CSS printing scope */}
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 500, margin: '0 auto', width: '100%' }}>
                                <div style={{ textAlign: 'center', marginBottom: 40 }}>
                                    <div style={{
                                        width: 80, height: 80, borderRadius: 40, margin: '0 auto 20px auto',
                                        background: action === 'deposit' ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)',
                                        display: 'flex', justifyContent: 'center', alignItems: 'center'
                                    }}>
                                        {action === 'deposit' ? <ArrowDownCircle size={40} color="var(--accent)" /> : <ArrowUpCircle size={40} color="#f59e0b" />}
                                    </div>
                                    <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 10 }}>{action === 'deposit' ? 'Dépôt Client' : 'Retrait Client'}</h2>
                                    <p style={{ color: 'var(--text-secondary)' }}>
                                        {action === 'deposit'
                                            ? "Vous recevez du cash et transférez des FCFA numériques au client."
                                            : "Le client vous transfert ses FCFA numériques, vous lui remettez le cash."
                                        }
                                    </p>
                                </div>

                                <form onSubmit={handleSubmit}>
                                    <div className="input-group" style={{ marginBottom: 25 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><User2 size={16} /> Téléphone du Client</label>
                                        <input
                                            value={phone}
                                            onChange={e => setPhone(e.target.value)}
                                            placeholder="+241 XX XX XX XX"
                                            required
                                            style={{ fontSize: 18, padding: '16px 20px', background: 'var(--bg-primary)' }}
                                        />
                                    </div>

                                    {action === 'deposit' && (
                                        <>
                                            <div className="input-group" style={{ marginBottom: 20 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Montant cash reçu (FCFA)</label>
                                                <input
                                                    type="number"
                                                    value={amount}
                                                    onChange={e => setAmount(e.target.value)}
                                                    placeholder="Ex: 5000"
                                                    required
                                                    style={{ fontSize: 24, fontWeight: 'bold', padding: '16px 20px', background: 'var(--bg-primary)', letterSpacing: 1 }}
                                                />
                                            </div>
                                            <div className="input-group" style={{ marginBottom: 40 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)' }}>
                                                    <ShieldCheck size={16} /> Votre Code PIN Agent
                                                </label>
                                                <input
                                                    type="password"
                                                    value={agentPin}
                                                    onChange={e => setAgentPin(e.target.value)}
                                                    placeholder="••••"
                                                    maxLength={4}
                                                    required
                                                    style={{ fontSize: 30, padding: '16px 20px', textAlign: 'center', letterSpacing: 10, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: 'var(--accent)' }}
                                                />
                                                <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: 10, textAlign: 'center' }}>
                                                    Saisissez votre PIN de sécurité. L'argent partira directement de votre compte vers le client.
                                                </small>
                                            </div>
                                        </>
                                    )}

                                    {action === 'withdraw' && (
                                        <div className="input-group" style={{ marginBottom: 40 }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Montant demandé (FCFA)</label>
                                            <input
                                                type="number"
                                                value={amount}
                                                onChange={e => setAmount(e.target.value)}
                                                placeholder="Ex: 5000"
                                                required
                                                style={{ fontSize: 24, fontWeight: 'bold', padding: '16px 20px', background: 'var(--bg-primary)', letterSpacing: 1 }}
                                            />
                                            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: 15, textAlign: 'center' }}>
                                                Le client recevra une requête directe sur son application Mongain pour valider le transfert vers votre compte.
                                            </small>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={loading}
                                        style={{
                                            width: '100%', padding: '20px', borderRadius: 16, fontSize: 18, fontWeight: 700,
                                            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                                            background: action === 'withdraw' ? '#f59e0b' : 'var(--accent)',
                                            color: 'var(--text-primary)',
                                            boxShadow: `0 10px 20px ${action === 'withdraw' ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.3)'}`,
                                            opacity: loading ? 0.7 : 1,
                                            transition: 'all 0.2s',
                                            marginTop: -10
                                        }}
                                    >
                                        {loading ? 'Traitement Bancaire en cours...' : (action === 'deposit' ? 'Validation du Dépôt' : 'Validation du Retrait')}
                                    </button>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Format Impression Masqué (PROVIDER MODE - Display None) */}
            {
                action === 'qr' && (
                    <div className="print-only" style={{ display: 'none' }}>
                        <QRCodeSVG value={qrData} size={500} />
                    </div>
                )
            }
        </>
    );
}
