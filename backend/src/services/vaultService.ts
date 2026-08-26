import type { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

// Extrait de PUT /:id/roles (vault.ts) pour être réutilisé tel quel par l'override
// admin (admin.vaults.ts, PUT /:id/members/:userId/role) — mêmes garde-fous partout,
// qu'un rôle soit retiré par le Président de la caisse ou par un admin de la plateforme.
export async function applyRoleChangeGuards(
    tx: TxClient,
    vaultId: string,
    targetUserId: string,
    next: { isAdmin?: boolean; isValidator?: boolean }
) {
    if (next.isAdmin === false) {
        const otherAdmins = await tx.vaultMember.count({
            where: { vaultId, isAdmin: true, userId: { not: targetUserId } }
        });
        if (otherAdmins === 0) {
            throw new Error("Impossible de retirer le dernier administrateur de la caisse.");
        }
    }

    if (next.isValidator === false) {
        const otherValidators = await tx.vaultMember.count({
            where: { vaultId, isValidator: true, userId: { not: targetUserId } }
        });
        if (otherValidators === 0) {
            throw new Error("Impossible de retirer le dernier commissaire — plus personne ne pourrait approuver un retrait.");
        }
    }
}

type WithdrawableVaultTransaction = {
    id: string;
    vaultId: string;
    amount: number;
    destinationType: string | null;
    destinationId: string | null;
    requestedById: string;
    vault: { name: string };
};

// Extrait de POST /:id/approve/:txId (vault.ts) pour être réutilisé par l'override
// admin (force-resolve en APPROVE) sans dupliquer la logique de mouvement de fonds.
// Précondition : l'appelant a déjà réclamé atomiquement la transaction
// (status PENDING -> COMPLETED via updateMany) avant d'appeler cette fonction.
export async function executeVaultWithdraw(tx: TxClient, vaultTx: WithdrawableVaultTransaction) {
    const debited = await tx.vault.updateMany({
        where: { id: vaultTx.vaultId, balance: { gte: vaultTx.amount } },
        data: { balance: { decrement: vaultTx.amount } }
    });
    if (debited.count === 0) throw new Error("Solde de la caisse insuffisant pour exécuter ce retrait.");

    if (vaultTx.destinationType === 'TREASURER' || vaultTx.destinationType === 'TRANSFER') {
        if (!vaultTx.destinationId) throw new Error("Destinataire manquant.");

        const destWallet = await tx.wallet.findUnique({ where: { userId: vaultTx.destinationId } });
        if (!destWallet) throw new Error("Portefeuille destinataire introuvable.");

        const settings = await tx.systemSettings.findFirst();
        const fee = settings ? vaultTx.amount * settings.taxP2P : 0;
        const netAmount = vaultTx.amount - fee;

        await tx.wallet.update({
            where: { id: destWallet.id },
            data: { balance: { increment: netAmount } }
        });

        if (fee > 0) {
            const { getOrCreateCorporateWallet } = await import('../routes/wallet');
            const corporate = await getOrCreateCorporateWallet(tx);
            await tx.wallet.update({
                where: { id: corporate.wallet.id },
                data: { balance: { increment: fee } }
            });
        }

        await tx.notification.create({
            data: {
                userId: vaultTx.destinationId,
                title: 'Vous avez reçu un virement de caisse commune',
                body: `${netAmount.toLocaleString('fr-FR')} FCFA reçus depuis « ${vaultTx.vault.name} » (après ${fee} FCFA de frais).`,
                type: 'TRANSACTION'
            }
        });

        await tx.transaction.create({
            data: {
                amount: vaultTx.amount,
                fee,
                senderWalletId: destWallet.id,
                receiverWalletId: destWallet.id,
                status: 'COMPLETED',
                reference: `VAULT_OUT_${vaultTx.id}`
            }
        });
    } else if (vaultTx.destinationType === 'VOUCHER') {
        await tx.vaultVoucher.create({
            data: {
                vaultId: vaultTx.vaultId,
                amount: vaultTx.amount,
                presidentId: vaultTx.requestedById
            }
        });
    }

    await tx.notification.create({
        data: {
            userId: vaultTx.requestedById,
            title: 'Retrait de caisse exécuté',
            body: `Votre demande de ${vaultTx.amount.toLocaleString('fr-FR')} FCFA sur « ${vaultTx.vault.name} » a été approuvée et exécutée.`,
            type: 'TRANSACTION'
        }
    });
}
