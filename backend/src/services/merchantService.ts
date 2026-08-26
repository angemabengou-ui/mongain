import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type TxClient = Prisma.TransactionClient;

// Solde de commission d'un marchand — même convention que Branch.walletId/CentralTreasury.walletId
// (schema.prisma) : un Wallet orphelin (userId null) référencé par une colonne @unique dédiée sur
// le modèle propriétaire, PAS un compte système synthétique (getOrCreateCorporateWallet,
// getTontineVaultWallet) — ceux-là sont des comptes plateforme uniques, pas un par marchand.
// Lazy : créé au premier gain de commission (ou à la première consultation du compte marchand).
export async function getOrCreateMerchantCommissionWallet(userId: string, tx: TxClient = prisma) {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { commissionWallet: true } });
    if (!user) throw new Error('Marchand introuvable.');
    if (user.commissionWallet) return user.commissionWallet;

    const wallet = await tx.wallet.create({ data: { balance: 0 } });
    await tx.user.update({ where: { id: userId }, data: { commissionWalletId: wallet.id } });
    return wallet;
}
