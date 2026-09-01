
export default function RiskScoring({ token: _token }: { token: string }) {
    return (
        <div style={{ padding: 40, animation: 'fadeIn 0.5s ease-out' }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, background: 'linear-gradient(90deg, #fff, rgba(255,255,255,0.7))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Scoring & Risques (V6 Phase 3)
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Moteur de classe de risque basé sur l'IA et l'historique financier.</p>

            <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🧠</div>
                <h2 style={{ fontSize: 20, marginBottom: 12 }}>Architecture du Modèle de Scoring en cours de conception</h2>
                <p style={{ color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto', lineHeight: 1.6 }}>
                    Ce module connectera bientôt vos données (Ledger, Tontines) à un algorithme de notation de solvabilité. Il permettra d'identifier instantanément les profils à risque (FRAUD_SCORING) et de récompenser les utilisateurs fiables (CREDIT_SCORING) par des avantages ou l'accès aux cartes virtuelles.
                </p>
                <div style={{ marginTop: 32, display: 'inline-flex', gap: 16 }}>
                    <div style={{ padding: '8px 16px', background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: 20, color: '#10b981', fontSize: 13, fontWeight: 600 }}>Tiers Confiance</div>
                    <div style={{ padding: '8px 16px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid rgba(245, 158, 11, 0.4)', borderRadius: 20, color: '#f59e0b', fontSize: 13, fontWeight: 600 }}>Sous Surveillance</div>
                    <div style={{ padding: '8px 16px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 20, color: '#ef4444', fontSize: 13, fontWeight: 600 }}>Haut Risque</div>
                </div>
            </div>
        </div>
    );
}
