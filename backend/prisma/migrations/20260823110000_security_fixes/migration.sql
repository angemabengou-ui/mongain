-- Correctifs de l'audit de sécurité : instantané du quorum multisig figé à la création
-- (empêche l'érosion du seuil par départ de commissaires après approbation partielle) et
-- marqueur de cagnotte déjà versée sur une tontine (empêche le créateur de se réattribuer
-- indéfiniment son propre tour via /tontine/reorder).
ALTER TABLE "VaultTransaction" ADD COLUMN "requiredApprovalsSnapshot" INTEGER;
ALTER TABLE "VaultTransaction" ADD COLUMN "requiredValidatorIdsSnapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "TontineParticipant" ADD COLUMN "hasReceivedPayout" BOOLEAN NOT NULL DEFAULT false;
