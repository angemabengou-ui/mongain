-- Restauration post-incident : la commande `prisma migrate diff --shadow-database-url`
-- exécutée par erreur contre la vraie base plus tôt dans cette session (le paramètre
-- --shadow-database-url pointait vers la base réelle au lieu d'une base jetable) a
-- réinitialisé la base depuis les seules migrations tracées, perdant toute colonne/table
-- ajoutée via `db push` ou des migrations jamais enregistrées dans _prisma_migrations
-- (table elle-même absente : l'historique de migrations n'a jamais été retracé après coup).
--
-- Ce script est strictement ADDITIF — généré par `prisma migrate diff --from-url <réel>
-- --to-schema-datamodel prisma/schema.prisma --script` (introspection en lecture seule,
-- aucune base jetable impliquée) puis relu intégralement avant exécution : uniquement des
-- CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT, aucun DROP, aucune donnée
-- existante modifiée ou supprimée. Enveloppé dans une transaction explicite : tout échoue
-- et s'annule ensemble plutôt que de laisser la base dans un état intermédiaire.

BEGIN;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "permissionsCustomized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "agencyCriticalLiquidity" DOUBLE PRECISION NOT NULL DEFAULT 5000000.0,
ADD COLUMN     "agencyLowLiquidityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 15000000.0,
ADD COLUMN     "maxMintAmount" DOUBLE PRECISION NOT NULL DEFAULT 1000000000.0,
ADD COLUMN     "treasuryApprovalThreshold" DOUBLE PRECISION NOT NULL DEFAULT 5000000.0;

-- AlterTable
ALTER TABLE "TontineGroup" ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pausedReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "commissionWalletId" TEXT;

-- CreateTable
CREATE TABLE "MerchantPayoutRequest" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "sourceAccount" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "processedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "MerchantPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TontineCycle" (
    "id" TEXT NOT NULL,
    "tontineGroupId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "beneficiaryParticipantId" TEXT,
    "payoutTransactionId" TEXT,
    "totalExpected" DOUBLE PRECISION NOT NULL,
    "totalCollected" DOUBLE PRECISION NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TontineCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TontineContribution" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "transactionId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TontineContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationCase" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "reportedAmount" DOUBLE PRECISION NOT NULL,
    "difference" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
    "investigation" TEXT,
    "resolution" TEXT,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiIntegration" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'TEST',
    "publicKey" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permissions" TEXT NOT NULL DEFAULT 'PAYMENTS',
    "description" TEXT,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantPayoutRequest_merchantId_idx" ON "MerchantPayoutRequest"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "TontineCycle_tontineGroupId_cycleNumber_key" ON "TontineCycle"("tontineGroupId", "cycleNumber");

-- CreateIndex
CREATE INDEX "TontineContribution_participantId_idx" ON "TontineContribution"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "TontineContribution_cycleId_participantId_key" ON "TontineContribution"("cycleId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationCase_reference_key" ON "ReconciliationCase"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIntegration_publicKey_key" ON "ApiIntegration"("publicKey");

-- CreateIndex
CREATE INDEX "ApiIntegration_merchantId_idx" ON "ApiIntegration"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_commissionWalletId_key" ON "User"("commissionWalletId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_commissionWalletId_fkey" FOREIGN KEY ("commissionWalletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPayoutRequest" ADD CONSTRAINT "MerchantPayoutRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantPayoutRequest" ADD CONSTRAINT "MerchantPayoutRequest_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TontineCycle" ADD CONSTRAINT "TontineCycle_tontineGroupId_fkey" FOREIGN KEY ("tontineGroupId") REFERENCES "TontineGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TontineContribution" ADD CONSTRAINT "TontineContribution_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "TontineCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TontineContribution" ADD CONSTRAINT "TontineContribution_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "TontineParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiIntegration" ADD CONSTRAINT "ApiIntegration_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiLog" ADD CONSTRAINT "ApiLog_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ApiIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
