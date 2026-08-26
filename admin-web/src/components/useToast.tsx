import { useCallback, useState } from 'react';

// Remplace alert()/window.confirm() pour le feedback post-action des nouveaux outils
// d'intervention (Vaults/Tontines) — non bloquant, empilable, auto-dismiss. Volontairement
// local à la page qui l'utilise (pas de Context global) : Treasury/TellerTerminal/
// BranchDashboard gardent leur alert() existant pour l'instant, hors périmètre de cette refonte.
export type ToastVariant = 'success' | 'error';
type ToastItem = { id: number; message: string; variant: ToastVariant };

export function useToast() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const push = useCallback((message: string, variant: ToastVariant = 'success') => {
        const id = Date.now() + Math.random();
        setToasts(t => [...t, { id, message, variant }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
    }, []);

    return { toasts, push };
}

export function ToastHost({ toasts }: { toasts: ToastItem[] }) {
    if (toasts.length === 0) return null;
    return (
        <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 2000, maxWidth: 360 }}>
            {toasts.map(t => (
                <div
                    key={t.id}
                    style={{
                        padding: '12px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                        background: t.variant === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
                        color: t.variant === 'error' ? 'var(--danger)' : 'var(--success)',
                        border: `1px solid ${t.variant === 'error' ? 'var(--danger)' : 'var(--success)'}`,
                        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
                    }}
                >
                    {t.message}
                </div>
            ))}
        </div>
    );
}
