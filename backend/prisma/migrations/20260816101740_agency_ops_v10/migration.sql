/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "region" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "fee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "tellerId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'TRANSFER';

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_branchId_idx" ON "Transaction"("branchId");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");
