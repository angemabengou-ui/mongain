/*
  Warnings:

  - You are about to drop the column `nextDebitDate` on the `TontineGroup` table. All the data in the column will be lost.
  - You are about to drop the column `hasReceived` on the `TontineParticipant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "TontineGroup" DROP COLUMN "nextDebitDate",
ADD COLUMN     "lastPayoutDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TontineParticipant" DROP COLUMN "hasReceived";

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "dailySpent" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
ADD COLUMN     "dailySpentResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
