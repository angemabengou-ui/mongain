-- Ajoute une clé d'idempotence optionnelle sur PayoutBulk (voir docs/AUTO_CRITIQUE_PROJET.md,
-- section 8.2) : POST /api/b2b/payouts n'avait ni PIN ni protection contre un double-clic ou
-- un retry réseau, qui recréait un lot identique et le faisait traiter une deuxième fois par
-- processBulkAsync (débit du marchand + crédit de chaque bénéficiaire en double). NULL pour
-- tous les lots existants créés avant ce champ — additif uniquement, aucune donnée modifiée.

-- AlterTable
ALTER TABLE "PayoutBulk" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBulk_idempotencyKey_key" ON "PayoutBulk"("idempotencyKey");
