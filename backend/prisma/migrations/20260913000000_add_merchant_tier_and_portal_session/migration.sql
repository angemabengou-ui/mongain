-- Marchands Géants (mairie, impôts, grandes entreprises) : raffinement additif de
-- role="MERCHANT" (merchantTier, null pour tout compte existant) + session portail web
-- SÉPARÉE de jwtVersion/refreshTokenHash (session mobile), pour permettre une connexion
-- mobile + web simultanée sur un même compte géant sans invalider l'une par l'autre (voir
-- middleware/auth.ts authMerchantPortal, routes/merchant-portal.ts). Additif uniquement,
-- aucune donnée existante modifiée.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "merchantTier" TEXT;
ALTER TABLE "User" ADD COLUMN "portalTokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "portalRefreshTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "portalRefreshTokenExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_portalRefreshTokenHash_key" ON "User"("portalRefreshTokenHash");
