import { ReactNode } from 'react';

// Barre d'onglets unique — remplace 4 langages visuels différents (soulignement
// accent chez Customer360, pilule accent chez SupportCenter, pilule sombre chez
// Treasury/Settings/AgencyCenter, pilule à couleur sémantique par onglet chez KycMod).
export default function TabBar<T extends string>({ tabs, active, onChange }: {
    tabs: { id: T; label: string; icon?: ReactNode }[];
    active: T;
    onChange: (id: T) => void;
}) {
    return (
        <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', paddingBottom: 15, marginBottom: 30, overflowX: 'auto' }}>
            {tabs.map(t => (
                <button
                    key={t.id}
                    onClick={() => onChange(t.id)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
                        background: active === t.id ? 'var(--btn-dark-bg)' : 'transparent',
                        color: active === t.id ? 'var(--btn-dark-text)' : 'var(--text-secondary)',
                        border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                        transition: '0.2s', whiteSpace: 'nowrap'
                    }}
                >
                    {t.icon} {t.label}
                </button>
            ))}
        </div>
    );
}
