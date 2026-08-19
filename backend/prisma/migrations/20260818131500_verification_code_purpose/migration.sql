-- DropIndex
DROP INDEX "VerificationCode_phone_key";

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'LOGIN';

-- CreateIndex
CREATE UNIQUE INDEX "VerificationCode_phone_purpose_key" ON "VerificationCode"("phone", "purpose");
