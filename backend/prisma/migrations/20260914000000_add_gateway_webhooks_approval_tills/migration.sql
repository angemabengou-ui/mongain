-- Complète Mongain Connect (API publique marchand) avec la livraison de webhooks réellement
-- branchée (Invoice.integrationId, ApiWebhookDelivery, ApiIntegration.webhookSigningSecret) —
-- webhookUrl existait déjà mais n'était livré nulle part. Ajoute aussi la double validation
-- optionnelle des paiements de masse (PayoutBulk.*, User.portalApprovalThreshold) et les
-- guichets/caisses multiples (MerchantTill). Additif uniquement, aucune donnée existante
-- modifiée à l'exception du renommage VIEWER -> AUDITOR (rôles portail, voir plus bas).

-- AlterTable: Invoice -> ApiIntegration
ALTER TABLE "Invoice" ADD COLUMN "integrationId" TEXT;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ApiIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: ApiIntegration
ALTER TABLE "ApiIntegration" ADD COLUMN "webhookSigningSecret" TEXT;

-- CreateTable: ApiWebhookDelivery
CREATE TABLE "ApiWebhookDelivery" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "ApiWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiWebhookDelivery_integrationId_status_idx" ON "ApiWebhookDelivery"("integrationId", "status");

-- AddForeignKey
ALTER TABLE "ApiWebhookDelivery" ADD CONSTRAINT "ApiWebhookDelivery_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ApiIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: PayoutBulk (double validation)
ALTER TABLE "PayoutBulk" ADD COLUMN "initiatedByMemberId" TEXT;
ALTER TABLE "PayoutBulk" ADD COLUMN "approvedByMemberId" TEXT;
ALTER TABLE "PayoutBulk" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- AlterTable: User (seuil de double validation portail + guichets)
ALTER TABLE "User" ADD COLUMN "portalApprovalThreshold" INTEGER;

-- CreateTable: MerchantTill
CREATE TABLE "MerchantTill" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantTill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantTill_phone_key" ON "MerchantTill"("phone");

-- AddForeignKey
ALTER TABLE "MerchantTill" ADD CONSTRAINT "MerchantTill_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rôles du portail marchand géant enrichis : ADMIN/MANAGER/OPERATOR/AUDITOR (au lieu de
-- ADMIN/VIEWER seulement). Renomme les lignes existantes plutôt que d'introduire une valeur
-- concurrente : VIEWER et AUDITOR désignaient déjà exactement le même niveau (lecture seule).
UPDATE "MerchantPortalMember" SET "role" = 'AUDITOR' WHERE "role" = 'VIEWER';
