-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycVendorCheckedAt" TIMESTAMP(3),
ADD COLUMN     "kycVendorProvider" TEXT,
ADD COLUMN     "kycVendorStatus" TEXT;
