-- Identifiants PVit gérables depuis l'admin-web (Paramètres > Passerelles de Paiement)
-- plutôt que par variable d'environnement Render.
ALTER TABLE "SystemSettings" ADD COLUMN "pvitSecretKey" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "pvitCodeUrlPayment" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "pvitMerchantOperationAccountCode" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "pvitCallbackUrlCode" TEXT;
ALTER TABLE "SystemSettings" ADD COLUMN "pvitWebhookSecret" TEXT;
