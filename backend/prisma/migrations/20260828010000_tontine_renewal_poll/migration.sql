-- AlterTable
ALTER TABLE "TontineGroup" ADD COLUMN "renewalDeadline" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TontineParticipant" ADD COLUMN "renewalVote" TEXT;
