import { ReactNode } from 'react';

// Modale unique — remplace des overlays à opacité différente selon l'écran
// (0.5 / 0.55 / 0.6 / #0008) et un fond de conteneur qui divergeait du token .card
// à un endroit (Settings). Ferme au clic sur l'overlay, jamais au clic dans le contenu.
export default function Modal({ onClose, title, subtitle, width = 480, children, footer }: {
    onClose: () => void; title: string; subtitle?: string; width?: number; children: ReactNode; footer?: ReactNode;
}) {
    return (
        <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
            onClick={onClose}
        >
            <div className="card" style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', padding: 32 }} onClick={e => e.stopPropagation()}>
                <div style={{ marginBottom: 24 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{title}</h3>
                    {subtitle && <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>{subtitle}</p>}
                </div>
                {children}
                {footer && <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>{footer}</div>}
            </div>
        </div>
    );
}
