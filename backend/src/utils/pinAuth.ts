import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';

type PinCheckSubject = {
    id: string;
    pin: string;
    failedPinAttempts: number;
    lockedUntil: Date | null;
};

type PinCheckResult = { ok: true } | { ok: false; status: number; error: string };

// Vérification centralisée du PIN client (verrouillage 3 échecs / 15 min). Plusieurs
// endpoints authentifiés (transfert, retrait...) réimplémentaient ce contrôle indépendamment
// et certains (PUT /auth/pin, /wallet/qr-cash-out, /services/pay-bill, /services/topup)
// l'avaient tout simplement omis : bcrypt.compare seul, sans lire lockedUntil ni incrémenter
// failedPinAttempts, ce qui permettait de brute-forcer l'espace à 4 chiffres (10 000
// combinaisons) sans aucun verrou dès qu'une session valide était compromise.
export async function verifyUserPin(user: PinCheckSubject, pin: string): Promise<PinCheckResult> {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
        return { ok: false, status: 400, error: 'Votre compte est temporairement bloqué suite à plusieurs échecs. Réessayez plus tard.' };
    }

    const pinMatch = await bcrypt.compare(pin, user.pin);
    if (!pinMatch) {
        const attempts = user.failedPinAttempts + 1;
        const isLocked = attempts >= 3;
        const lockedUntil = isLocked ? new Date(Date.now() + 15 * 60 * 1000) : null;

        await prisma.user.update({
            where: { id: user.id },
            data: { failedPinAttempts: attempts, lockedUntil },
        });

        if (isLocked) return { ok: false, status: 400, error: 'Compte bloqué (3 échecs). Réessayez dans 15 minutes.' };
        return { ok: false, status: 400, error: `Code PIN incorrect. Tentative ${attempts}/3.` };
    }

    if (user.failedPinAttempts > 0) {
        await prisma.user.update({ where: { id: user.id }, data: { failedPinAttempts: 0, lockedUntil: null } });
    }

    return { ok: true };
}
