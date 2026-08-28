-- 2FA personnel (portail admin-web) : voir le commentaire sur le modèle StaffVerificationCode
-- dans schema.prisma pour le contexte. Strictement additif.

CREATE TABLE "StaffVerificationCode" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffVerificationCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffVerificationCode_staffId_key" ON "StaffVerificationCode"("staffId");

ALTER TABLE "StaffVerificationCode" ADD CONSTRAINT "StaffVerificationCode_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
