import { ReactNode } from 'react';

// Carte KPI unique — remplace 4 implémentations différentes (AgencyCenter en
// horizontal, Treasury avec icône géante en fond, SupportCenter sans classe .card,
// MacroStats avec ses propres tokens de padding) qui coexistaient sans raison
// fonctionnelle. S'appuie sur .stat-card (index.css), déjà le pattern majoritaire.
export default function KpiCard({ icon, label, value, color = 'var(--accent)', subtitle }: {
    icon: ReactNode; label: string; value: string | number; color?: string; subtitle?: string;
}) {
    return (
        <div className="stat-card">
            <div className="stat-icon" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
                {icon}
            </div>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8 }}>{subtitle}</div>}
        </div>
    );
}
