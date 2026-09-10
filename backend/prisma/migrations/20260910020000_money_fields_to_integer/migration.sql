-- Montants FCFA : Float -> Int (voir docs/AUTO_CRITIQUE_PROJET.md). Le FCFA n'a aucune
-- sous-unité ; un flottant ne représente pas exactement un montant décimal, ce qui est
-- inacceptable pour un grand livre. Rapprochement fait avant/après (scratchpad/reconciliation_*.json) :
-- aucune valeur fractionnaire n'existait déjà en base, donc ROUND() ici est un no-op sur les
-- données réelles, purement une correction préventive du type de colonne.
-- Cast explicite en ::numeric avant ROUND() pour éviter les cas limites IEEE-754 des .5 en
-- double precision, et reproduire l'arrondi "moitié vers le haut" utilisé côté application
-- (Math.round). Les taux/ratios (taxP2P, interestRate, apy, exchangeRate...) et les
-- quantités crypto (CryptoWallet.balance, amountCrypto) restent volontairement en Float.

ALTER TABLE "User"
  ALTER COLUMN "loyaltyPoints" DROP DEFAULT,
  ALTER COLUMN "loyaltyPoints" TYPE INTEGER USING ROUND("loyaltyPoints"::numeric)::INTEGER,
  ALTER COLUMN "loyaltyPoints" SET DEFAULT 0,
  ALTER COLUMN "customDailyLimit" TYPE INTEGER USING ROUND("customDailyLimit"::numeric)::INTEGER,
  ALTER COLUMN "customMonthlyLimit" TYPE INTEGER USING ROUND("customMonthlyLimit"::numeric)::INTEGER,
  ALTER COLUMN "customPerTxLimit" TYPE INTEGER USING ROUND("customPerTxLimit"::numeric)::INTEGER,
  ALTER COLUMN "childSpendLimitAmount" TYPE INTEGER USING ROUND("childSpendLimitAmount"::numeric)::INTEGER;

ALTER TABLE "Wallet"
  ALTER COLUMN "balance" DROP DEFAULT,
  ALTER COLUMN "balance" TYPE INTEGER USING ROUND("balance"::numeric)::INTEGER,
  ALTER COLUMN "balance" SET DEFAULT 0,
  ALTER COLUMN "dailySpent" DROP DEFAULT,
  ALTER COLUMN "dailySpent" TYPE INTEGER USING ROUND("dailySpent"::numeric)::INTEGER,
  ALTER COLUMN "dailySpent" SET DEFAULT 0,
  ALTER COLUMN "monthlySpent" DROP DEFAULT,
  ALTER COLUMN "monthlySpent" TYPE INTEGER USING ROUND("monthlySpent"::numeric)::INTEGER,
  ALTER COLUMN "monthlySpent" SET DEFAULT 0;

ALTER TABLE "MerchantPayoutRequest"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "Transaction"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER,
  ALTER COLUMN "fee" DROP DEFAULT,
  ALTER COLUMN "fee" TYPE INTEGER USING ROUND("fee"::numeric)::INTEGER,
  ALTER COLUMN "fee" SET DEFAULT 0;

