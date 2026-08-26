import { useState } from 'react';
import Modal from './Modal';

// Remplace window.confirm()/window.prompt() pour les actions d'intervention (geler,
// forcer une résolution, mettre en pause…) : capture une décision explicite et, quand
// requireReason est vrai, un motif texte avant tout appel API — construit sur Modal.tsx
// existant plutôt que de réinventer un overlay.
export default function ConfirmDialog({
    title, subtitle, confirmLabel = 'Confirmer', danger, requireReason, reasonLabel = 'Motif', onConfirm, onClose,
}: {
    title: string;
    subtitle?: string;
    confirmLabel?: string;
    danger?: boolean;
    requireReason?: boolean;
    reasonLabel?: string;
    onConfirm: (reason: string) => void | Promise<void>;
    onClose: () => void;
}) {
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const canConfirm = !requireReason || reason.trim().length >= 3;

    const handleConfirm = async () => {
        if (!canConfirm || submitting) return;
        setSubmitting(true);
        try {
            await onConfirm(reason.trim());
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal
            title={title}
            subtitle={subtitle}
            onClose={onClose}
            footer={
                <>
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        style={{ flex: 1, padding: '10px 16px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: submitting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13 }}
                    >
                        Annuler
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!canConfirm || submitting}
                        style={{ flex: 1, padding: '10px 16px', background: danger ? 'var(--danger)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: !canConfirm || submitting ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 13, opacity: !canConfirm || submitting ? 0.6 : 1 }}
                    >
                        {submitting ? 'Envoi…' : confirmLabel}
                    </button>
                </>
            }
        >
            {requireReason && (
                <textarea
                    autoFocus
                    placeholder={`${reasonLabel} (obligatoire, au moins 3 caractères)`}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
            )}
        </Modal>
    );
}
