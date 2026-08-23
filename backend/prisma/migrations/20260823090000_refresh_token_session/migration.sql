-- Session longue durée (access token court + refresh token opaque, rotation à
-- chaque renouvellement). Voir middleware/auth.ts et routes/auth.ts (/auth/refresh,
-- /auth/logout) : corrige la déconnexion complète après 7 jours (durée fixe de
-- l'ancien token, sans aucun mécanisme de renouvellement).
ALTER TABLE "User" ADD COLUMN "refreshTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_refreshTokenHash_key" ON "User"("refreshTokenHash");