ALTER TABLE "SystemSettings"
  ALTER COLUMN "kycReqAmount" DROP DEFAULT,
  ALTER COLUMN "kycReqAmount" TYPE INTEGER USING ROUND("kycReqAmount"::numeric)::INTEGER,
  ALTER COLUMN "kycReqAmount" SET DEFAULT 2000000,
  ALTER COLUMN "dailyLimitTier0" DROP DEFAULT,
  ALTER COLUMN "dailyLimitTier0" TYPE INTEGER USING ROUND("dailyLimitTier0"::numeric)::INTEGER,
  ALTER COLUMN "dailyLimitTier0" SET DEFAULT 50000,
  ALTER COLUMN "dailyLimitTier1" DROP DEFAULT,
  ALTER COLUMN "dailyLimitTier1" TYPE INTEGER USING ROUND("dailyLimitTier1"::numeric)::INTEGER,
  ALTER COLUMN "dailyLimitTier1" SET DEFAULT 2000000,
  ALTER COLUMN "agencyWithdrawThreshold" DROP DEFAULT,
  ALTER COLUMN "agencyWithdrawThreshold" TYPE INTEGER USING ROUND("agencyWithdrawThreshold"::numeric)::INTEGER,
  ALTER COLUMN "agencyWithdrawThreshold" SET DEFAULT 500000,
  ALTER COLUMN "dailyLimitTier2" DROP DEFAULT,
  ALTER COLUMN "dailyLimitTier2" TYPE INTEGER USING ROUND("dailyLimitTier2"::numeric)::INTEGER,
  ALTER COLUMN "dailyLimitTier2" SET DEFAULT 5000000,
  ALTER COLUMN "monthlyLimitTier0" DROP DEFAULT,
  ALTER COLUMN "monthlyLimitTier0" TYPE INTEGER USING ROUND("monthlyLimitTier0"::numeric)::INTEGER,
  ALTER COLUMN "monthlyLimitTier0" SET DEFAULT 1000000,
  ALTER COLUMN "monthlyLimitTier1" DROP DEFAULT,
  ALTER COLUMN "monthlyLimitTier1" TYPE INTEGER USING ROUND("monthlyLimitTier1"::numeric)::INTEGER,
  ALTER COLUMN "monthlyLimitTier1" SET DEFAULT 10000000,
  ALTER COLUMN "monthlyLimitTier2" DROP DEFAULT,
  ALTER COLUMN "monthlyLimitTier2" TYPE INTEGER USING ROUND("monthlyLimitTier2"::numeric)::INTEGER,
  ALTER COLUMN "monthlyLimitTier2" SET DEFAULT 50000000,
  ALTER COLUMN "perTxLimitTier0" DROP DEFAULT,
  ALTER COLUMN "perTxLimitTier0" TYPE INTEGER USING ROUND("perTxLimitTier0"::numeric)::INTEGER,
  ALTER COLUMN "perTxLimitTier0" SET DEFAULT 50000,
  ALTER COLUMN "perTxLimitTier1" DROP DEFAULT,
  ALTER COLUMN "perTxLimitTier1" TYPE INTEGER USING ROUND("perTxLimitTier1"::numeric)::INTEGER,
  ALTER COLUMN "perTxLimitTier1" SET DEFAULT 500000,
  ALTER COLUMN "perTxLimitTier2" DROP DEFAULT,
  ALTER COLUMN "perTxLimitTier2" TYPE INTEGER USING ROUND("perTxLimitTier2"::numeric)::INTEGER,
  ALTER COLUMN "perTxLimitTier2" SET DEFAULT 2000000,
  ALTER COLUMN "refundMakerCheckerThreshold" DROP DEFAULT,
  ALTER COLUMN "refundMakerCheckerThreshold" TYPE INTEGER USING ROUND("refundMakerCheckerThreshold"::numeric)::INTEGER,
  ALTER COLUMN "refundMakerCheckerThreshold" SET DEFAULT 100000,
  ALTER COLUMN "antiFractioningMaxAmount" DROP DEFAULT,
  ALTER COLUMN "antiFractioningMaxAmount" TYPE INTEGER USING ROUND("antiFractioningMaxAmount"::numeric)::INTEGER,
  ALTER COLUMN "antiFractioningMaxAmount" SET DEFAULT 100000,
  ALTER COLUMN "maxMintAmount" DROP DEFAULT,
  ALTER COLUMN "maxMintAmount" TYPE INTEGER USING ROUND("maxMintAmount"::numeric)::INTEGER,
  ALTER COLUMN "maxMintAmount" SET DEFAULT 1000000000,
  ALTER COLUMN "treasuryApprovalThreshold" DROP DEFAULT,
  ALTER COLUMN "treasuryApprovalThreshold" TYPE INTEGER USING ROUND("treasuryApprovalThreshold"::numeric)::INTEGER,
  ALTER COLUMN "treasuryApprovalThreshold" SET DEFAULT 5000000,
  ALTER COLUMN "agencyLowLiquidityThreshold" DROP DEFAULT,
  ALTER COLUMN "agencyLowLiquidityThreshold" TYPE INTEGER USING ROUND("agencyLowLiquidityThreshold"::numeric)::INTEGER,
  ALTER COLUMN "agencyLowLiquidityThreshold" SET DEFAULT 15000000,
  ALTER COLUMN "agencyCriticalLiquidity" DROP DEFAULT,
  ALTER COLUMN "agencyCriticalLiquidity" TYPE INTEGER USING ROUND("agencyCriticalLiquidity"::numeric)::INTEGER,
  ALTER COLUMN "agencyCriticalLiquidity" SET DEFAULT 5000000;

ALTER TABLE "TontineGroup"
  ALTER COLUMN "contribution" TYPE INTEGER USING ROUND("contribution"::numeric)::INTEGER;

ALTER TABLE "TontineCycle"
  ALTER COLUMN "totalExpected" TYPE INTEGER USING ROUND("totalExpected"::numeric)::INTEGER,
  ALTER COLUMN "totalCollected" TYPE INTEGER USING ROUND("totalCollected"::numeric)::INTEGER;

ALTER TABLE "TontineContribution"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER,
  ALTER COLUMN "penaltyAmount" DROP DEFAULT,
  ALTER COLUMN "penaltyAmount" TYPE INTEGER USING ROUND("penaltyAmount"::numeric)::INTEGER,
  ALTER COLUMN "penaltyAmount" SET DEFAULT 0;

