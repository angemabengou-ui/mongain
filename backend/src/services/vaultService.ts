import type { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

// Fonction partagée par le flux d'approbation client (vault.ts) ET l'override admin
// (admin.vaults.ts, force-resolve) — un seul push ici couvre les deux. Pas de Socket.IO
// temps réel ici (ce service n'a pas accès à `req`/`io`) : le push Expo suffit à couvrir le
// cas qui compte le plus (app fermée/arrière-plan), les deux appelants gardent leur propre
// notification Socket.IO s'ils veulent aussi l'instantané premier plan.
async function pushToUser(tx: TxClient, userId: string, title: string, body: string) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { pushToken: true } });
    if (!user?.pushToken) return;
    const { sendPush } = await import('../routes/wallet');
    await sendPush(user.pushToken, title, body);
}

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

        let corporateWalletId: string | null = null;
        if (fee > 0) {
            const { getOrCreateCorporateWallet } = await import('../routes/wallet');
            const corporate = await getOrCreateCorporateWallet(tx);
            corporateWalletId = corporate.wallet.id;
            await tx.wallet.update({
                where: { id: corporate.wallet.id },
                data: { balance: { increment: fee } }
            });
        }

        const destTitle = 'Vous avez reçu un virement de caisse commune';
        const destBody = `${netAmount.toLocaleString('fr-FR')} FCFA reçus depuis « ${vaultTx.vault.name} » (après ${fee} FCFA de frais).`;
        await tx.notification.create({
            data: { userId: vaultTx.destinationId, title: destTitle, body: destBody, type: 'TRANSACTION' }
        });
        await pushToUser(tx, vaultTx.destinationId, destTitle, destBody);

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

        // Transaction fantôme dédiée au frais — voir vault.ts (VAULT_DEP_) pour le contexte
        // complet : même convention que wallet.ts (FEE-, FEE-W-, FEE-MM-), sans quoi ce frais
        // n'apparaissait dans aucun graphique de revenu admin.
        if (fee > 0 && corporateWalletId) {
            await tx.transaction.create({
                data: {
                    amount: fee,
                    senderWalletId: destWallet.id,
                    receiverWalletId: corporateWalletId,
                    status: 'COMPLETED',
                    reference: `FEE-VO-${vaultTx.id}`
                }
            });
        }
    } else if (vaultTx.destinationType === 'VOUCHER') {
        await tx.vaultVoucher.create({
            data: {
                vaultId: vaultTx.vaultId,
                amount: vaultTx.amount,
                presidentId: vaultTx.requestedById
            }
        });
    }

    const executedTitle = 'Retrait de caisse exécuté';
    const executedBody = `Votre demande de ${vaultTx.amount.toLocaleString('fr-FR')} FCFA sur « ${vaultTx.vault.name} » a été approuvée et exécutée.`;
    await tx.notification.create({
        data: { userId: vaultTx.requestedById, title: executedTitle, body: executedBody, type: 'TRANSACTION' }
    });
    await pushToUser(tx, vaultTx.requestedById, executedTitle, executedBody);
}
