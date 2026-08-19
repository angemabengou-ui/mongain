-- Aucune protection contre le brute-force n'existait sur /api/corp/login (contrairement au
-- login PIN mobile, qui verrouille après 3 tentatives) : failedLoginAttempts/lockedUntil
-- reproduisent cette protection pour les comptes Staff. jwtVersion permet de révoquer
-- immédiatement un token déjà émis (changement de mot de passe, suspension) — le modèle
-- Staff n'avait aucun équivalent au jwtVersion déjà présent sur User.
ALTER TABLE "Staff" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Staff" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "Staff" ADD COLUMN "jwtVersion" INTEGER NOT NULL DEFAULT 0;
