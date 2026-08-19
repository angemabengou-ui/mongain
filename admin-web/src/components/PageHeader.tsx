import { ReactNode } from 'react';

// Un seul en-tête de page pour tout le portail — avant cette refonte, chaque écran
// définissait sa propre taille de titre (24/28px), graisse (700/800/900) et
// disposition du bouton d'action, sans raison fonctionnelle à la divergence.
export default function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 16, flexWrap: 'wrap' }}>
            <div>
                <h2 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{title}</h2>
                {subtitle && <p style={{ color: 'var(--text-secondary)', marginTop: 8, marginBottom: 0, fontSize: 15, lineHeight: 1.5 }}>{subtitle}</p>}
            </div>
            {action}
        </div>
    );
}
