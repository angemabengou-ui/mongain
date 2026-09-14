-- Ajoute un compteur d'essais erronés par code OTP (VerificationCode.attempts). Défense en
-- profondeur en plus des rate-limiters par IP (smsLimiter/loginLimiter dans routes/auth.ts) :
-- ceux-ci ne protègent qu'UNE IP/fenêtre à la fois, sans limite sur le nombre d'essais contre
-- UN code précis. Voir utils/otpAuth.ts (verifyOtpAttempt) pour la lecture/incrémentation.
-- Additif uniquement (défaut 0), aucune donnée existante modifiée.

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
