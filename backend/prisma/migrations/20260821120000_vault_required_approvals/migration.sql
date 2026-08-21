-- Nombre d'approbations de commissaires requises pour exécuter un retrait de Caisse Commune.
-- Remplace l'ancienne constante codée en dur (toujours 2) qui bloquait indéfiniment
-- toute caisse n'ayant qu'un seul validateur désigné.
ALTER TABLE "Vault" ADD COLUMN "requiredApprovals" INTEGER NOT NULL DEFAULT 1;
