-- Comptes techniques internes (Corporate, Passerelle Externe, Coffre Tontine, Services
-- Partenaires) en tant que table dédiée, sur le même schéma que CentralTreasury. Schéma
-- seulement — la bascule des données (comptes User{role:"ADMIN"} legacy existants vers
-- cette table, en réutilisant leur wallet existant) est faite par un script applicatif
-- (backend/backfill-system-accounts.ts), pas ici, pour préserver soldes et historique
-- de transactions de chaque compte legacy déjà en production.
CREATE TABLE "SystemAccount" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SystemAccount_kind_key" ON "SystemAccount"("kind");

CREATE UNIQUE INDEX "SystemAccount_walletId_key" ON "SystemAccount"("walletId");

ALTER TABLE "SystemAccount" ADD CONSTRAINT "SystemAccount_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
