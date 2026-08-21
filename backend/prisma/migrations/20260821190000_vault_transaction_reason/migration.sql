-- Motif obligatoire sur une demande de retrait de Caisse Commune — donne aux
-- commissaires de quoi juger la légitimité d'une sortie de fonds avant d'approuver.
ALTER TABLE "VaultTransaction" ADD COLUMN "reason" TEXT;
