-- Corrige trois failles argent réelles identifiées à l'audit sécurité : (1) invest.ts
-- re-dérivait la durée de blocage d'un coffre de staking depuis l'arithmétique de dates
-- (lockedUntil - createdAt), sujette au débordement de mois JS (ex: 31 janvier + 1 mois
-- -> 3 mars), surpayant l'intérêt au retrait — on persiste désormais la durée réellement
-- demandée. (2) Loan n'avait aucune échéance, rendant le statut DEFAULTED inatteignable
-- et le micro-crédit sans aucune gestion de retard. (3) BnplContract ne distinguait pas
-- capital et frais, empêchant tout partage correct des frais de remboursement vers le
-- compte Corporate (contrairement à credit.ts /repay). Additif uniquement — toutes les
-- colonnes sont nullable, aucune donnée existante modifiée ; les lignes déjà en base
-- (créées avant cette migration) gardent l'ancien comportement de repli côté application
-- (voir invest.ts, credit.ts, bnpl.ts, services/creditRisk.ts).

-- AlterTable: StakingVault
ALTER TABLE "StakingVault" ADD COLUMN "lockMonths" INTEGER;

-- AlterTable: Loan
ALTER TABLE "Loan" ADD COLUMN "dueDate" TIMESTAMP(3);

-- AlterTable: BnplContract
ALTER TABLE "BnplContract" ADD COLUMN "originalPrincipal" INTEGER;
