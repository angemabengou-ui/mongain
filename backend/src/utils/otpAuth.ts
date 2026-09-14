import { prisma } from '../prisma';

export const MAX_OTP_ATTEMPTS = 5;

type OtpCodeSubject = {
    id: string;
    code: string;
    expiresAt: Date;
    attempts: number;
} | null;

type OtpCheckResult = { ok: true } | { ok: false; status: number; error: string };

// Vérification centralisée d'un code OTP (compteur de tentatives par code), même esprit que
// verifyUserPin (utils/pinAuth.ts) pour le PIN : /reset-pin, /register et /verify-login-otp
// (routes/auth.ts) réimplémentaient chacun indépendamment `code !== otpCode` sans jamais
// limiter le nombre d'essais contre un même code. Les rate-limiters par IP (smsLimiter/
// loginLimiter) ne protègent qu'UNE IP/fenêtre à la fois — sans ce compteur, un attaquant
// distribué sur plusieurs IP (ou simplement sous le seuil du limiter) pouvait brute-forcer les
// 10 000 combinaisons d'un code à 4 chiffres sans aucune limite. `invalidMessage` : message
// d'erreur déjà utilisé par chaque route pour un code absent/expiré/incorrect, préservé tel
// quel pour ne rien changer côté client sur ce chemin ; seul le dépassement du seuil introduit
// un nouveau message dédié.
export async function verifyOtpAttempt(record: OtpCodeSubject, submittedCode: string, invalidMessage: string): Promise<OtpCheckResult> {
    if (!record || record.expiresAt < new Date()) {
        return { ok: false, status: 400, error: invalidMessage };
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
        // Code définitivement grillé, même si le bon code est soumis à partir de maintenant :
        // on le supprime pour forcer une nouvelle demande (request-otp / request-reset-otp).
        await prisma.verificationCode.delete({ where: { id: record.id } }).catch(() => { });
        return { ok: false, status: 400, error: 'Trop de tentatives. Veuillez redemander un nouveau code.' };
    }

    if (record.code !== submittedCode) {
        await prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
        return { ok: false, status: 400, error: invalidMessage };
    }

    return { ok: true };
}
