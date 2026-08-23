-- Trésorerie Centrale séparée du Siège (Branch isHQ=true). Schéma seulement — la
-- bascule de données (transfert du wallet Siège existant vers cette table, et
-- attribution d'un wallet neuf au Siège) est faite au premier accès applicatif par
-- getCentralTreasury() (backend/src/services/treasury.ts), pas ici : elle nécessite
-- de choisir QUEL wallet Siège legacy migrer, une décision applicative, pas SQL pure.
CREATE TABLE "CentralTreasury" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Trésorerie Centrale Mongain',
    "walletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CentralTreasury_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CentralTreasury_walletId_key" ON "CentralTreasury"("walletId");

ALTER TABLE "CentralTreasury" ADD CONSTRAINT "CentralTreasury_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