ALTER TABLE "Branch"
  ALTER COLUMN "balance" DROP DEFAULT,
  ALTER COLUMN "balance" TYPE INTEGER USING ROUND("balance"::numeric)::INTEGER,
  ALTER COLUMN "balance" SET DEFAULT 0;

ALTER TABLE "CashSession"
  ALTER COLUMN "initialCash" DROP DEFAULT,
  ALTER COLUMN "initialCash" TYPE INTEGER USING ROUND("initialCash"::numeric)::INTEGER,
  ALTER COLUMN "initialCash" SET DEFAULT 0,
  ALTER COLUMN "finalCash" TYPE INTEGER USING ROUND("finalCash"::numeric)::INTEGER,
  ALTER COLUMN "totalCashInValue" DROP DEFAULT,
  ALTER COLUMN "totalCashInValue" TYPE INTEGER USING ROUND("totalCashInValue"::numeric)::INTEGER,
  ALTER COLUMN "totalCashInValue" SET DEFAULT 0,
  ALTER COLUMN "totalCashOutValue" DROP DEFAULT,
  ALTER COLUMN "totalCashOutValue" TYPE INTEGER USING ROUND("totalCashOutValue"::numeric)::INTEGER,
  ALTER COLUMN "totalCashOutValue" SET DEFAULT 0,
  ALTER COLUMN "discrepancy" TYPE INTEGER USING ROUND("discrepancy"::numeric)::INTEGER;

ALTER TABLE "TreasuryRequest"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "ReconciliationCase"
  ALTER COLUMN "expectedAmount" TYPE INTEGER USING ROUND("expectedAmount"::numeric)::INTEGER,
  ALTER COLUMN "reportedAmount" TYPE INTEGER USING ROUND("reportedAmount"::numeric)::INTEGER,
  ALTER COLUMN "difference" TYPE INTEGER USING ROUND("difference"::numeric)::INTEGER;

ALTER TABLE "RefundRequest"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "Vault"
  ALTER COLUMN "balance" DROP DEFAULT,
  ALTER COLUMN "balance" TYPE INTEGER USING ROUND("balance"::numeric)::INTEGER,
  ALTER COLUMN "balance" SET DEFAULT 0;

ALTER TABLE "VaultTransaction"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "VaultVoucher"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "VirtualCard"
  ALTER COLUMN "spendingLimit" DROP DEFAULT,
  ALTER COLUMN "spendingLimit" TYPE INTEGER USING ROUND("spendingLimit"::numeric)::INTEGER,
  ALTER COLUMN "spendingLimit" SET DEFAULT 0,
  ALTER COLUMN "balance" DROP DEFAULT,
  ALTER COLUMN "balance" TYPE INTEGER USING ROUND("balance"::numeric)::INTEGER,
  ALTER COLUMN "balance" SET DEFAULT 0;

-- CryptoTransaction : amountCrypto/exchangeRate restent Float (quantité crypto / taux).
ALTER TABLE "CryptoTransaction"
  ALTER COLUMN "amountFiat" TYPE INTEGER USING ROUND("amountFiat"::numeric)::INTEGER,
  ALTER COLUMN "fee" TYPE INTEGER USING ROUND("fee"::numeric)::INTEGER;

ALTER TABLE "SplitRequest"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

-- Loan : interestRate reste Float (taux).
ALTER TABLE "Loan"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER,
  ALTER COLUMN "totalOwed" TYPE INTEGER USING ROUND("totalOwed"::numeric)::INTEGER;

ALTER TABLE "Invoice"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "PayoutBulk"
  ALTER COLUMN "totalAmount" DROP DEFAULT,
  ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount"::numeric)::INTEGER,
  ALTER COLUMN "totalAmount" SET DEFAULT 0;

ALTER TABLE "PayoutEntry"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "MarketListing"
  ALTER COLUMN "price" TYPE INTEGER USING ROUND("price"::numeric)::INTEGER;

ALTER TABLE "EscrowTransaction"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

-- StakingVault : apy reste Float (taux).
ALTER TABLE "StakingVault"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "BillerTransaction"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER;

ALTER TABLE "BnplContract"
  ALTER COLUMN "totalAmount" TYPE INTEGER USING ROUND("totalAmount"::numeric)::INTEGER,
  ALTER COLUMN "remaining" TYPE INTEGER USING ROUND("remaining"::numeric)::INTEGER;

-- RemittanceTransaction : exchangeRate/destinationAmount restent Float (devise étrangère/taux).
ALTER TABLE "RemittanceTransaction"
  ALTER COLUMN "sourceAmountXaf" TYPE INTEGER USING ROUND("sourceAmountXaf"::numeric)::INTEGER,
  ALTER COLUMN "fee" TYPE INTEGER USING ROUND("fee"::numeric)::INTEGER;

ALTER TABLE "EscrowContract"
  ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount"::numeric)::INTEGER,
  ALTER COLUMN "fee" TYPE INTEGER USING ROUND("fee"::numeric)::INTEGER;
