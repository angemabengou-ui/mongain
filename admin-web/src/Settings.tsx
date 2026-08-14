import { Save, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { API_URL } from './config';

export default function Settings({ token }: { token: string }) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [taxP2P, setTaxP2P] = useState('');
    const [taxWithdraw, setTaxWithdraw] = useState('');
    const [rewardMerchant, setRewardMerchant] = useState('');
    const [dailyLimitTier0, setDailyLimitTier0] = useState('');
    const [dailyLimitTier1, setDailyLimitTier1] = useState('');
    const [agencyWithdrawThreshold, setAgencyWithdrawThreshold] = useState('');
    const [agencyTaxWithdraw, setAgencyTaxWithdraw] = useState('');

    // Orchestrator States
    const [airtelEnabled, setAirtelEnabled] = useState(true);
    const [moovEnabled, setMoovEnabled] = useState(true);
    const [seegEnabled, setSeegEnabled] = useState(true);
    const [tontineEnabled, setTontineEnabled] = useState(true);
    const [airtelFee, setAirtelFee] = useState('');
    const [moovFee, setMoovFee] = useState('');
    const [airtelApiKey, setAirtelApiKey] = useState('');
    const [moovApiKey, setMoovApiKey] = useState('');

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const resp = await fetch(API_URL + '/api/settings');
                if (resp.ok) {
                    const data = await resp.json();
                    setTaxP2P((data.taxP2P * 100).toString());
                    setTaxWithdraw((data.taxWithdraw * 100).toString());
                    setRewardMerchant((data.rewardMerchant * 100).toString());
                    setDailyLimitTier0(data.dailyLimitTier0?.toString() || '50000');
                    setDailyLimitTier1(data.dailyLimitTier1?.toString() || '2000000');
                    setAgencyWithdrawThreshold(data.agencyWithdrawThreshold?.toString() || '100000');
                    setAgencyTaxWithdraw((data.agencyTaxWithdraw * 100).toString() || '1');

                    if (data.airtelEnabled !== undefined) setAirtelEnabled(data.airtelEnabled);
                    if (data.moovEnabled !== undefined) setMoovEnabled(data.moovEnabled);
                    if (data.seegEnabled !== undefined) setSeegEnabled(data.seegEnabled);
                    if (data.tontineEnabled !== undefined) setTontineEnabled(data.tontineEnabled);

                    if (data.airtelFee) setAirtelFee((data.airtelFee * 100).toString());
                    if (data.moovFee) setMoovFee((data.moovFee * 100).toString());

                    if (data.airtelApiKey) setAirtelApiKey(data.airtelApiKey);
                    if (data.moovApiKey) setMoovApiKey(data.moovApiKey);
                }
            } catch (e) {
                console.error(e);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setMessage('');

        const floatP2P = parseFloat(taxP2P) / 100;
        const floatWithdraw = parseFloat(taxWithdraw) / 100;
        const floatReward = parseFloat(rewardMerchant) / 100;
        const numLimit0 = parseInt(dailyLimitTier0, 10);
        const numLimit1 = parseInt(dailyLimitTier1, 10);
        const floatAgencyTax = parseFloat(agencyTaxWithdraw) / 100;
        const numAgencyThreshold = parseInt(agencyWithdrawThreshold, 10);
        const floatAirtel = parseFloat(airtelFee) / 100;
        const floatMoov = parseFloat(moovFee) / 100;

        if (isNaN(floatP2P) || isNaN(floatWithdraw) || isNaN(floatReward) || isNaN(numLimit0) || isNaN(numLimit1) || isNaN(floatAgencyTax) || isNaN(numAgencyThreshold)) {
            setError('Valeurs incorrectes fournies (nombres manquants ou invalides).');
            return;
        }

        if (floatReward >= floatWithdraw) {
            setError('La Prime Commerçant ne peut pas être supérieure ou égale à la Taxe de Retrait !');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                taxP2P: floatP2P,
                taxWithdraw: floatWithdraw,
                rewardMerchant: floatReward,
                dailyLimitTier0: numLimit0,
                dailyLimitTier1: numLimit1,
                agencyWithdrawThreshold: numAgencyThreshold,
                agencyTaxWithdraw: floatAgencyTax,
                airtelEnabled,
                moovEnabled,
                seegEnabled,
                tontineEnabled,
                airtelApiKey: airtelApiKey || null,
                moovApiKey: moovApiKey || null,
                ...(isNaN(floatAirtel) ? {} : { airtelFee: floatAirtel }),
                ...(isNaN(floatMoov) ? {} : { moovFee: floatMoov })
            };

            const resp = await fetch(API_URL + '/api/settings', {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await resp.json();
            if (resp.ok) {
                setMessage('Configurations globales synchronisées en direct avec les applications mobiles !');
            } else {
                setError(data.error || 'Erreur Serveur');
            }
        } catch (err) {
            setError('Erreur de réseau.');
        } finally {
            setLoading(false);
        }
    };


    return (
        <div style={{ maxWidth: '600px' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '24px', marginBottom: '20px', color: '#10b981' }}>
                <SettingsIcon size={28} />
                Contrôleur Économique
            </h2>
            <p style={{ color: '#aaa', marginBottom: '30px' }}>
                Modifiez les règles de commission universelle de l'application. Les changements sont <b>instantanés</b> sur les téléphones mobiles.
            </p>

            {message && <div style={{ padding: '10px', backgroundColor: '#065f46', color: '#a7f3d0', borderRadius: '8px', marginBottom: '15px' }}>{message}</div>}
            {error && <div style={{ padding: '10px', backgroundColor: '#7f1d1d', color: '#fecaca', borderRadius: '8px', marginBottom: '15px' }}>{error}</div>}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: '#1e293b', padding: '20px', borderRadius: '12px' }}>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Taxe Transfert Simple P2P (%)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Frais déduits lors de l'envoi d'argent d'un Client à un Client.</p>
                    <input
                        type="number" step="0.01" min="0" required
                        value={taxP2P} onChange={e => setTaxP2P(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Taxe Retrait Global (%)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Frais totaux payés par le Client lorsqu'il retire de l'argent physique chez un Agent ou Commerçant.</p>
                    <input
                        type="number" step="0.01" min="0" required
                        value={taxWithdraw} onChange={e => setTaxWithdraw(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Prime Commerçant (%)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Partie de la Taxe de Retrait qui est reversée <b>gratuitement</b> à l'Agent/Commerçant. <i>(Le reste va à Mongain)</i>.</p>
                    <input
                        type="number" step="0.01" min="0" required
                        value={rewardMerchant} onChange={e => setRewardMerchant(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Plafond Journalier Tier 0 (FCFA)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Limite maximum de débits pour les comptes sans KYC approuvé.</p>
                    <input
                        type="number" step="1000" min="0" required
                        value={dailyLimitTier0} onChange={e => setDailyLimitTier0(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #a855f7' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Plafond Journalier Tier 1 (FCFA)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Limite maximum de débits pour les comptes ayant validé leur identité (KYC).</p>
                    <input
                        type="number" step="1000" min="0" required
                        value={dailyLimitTier1} onChange={e => setDailyLimitTier1(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #f43f5e' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Seuil Gratuité Agence (FCFA)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Si un retrait physique en Agence Mongain dépasse ce plafond, il sera soumis à la Taxe Agence. En dessous, il est totalement gratuit !</p>
                    <input
                        type="number" step="1000" min="0" required
                        value={agencyWithdrawThreshold} onChange={e => setAgencyWithdrawThreshold(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>

                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #f43f5e' }}>
                    <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold' }}>Taxe Agence Excédentaire (%)</label>
                    <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>Pourcentage appliqué sur la totalité du montant excédant le seuil de gratuité ci-dessus.</p>
                    <input
                        type="number" step="0.01" min="0" required
                        value={agencyTaxWithdraw} onChange={e => setAgencyTaxWithdraw(e.target.value)}
                        style={{ width: '100%', padding: '12px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                    />
                </div>


                <h3 style={{ marginTop: '20px', marginBottom: '10px', color: '#60a5fa', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>Orchestrateur & Télécoms (API)</h3>

                {/* Airtel API Box */}
                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <label style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 10 }}>🔴 Airtel Money API</label>
                        <button type="button" onClick={() => setAirtelEnabled(!airtelEnabled)} style={{ padding: '5px 12px', borderRadius: 20, backgroundColor: airtelEnabled ? '#10b981' : '#334155', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                            {airtelEnabled ? 'ACTIF' : 'SUSPENDU'}
                        </button>
                    </div>
                    {airtelEnabled && (
                        <>
                            <div style={{ marginBottom: 15 }}>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#94a3b8' }}>Clé API Airtel (Client Secret)</label>
                                <input
                                    type="password" placeholder="api_secret_airtel_..."
                                    value={airtelApiKey} onChange={e => setAirtelApiKey(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#94a3b8' }}>Frais d'intégration Airtel (%)</label>
                                <input
                                    type="number" step="0.1" min="0" required
                                    value={airtelFee} onChange={e => setAirtelFee(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Moov API Box */}
                <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <label style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 10 }}>🔵 Moov Africa API</label>
                        <button type="button" onClick={() => setMoovEnabled(!moovEnabled)} style={{ padding: '5px 12px', borderRadius: 20, backgroundColor: moovEnabled ? '#10b981' : '#334155', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                            {moovEnabled ? 'ACTIF' : 'SUSPENDU'}
                        </button>
                    </div>
                    {moovEnabled && (
                        <>
                            <div style={{ marginBottom: 15 }}>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#94a3b8' }}>Clé API Moov (Access Token)</label>
                                <input
                                    type="password" placeholder="moov_token_..."
                                    value={moovApiKey} onChange={e => setMoovApiKey(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: '#94a3b8' }}>Frais d'intégration Moov (%)</label>
                                <input
                                    type="number" step="0.1" min="0" required
                                    value={moovFee} onChange={e => setMoovFee(e.target.value)}
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', backgroundColor: '#334155', border: 'none', color: '#fff' }}
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Services Internes */}
                <h3 style={{ marginTop: '20px', marginBottom: '10px', color: '#a78bfa', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>Mini-Programmes Internes</h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontWeight: 'bold' }}>⚡ Électricité (SEEG)</label>
                        <button type="button" onClick={() => setSeegEnabled(!seegEnabled)} style={{ padding: '5px 12px', borderRadius: 20, backgroundColor: seegEnabled ? '#10b981' : '#334155', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                            {seegEnabled ? 'ACTIF' : 'OFF'}
                        </button>
                    </div>
                    <div style={{ backgroundColor: '#0f172a', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #d946ef', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label style={{ fontWeight: 'bold' }}>🤝 Tontine</label>
                        <button type="button" onClick={() => setTontineEnabled(!tontineEnabled)} style={{ padding: '5px 12px', borderRadius: 20, backgroundColor: tontineEnabled ? '#10b981' : '#334155', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
                            {tontineEnabled ? 'ACTIF' : 'OFF'}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    style={{
                        marginTop: '10px', padding: '15px', backgroundColor: '#10b981', color: '#0f172a',
                        border: 'none', borderRadius: '6px', fontWeight: 'bold', fontSize: '16px',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px',
                        cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Save size={20} />
                    {loading ? 'Sauvegarde...' : 'Appliquer au Système National'}
                </button>
            </form >
        </div >
    );
}
