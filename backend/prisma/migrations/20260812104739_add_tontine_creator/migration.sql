/*
  Warnings:

  - Added the required column `creatorId` to the `TontineGroup` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TontineGroup" ADD COLUMN     "creatorId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "TontineGroup" ADD CONSTRAINT "TontineGroup_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
