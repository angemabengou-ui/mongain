// Garde de canal pour les marchands géants (mairie, impôts, grandes entreprises) — voir
// schema.prisma (User.merchantTier) et middleware/auth.ts (authMerchantPortal). Un géant est
// piloté depuis le portail web dédié (routes/merchant-portal.ts) ; le mobile reste
// consultation seule pour ce palier, il ne doit jamais pouvoir y déplacer d'argent (transfert,
// retrait, paiement de masse...). Centralisé ici plutôt que dupliqué dans chaque route
// (wallet.ts, b2b.ts) pour garder un seul message/une seule définition à faire évoluer.
export const GIANT_MOBILE_BLOCK_ERROR = "Cette opération n'est pas autorisée depuis l'application mobile pour un compte marchand géant. Utilisez le portail web dédié.";

export function isGiantMerchant(user: { merchantTier?: string | null } | null | undefined): boolean {
    return !!user && user.merchantTier === 'GIANT';
}
