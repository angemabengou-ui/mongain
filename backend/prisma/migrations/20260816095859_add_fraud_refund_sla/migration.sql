/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_fkey";

-- AlterTable
ALTER TABLE "Reclamation" ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "escalatedTo" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "slaBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slaDeadline" TIMESTAMP(3),
ADD COLUMN     "staffId" TEXT,
ADD COLUMN     "tellerId" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "agencyTaxWithdraw" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
ADD COLUMN     "agencyWithdrawThreshold" DOUBLE PRECISION NOT NULL DEFAULT 500000.0,
ADD COLUMN     "airtelApiKey" TEXT,
ADD COLUMN     "airtelEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "airtelFee" DOUBLE PRECISION NOT NULL DEFAULT 0.015,
ADD COLUMN     "antiFractioningAction" TEXT NOT NULL DEFAULT 'APPLY_FEE',
ADD COLUMN     "antiFractioningMaxAmount" DOUBLE PRECISION NOT NULL DEFAULT 100000.0,
ADD COLUMN     "antiFractioningMaxCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "antiFractioningWindowHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "circuitBreaker" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'FCFA',
ADD COLUMN     "dailyLimitTier2" DOUBLE PRECISION NOT NULL DEFAULT 5000000.0,
ADD COLUMN     "globalMaintenance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monthlyLimitTier0" DOUBLE PRECISION NOT NULL DEFAULT 1000000.0,
ADD COLUMN     "monthlyLimitTier1" DOUBLE PRECISION NOT NULL DEFAULT 10000000.0,
ADD COLUMN     "monthlyLimitTier2" DOUBLE PRECISION NOT NULL DEFAULT 50000000.0,
ADD COLUMN     "moovApiKey" TEXT,
ADD COLUMN     "moovEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "moovFee" DOUBLE PRECISION NOT NULL DEFAULT 0.010,
ADD COLUMN     "perTxLimitTier0" DOUBLE PRECISION NOT NULL DEFAULT 50000.0,
ADD COLUMN     "perTxLimitTier1" DOUBLE PRECISION NOT NULL DEFAULT 500000.0,
ADD COLUMN     "perTxLimitTier2" DOUBLE PRECISION NOT NULL DEFAULT 2000000.0,
ADD COLUMN     "platformName" TEXT NOT NULL DEFAULT 'Mongain',
ADD COLUMN     "refundMakerCheckerThreshold" DOUBLE PRECISION NOT NULL DEFAULT 100000,
ADD COLUMN     "seegEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slaCriticalHours" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "slaHighHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "slaLowHours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "slaNormalHours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "supportEmail" TEXT NOT NULL DEFAULT 'support@mongain.com',
ADD COLUMN     "supportPhone" TEXT NOT NULL DEFAULT '+2410000000',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Libreville',
ADD COLUMN     "tontineEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "webhookActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webhookRetry" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "webhookUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "customDailyLimit" DOUBLE PRECISION,
ADD COLUMN     "customLimitExpiresAt" TIMESTAMP(3),
ADD COLUMN     "customMonthlyLimit" DOUBLE PRECISION,
ADD COLUMN     "customPerTxLimit" DOUBLE PRECISION,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "freezeReason" TEXT,
ADD COLUMN     "frozenUntil" TIMESTAMP(3),
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "monthlySpent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "monthlySpentResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ReclamationNote" (
    "id" TEXT NOT NULL,
    "reclamationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReclamationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettingHistory" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "oldValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "checkerId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettingsApproval" (
    "id" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "action" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettingsApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isHQ" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "walletId" TEXT,
    "managerId" TEXT,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tellerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "initialCash" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "finalCash" DOUBLE PRECISION,
    "totalCashInValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "totalCashOutValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "discrepancy" DOUBLE PRECISION,
    "discrepancyReason" TEXT,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'FCFA',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "documentUrl" TEXT,
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "rejectionReason" TEXT,
    "targetBranchId" TEXT,
    "targetWalletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "TreasuryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "matricule" TEXT,
    "cni" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "dob" TEXT,
    "gender" TEXT,
    "emergencyPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudCase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analystId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SUSPICIOUS_ACTIVITY',
    "riskLevel" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "decision" TEXT,
    "linkedTransactionIds" TEXT NOT NULL DEFAULT '[]',
    "reclamationId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraudCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "refundType" TEXT NOT NULL DEFAULT 'FULL',
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reclamationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "rejectionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SUSPICIOUS_ACTIVITY',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "authorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_walletId_key" ON "Branch"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_managerId_key" ON "Branch"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryRequest_reference_key" ON "TreasuryRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_matricule_key" ON "Staff"("matricule");

-- CreateIndex
CREATE UNIQUE INDEX "RefundRequest_transactionId_key" ON "RefundRequest"("transactionId");

-- CreateIndex
CREATE INDEX "Transaction_senderWalletId_idx" ON "Transaction"("senderWalletId");

-- CreateIndex
CREATE INDEX "Transaction_receiverWalletId_idx" ON "Transaction"("receiverWalletId");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Reclamation" ADD CONSTRAINT "Reclamation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReclamationNote" ADD CONSTRAINT "ReclamationNote_reclamationId_fkey" FOREIGN KEY ("reclamationId") REFERENCES "Reclamation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingHistory" ADD CONSTRAINT "SettingHistory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingHistory" ADD CONSTRAINT "SettingHistory_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingsApproval" ADD CONSTRAINT "SettingsApproval_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettingsApproval" ADD CONSTRAINT "SettingsApproval_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_tellerId_fkey" FOREIGN KEY ("tellerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryRequest" ADD CONSTRAINT "TreasuryRequest_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryRequest" ADD CONSTRAINT "TreasuryRequest_checkerId_fkey" FOREIGN KEY ("checkerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryRequest" ADD CONSTRAINT "TreasuryRequest_targetBranchId_fkey" FOREIGN KEY ("targetBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCase" ADD CONSTRAINT "FraudCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudCase" ADD CONSTRAINT "FraudCase_analystId_fkey" FOREIGN KEY ("analystId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_reclamationId_fkey" FOREIGN KEY ("reclamationId") REFERENCES "Reclamation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
