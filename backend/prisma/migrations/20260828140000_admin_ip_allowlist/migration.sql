-- Restriction réseau du portail personnel (équivalent applicatif d'un VPN pour la jambe
-- admin-web ↔ backend) — désactivée par défaut. Strictement additif.

ALTER TABLE "SystemSettings" ADD COLUMN     "adminIpAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "adminIpAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false;
