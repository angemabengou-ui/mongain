-- Maker/checker sur la résolution forcée admin d'un retrait de caisse commune
-- (admin.vaults.ts, force-resolve) — même schéma que TreasuryRequest.makerId/checkerId.
-- Sans second contrôleur DISTINCT du premier, un unique compte staff détenant
-- perm_vault_manage pouvait, seul, débloquer n'importe quel retrait en attente de quorum
-- vers n'importe quelle destination. Additif uniquement, aucune donnée existante modifiée.

-- AlterTable
ALTER TABLE "VaultTransaction" ADD COLUMN "forceResolveMakerId" TEXT,
ADD COLUMN "forceResolveDecision" TEXT,
ADD COLUMN "forceResolveReason" TEXT;

-- AddForeignKey
ALTER TABLE "VaultTransaction" ADD CONSTRAINT "VaultTransaction_forceResolveMakerId_fkey" FOREIGN KEY ("forceResolveMakerId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
