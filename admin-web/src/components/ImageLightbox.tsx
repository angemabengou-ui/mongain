import { X } from 'lucide-react';
import { useEffect } from 'react';

// Zoom plein écran pour une photo KYC (CNI, selfie) — avant, ces images n'étaient
// affichées qu'en vignette 120x80px sans aucun moyen de les agrandir, rendant
// impossible toute vérification sérieuse d'une pièce d'identité avant de
// approuver/rejeter un dossier.
export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, cursor: 'zoom-out'
            }}
        >
            <button
                onClick={onClose}
                style={{ position: 'absolute', top: 20, right: 20, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: 10, cursor: 'pointer', color: '#fff' }}
                aria-label="Fermer"
            >
                <X size={22} />
            </button>
            <img
                src={src}
                alt={alt}
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8, cursor: 'default', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            />
            <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>
                {alt} — Échap ou cliquez à l'extérieur pour fermer
            </div>
        </div>
    );
}
