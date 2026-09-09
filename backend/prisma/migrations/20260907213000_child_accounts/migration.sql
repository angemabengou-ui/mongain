-- Comptes Enfant : auto-relation parent/enfant sur User (premier self-relation de ce
-- modèle), champ gender (accent visuel côté mobile uniquement, voir
-- src/constants/childAccent.ts), et plafond de dépense parent-contrôlé, volontairement
-- distinct de customDailyLimit/customMonthlyLimit/customPerTxLimit (qui restent
-- staff-controlled via le circuit maker/checker) — voir LimitEngine.ts.
ALTER TABLE "User" ADD COLUMN "parentId" TEXT;
ALTER TABLE "User" ADD COLUMN "gender" TEXT;
ALTER TABLE "User" ADD COLUMN "childSpendLimitAmount" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN "childSpendLimitPeriod" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
