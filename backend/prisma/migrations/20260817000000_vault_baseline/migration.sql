-- Baseline pour la fonctionnalité Caisse Commune (Vault) : ces 5 tables existaient déjà
-- dans la base (créées hors du suivi de migrations, avant que ce module ne commence à
-- passer par des migrations trackées le 21/08 avec vault_required_approvals). Sans cette
-- migration de rattrapage, `prisma migrate dev` échouait à rejouer proprement l'historique
-- sur une base fraîche : vault_required_approvals tentait un ALTER TABLE "Vault" alors que
-- la table elle-même n'existait pas encore dans la séquence de migrations déclarée.
-- CreateTable
CREATE TABLE "Vault" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenReason" TEXT,
    "frozenAt" TIMESTAMP(3),
    "adminId" TEXT NOT NULL,

    CONSTRAINT "Vault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultMember" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isInitiator" BOOLEAN NOT NULL DEFAULT false,
    "isValidator" BOOLEAN NOT NULL DEFAULT false,
    "isTreasurer" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultTransaction" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "destinationType" TEXT,
    "destinationId" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultApproval" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultVoucher" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "presidentId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VaultMember_vaultId_userId_key" ON "VaultMember"("vaultId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultApproval_transactionId_userId_key" ON "VaultApproval"("transactionId", "userId");

-- AddForeignKey
ALTER TABLE "Vault" ADD CONSTRAINT "Vault_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMember" ADD CONSTRAINT "VaultMember_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultMember" ADD CONSTRAINT "VaultMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultTransaction" ADD CONSTRAINT "VaultTransaction_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultTransaction" ADD CONSTRAINT "VaultTransaction_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultApproval" ADD CONSTRAINT "VaultApproval_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "VaultTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultApproval" ADD CONSTRAINT "VaultApproval_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultVoucher" ADD CONSTRAINT "VaultVoucher_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultVoucher" ADD CONSTRAINT "VaultVoucher_presidentId_fkey" FOREIGN KEY ("presidentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
