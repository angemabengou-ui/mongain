-- Ajoute une clé d'idempotence optionnelle sur VaultTransaction (voir routes/vault.ts,
-- /:id/deposit et /:id/withdraw-request) : ces deux routes n'avaient aucune protection contre
-- un double-clic ou un retry réseau, qui pouvait créer un second dépôt (double débit du wallet
-- personnel du déposant) ou une seconde demande de retrait identique (potentiellement approuvée
-- et exécutée en double par les commissaires, doublant la sortie de fonds réelle) pour un seul
-- geste utilisateur. NULL pour toutes les lignes existantes créées avant ce champ — additif
-- uniquement, aucune donnée modifiée.

-- AlterTable
ALTER TABLE "VaultTransaction" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "VaultTransaction_idempotencyKey_key" ON "VaultTransaction"("idempotencyKey");
