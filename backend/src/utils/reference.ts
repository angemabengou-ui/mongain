import crypto from 'crypto';

// Référence de transaction imprévisible. Remplace Math.random().toString(36),
// dont l'entropie n'est pas adaptée à un identifiant utilisé pour du rapprochement
// financier — la contrainte @unique en base reste le garde-fou anti-collision.
export const generateReference = (prefix: string) =>
    `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
