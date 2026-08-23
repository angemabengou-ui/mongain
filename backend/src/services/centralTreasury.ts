import { prisma } from '../prisma';

// Bascule paresseuse (au premier accès) depuis l'ancien modèle où le Siège (Branch
// isHQ=true) faisait office de Réserve Centrale électronique — voir le commentaire sur
// le modèle CentralTreasury dans schema.prisma pour le pourquoi de la séparation.
//
// Si un Siège legacy a déjà un wallet : ce wallet (solde ET historique de transactions
// intacts, rien n'est recréé) devient celui de la CentralTreasury, et le Siège reçoit un
// wallet neuf à solde 0 pour fonctionner désormais comme une agence normale. Sans Siège
// legacy (nouvelle installation), la CentralTreasury démarre avec un wallet vierge.
//
// `client` accepte soit le PrismaClient racine, soit un client de transaction (`tx`) —
// dans ce second cas, la bascule fait partie de la transaction appelante (rollback
// inclus en cas d'échec plus loin). Appelé hors transaction, la fenêtre entre le
// `findFirst` et la création n'est pas verrouillée ; en cas de course rarissime (deux
// tout premiers accès simultanés juste après ce déploiement), la contrainte unique sur
// `walletId` fait échouer le second essai proprement plutôt que de dupliquer la bascule.
export async function getCentralTreasury(client: any = prisma) {
    const existing = await client.centralTreasury.findFirst({ include: { wallet: true } });
    if (existing) return existing;

    const legacyHQ = await client.branch.findFirst({ where: { isHQ: true }, include: { wallet: true } });

    if (legacyHQ?.wallet) {
        const created = await client.centralTreasury.create({
            data: { walletId: legacyHQ.wallet.id },
            include: { wallet: true }
        });
        const freshWallet = await client.wallet.create({ data: { balance: 0, currency: 'FCFA' } });
        await client.branch.update({ where: { id: legacyHQ.id }, data: { walletId: freshWallet.id } });
        return created;
    }

    const wallet = await client.wallet.create({ data: { balance: 0, currency: 'FCFA' } });
    return client.centralTreasury.create({ data: { walletId: wallet.id }, include: { wallet: true } });
}
