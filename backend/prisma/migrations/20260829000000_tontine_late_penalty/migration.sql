-- Pénalité de retard tontine (voir tontineService.ts, executeTontineCycle) — désactivée
-- par défaut. Strictement additif.

ALTER TABLE "SystemSettings" ADD COLUMN     "tontineLatePenaltyRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "TontineContribution" ADD COLUMN     "penaltyAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "penaltyAppliedAt" TIMESTAMP(3);
