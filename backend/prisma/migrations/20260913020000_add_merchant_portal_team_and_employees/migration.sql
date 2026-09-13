-- Niveaux de permission sur le portail web marchand géant (MerchantPortalMember, session
-- indépendante par membre), répertoire d'employés réutilisable pour les paies groupées
-- (MerchantEmployee), et fréquence de versement attendue par affiliation
-- (MerchantAffiliation.expectedFrequency) pour calculer automatiquement la conformité. Additif
-- uniquement, aucune donnée existante modifiée.

-- AlterTable
ALTER TABLE "MerchantAffiliation" ADD COLUMN "expectedFrequency" TEXT;

-- CreateTable
CREATE TABLE "MerchantPortalMember" (
    "id" TEXT NOT NULL,
    "giantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "refreshTokenHash" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantPortalMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPortalMember_phone_key" ON "MerchantPortalMember"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantPortalMember_refreshTokenHash_key" ON "MerchantPortalMember"("refreshTokenHash");

-- AddForeignKey
ALTER TABLE "MerchantPortalMember" ADD CONSTRAINT "MerchantPortalMember_giantId_fkey" FOREIGN KEY ("giantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MerchantEmployee" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantEmployee_merchantId_phone_key" ON "MerchantEmployee"("merchantId", "phone");

-- AddForeignKey
ALTER TABLE "MerchantEmployee" ADD CONSTRAINT "MerchantEmployee_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
