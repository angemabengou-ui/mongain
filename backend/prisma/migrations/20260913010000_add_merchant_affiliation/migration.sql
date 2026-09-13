-- Lien marchand géant <-> marchand affilié, avec consentement explicite requis (statut
-- PENDING jusqu'à réponse du marchand affilié depuis le mobile — voir
-- routes/merchant.ts /affiliations/:id/respond). Seules les lignes ACCEPTED comptent dans
-- les rapports de conformité du géant (routes/merchant-portal.ts).

-- CreateTable
CREATE TABLE "MerchantAffiliation" (
    "id" TEXT NOT NULL,
    "giantId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAffiliation_giantId_merchantId_key" ON "MerchantAffiliation"("giantId", "merchantId");

-- CreateIndex
CREATE INDEX "MerchantAffiliation_merchantId_status_idx" ON "MerchantAffiliation"("merchantId", "status");

-- CreateIndex
CREATE INDEX "MerchantAffiliation_giantId_status_idx" ON "MerchantAffiliation"("giantId", "status");

-- AddForeignKey
ALTER TABLE "MerchantAffiliation" ADD CONSTRAINT "MerchantAffiliation_giantId_fkey" FOREIGN KEY ("giantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAffiliation" ADD CONSTRAINT "MerchantAffiliation_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
