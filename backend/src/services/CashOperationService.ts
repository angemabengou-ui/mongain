import type { Server } from 'socket.io';
import { prisma } from '../prisma';
import { getSystemSettings } from '../routes/settings';
import { getOrCreateCorporateWallet } from '../routes/wallet';
import { generateReference } from '../utils/reference';
import { LimitEngine } from './LimitEngine';

export class CashOperationService {

    /**
     * Exécute un Dépôt Cash-In en agence.
     * Logique: L'agence reçoit de l'espèce physique (balance) et débite de sa monnaie électronique (wallet).
     * Le client est crédité en monnaie électronique.
     */
    static async executeCashIn(params: {
        amount: number;
        clientPhone: string;
        tellerId: string;
        branchId: string;
        idempotencyKey?: string;
        // Passé par l'appelant (req.app.get('io')) plutôt qu'importé depuis '../index' au
        // niveau du module : ce service était auparavant chargé au démarrage avec toute
        // l'application (routes, serveur HTTP) comme effet de bord de ce seul import — un
        // simple require de agency.ts suffisait à démarrer index.ts, cassant par exemple les
        // tests qui montent agency.ts isolément avec des middlewares mockés.
        io?: Server;
    }) {
        const { amount, clientPhone, tellerId, branchId, idempotencyKey, io } = params;
        if (amount <= 0) throw new Error("Le montant doit être positif.");

        const transaction = await prisma.$transaction(async (tx) => {
            // 1. Idempotence Guard
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return dup;
            }

            // 2. Vérification Session
            const session = await tx.cashSession.findFirst({
                where: { tellerId, status: 'OPEN', branchId }
            });
            if (!session) throw new Error("Aucune session de caisse ouverte pour ce Teller dans cette agence.");

            // 3. Vérification Agence et Liquidité (Wallet monnaie électronique)
            const branch = await tx.branch.findUnique({
                where: { id: branchId },
                include: { wallet: true }
            });
            if (!branch || !branch.wallet) throw new Error("Configuration agence introuvable.");
            if (branch.status !== 'ACTIVE') throw new Error("L'agence n'est pas active.");
            if (branch.wallet.balance < amount) throw new Error("Liquidité électronique agence insuffisante.");

            // 4. Vérification Client
            const client = await tx.user.findUnique({
                where: { phone: clientPhone },
                include: { wallet: true }
            });
            if (!client || !client.wallet) throw new Error("Client introuvable.");
            if (client.accountStatus !== 'ACTIVE') throw new Error(`Le compte est ${client.accountStatus}. Autorisation refusée.`);

            // 🛑 PESSIMISTIC LOCKING : Verrouillage strict de la ligne en base de données.
            // PostgreSQL bloque toute autre transaction tentant de modifier ce Wallet jusqu'au COMMIT.
            await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${client.wallet.id} FOR UPDATE;`;
            await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${branch.wallet.id} FOR UPDATE;`;

            // 5. Mises à jour Financières
            const reference = generateReference('CIN');

            // On déduit la monnaie E de l'agence — garde atomique (balance: gte) en plus du
            // contrôle ci-dessus : deux Cash-In simultanés du même Teller/agence liraient la
            // même balance non verrouillée et passeraient tous deux le contrôle informatif,
            // ce qui pouvait faire passer la liquidité électronique de l'agence en négatif.
            await tx.wallet.update({
                where: { id: branch.wallet.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });

            // Politique produit : un dépôt (Cash-In) est TOUJOURS gratuit, en agence comme
            // chez un commerçant — seuls les retraits sont facturés (taxWithdraw chez un
            // commerçant, agencyTaxWithdraw au-delà du seuil en agence, voir executeCashOut
            // et wallet.ts /client-initiated-withdraw). Le client reçoit donc l'intégralité
            // du montant déposé ; aucun frais n'est prélevé ni configurable ici.
            const fee = 0;

            await tx.wallet.update({
                where: { id: client.wallet.id },
                data: { balance: { increment: amount } }
            });

            // 6. Enregistrement Transaction
            const transaction = await tx.transaction.create({
                data: {
                    senderWalletId: branch.wallet.id,
                    receiverWalletId: client.wallet.id,
                    amount,
                    fee,
                    type: 'CASH_IN',
                    status: 'COMPLETED',
                    reference,
                    branchId,
                    tellerId,
                    idempotencyKey
                }
            });

            // 7. Update coffre physique (L'agence a pris les billets)
            await tx.branch.update({
                where: { id: branchId },
                data: { balance: { increment: amount } }
            });

            // 8. Update Tally Caisse
            await tx.cashSession.update({
                where: { id: session.id },
                data: { totalCashInValue: { increment: amount } }
            });

            // Comme /transfer et /refund-requests : sans ça, le client n'a aucune trace de ce
            // dépôt physique en agence dans son historique de notifications.
            await tx.notification.create({
                data: { userId: client.id, title: 'Dépôt reçu', body: `Vous avez reçu un dépôt de ${amount.toLocaleString('fr-FR')} FCFA en agence.`, type: 'TRANSACTION' }
            });

            return transaction;
        });

        // Notification temps réel (Socket.IO), comme /transfer : le déposant n'est pas
        // forcément le titulaire du compte (dépôt fait par un tiers pour lui) — sans cet
        // événement, le client ne voyait ce dépôt qu'à la prochaine ouverture de son onglet
        // Notifications, jamais en direct pendant qu'il est en ligne dans l'app.
        io?.to(`user_${clientPhone}`).emit('payment_received', { amount, from: 'Dépôt en agence' });

        return transaction;
    }

    /**
     * Exécute un Retrait Cash-Out en agence.
     * Logique: Le client déduit sa monnaie électronique. L'agence crédite son E-wallet, et sort les billets du coffre physique.
     */
    static async executeCashOut(params: {
        amount: number;
        clientPhone: string;
        tellerId: string;
        branchId: string;
        idempotencyKey?: string;
    }) {
        const { amount, clientPhone, tellerId, branchId, idempotencyKey } = params;
        if (amount <= 0) throw new Error("Le montant doit être positif.");

        // Résolu hors transaction, comme getTontineVaultWallet (tontineService.ts) : au
        // tout premier retrait facturé, ce lookup crée le compte Corporate — un aller-
        // retour de trop dans une transaction interactive déjà longue (garde par défaut
        // Prisma de 5s), qui expirait sous charge réseau réelle (vérifié en la testant :
        // "Transaction already closed... 5335 ms passed"). Une fois créé une bonne fois
        // pour toutes ici, chaque appel suivant ne coûte plus qu'un miss de cache trivial.
        const corporateWallet = (await getOrCreateCorporateWallet(prisma)).wallet;

        return await prisma.$transaction(async (tx) => {
            // 1. Idempotence Guard
            if (idempotencyKey) {
                const dup = await tx.transaction.findUnique({ where: { idempotencyKey } });
                if (dup) return dup;
            }

            // 2. Session & Vault check
            const session = await tx.cashSession.findFirst({
                where: { tellerId, status: 'OPEN', branchId }
            });
            if (!session) throw new Error("Aucune session de caisse ouverte.");
            const branch = await tx.branch.findUnique({ where: { id: branchId }, include: { wallet: true } });
            if (!branch || !branch.wallet) throw new Error("Configuration agence introuvable.");

            // Sécurité Liquidité Physique (Il faut pouvoir donner des billets)
            if (branch.balance < amount) throw new Error("Liquidité physique (coffre) insuffisante en agence ! Veuillez faire une demande de fond (Funding Request).");

            // 4. Client Check & Eligibility (Limits)
            const client = await tx.user.findUnique({
                where: { phone: clientPhone },
                include: { wallet: true, riskFlags: { where: { status: 'OPEN' } } }
            });
            if (!client || !client.wallet) throw new Error("Client introuvable.");
            if (client.accountStatus !== 'ACTIVE') throw new Error(`Compte client ${client.accountStatus}.`);
            if (client.riskFlags.length > 0) throw new Error(`Ce compte possède ${client.riskFlags.length} flags de risque. Fraude suspectée, retrait bloqué.`);

            // 🛑 PESSIMISTIC LOCKING : Verrouillage strict
            await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${client.wallet.id} FOR UPDATE;`;
            await tx.$executeRaw`SELECT id FROM "Wallet" WHERE id = ${branch.wallet.id} FOR UPDATE;`;

            // 5. Limit Engine Validation
            // getSystemSettings() (mis en cache) plutôt que tx.systemSettings.findFirst() :
            // un round-trip Neon de moins à l'intérieur de cette transaction.
            const settings = await getSystemSettings();
            // Délégué à LimitEngine (comme tous les autres rails sortants — /transfer,
            // /client-initiated-withdraw, /push, /pay-bill) plutôt que réimplémenté ici : la
            // version précédente lisait `client.wallet.dailySpent/monthlySpent` bruts sans
            // AUCUNE logique de remise à zéro (contrairement à LimitEngine, qui gère la bascule
            // jour/mois) — un compte pouvait ainsi voir son plafond mensuel devenir
            // définitivement infranchissable au guichet une fois le cumul de sa vie entière
            // dépassé, alors que le même montant passait sans problème par un transfert P2P
            // (qui, lui, passait bien par LimitEngine). Vérifie aussi le plafond PAR
            // TRANSACTION (effectivePerTx), absent du contrôle manuel précédent. Basé sur
            // `amount` seul (pas `amount + fee`), comme toutes les autres routes — les frais de
            // service ne comptent pas dans le suivi AML du montant réellement déplacé.
            await LimitEngine.verifyAndIncrementConsumption(tx, client.id, client.wallet.id, amount, settings);

            // 6. Anti-Fractionnement Check global (Toutes succursales confondues)
            if (settings) {
                const hours = settings.antiFractioningWindowHours || 24;
                const windowEnd = new Date();
                const windowStart = new Date(windowEnd.getTime() - hours * 3600 * 1000);

                const pastOps = await tx.transaction.findMany({
                    where: {
                        senderWalletId: client.wallet.id,
                        type: 'CASH_OUT',
                        createdAt: { gte: windowStart }
                    },
                    select: { amount: true, branchId: true }
                });

                const totalPastAmount = pastOps.reduce((sum, t) => sum + t.amount, 0);
                const combinedAmount = totalPastAmount + amount;

                const uniqueBranches = new Set(pastOps.map(t => t.branchId).filter(Boolean));
                uniqueBranches.add(branchId);

                if (combinedAmount > settings.antiFractioningMaxAmount && (uniqueBranches.size > 1 || pastOps.length >= settings.antiFractioningMaxCount)) {
                    const action = settings.antiFractioningAction;
                    if (action === 'BLOCK') {
                        await tx.riskFlag.create({
                            data: {
                                userId: client.id, authorId: tellerId, type: 'ANTI_FRACTIONING',
                                description: `Action bloquage Cash-Out de ${amount} suite dépassement du seuil par cumul.`
                            }
                        });
                        throw new Error("Opération rejetée : Politique d'Anti-Fractionnement activée.");
                    }
                }
            }

            // 6. Facturation et Frais dynamiques — un guichet Staff/Agence (TellerTerminal)
            // applique le modèle Agence (gratuit jusqu'au seuil, puis un taux marginal sur
            // le seul dépassement), pas le taux marchand fixe (taxWithdraw, 1,3%) qu'il
            // appliquait ici par erreur — ce dernier reste réservé aux retraits chez un
            // marchand (wallet.ts /client-initiated-withdraw), un guichet différent.
            const threshold = settings?.agencyWithdrawThreshold ?? 500000;
            const agencyRate = settings?.agencyTaxWithdraw ?? 0.01;
            const fee = amount > threshold ? (amount - threshold) * agencyRate : 0;
            const totalToDeduct = amount + fee;

            if (client.wallet.balance < totalToDeduct) {
                throw new Error(`Solde insuffisant. Il faut ${totalToDeduct} FCFA (incluant ${fee} FCFA de frais).`);
            }

            const reference = generateReference('COT');

            // 7. Mouvements Monnaie Electronique — garde atomique (balance: gte) : le contrôle du
            // point 6 lit une balance non verrouillée, donc deux Cash-Out simultanés pour le même
            // client (ex: le même code secret redeemé par deux agents en parallèle) passeraient
            // tous deux ce contrôle et pourraient faire passer le solde en négatif.
            // dailySpent/monthlySpent déjà incrémentés (sur `amount`, avec la bonne logique de
            // reset) par LimitEngine.verifyAndIncrementConsumption ci-dessus — les incrémenter
            // une seconde fois ici (sur `totalToDeduct`, sans reset) comptait les frais deux
            // fois dans le suivi AML et re-corrompait le cumul juste après que LimitEngine
            // l'ait correctement remis à zéro au passage du jour/mois.
            await tx.wallet.update({
                where: { id: client.wallet.id, balance: { gte: totalToDeduct } },
                data: { balance: { decrement: totalToDeduct } }
            });

            await tx.wallet.update({
                where: { id: branch.wallet.id },
                data: { balance: { increment: amount } } // L'agence récupère l'équivalent de ce qu'elle sort en physique
            });

            if (fee > 0) {
                // Le revenu généré par la plateforme va au Corporate — ce compte est un
                // User dédié identifié par téléphone (CORPORATE_PHONE, wallet.ts), pas un
                // rôle. `role: 'SUPER_ADMIN'` n'existe que sur le modèle Staff, jamais sur
                // User : cette recherche ne trouvait donc jamais rien, et les frais
                // prélevés au client n'étaient crédités nulle part — ils disparaissaient
                // silencieusement à chaque retrait guichet facturé. Résolu hors transaction
                // (corporateWallet, plus haut) plutôt que re-cherché ici.
                await tx.wallet.update({ where: { id: corporateWallet.id }, data: { balance: { increment: fee } } });
            }

            // 8. Opération transaction
            const transaction = await tx.transaction.create({
                data: {
                    senderWalletId: client.wallet.id,
                    receiverWalletId: branch.wallet.id,
                    amount,
                    fee,
                    type: 'CASH_OUT',
                    status: 'COMPLETED',
                    reference,
                    branchId,
                    tellerId,
                    idempotencyKey
                }
            });

            // 9. Mouvements Caisses Physiques — même garde atomique que le wallet client ci-dessus.
            await tx.branch.update({
                where: { id: branchId, balance: { gte: amount } },
                data: { balance: { decrement: amount } } // On décaisse le physique remis au client
            });

            await tx.cashSession.update({
                where: { id: session.id },
                data: { totalCashOutValue: { increment: amount } }
            });

            await tx.notification.create({
                data: { userId: client.id, title: 'Retrait effectué', body: `Vous avez retiré ${amount.toLocaleString('fr-FR')} FCFA en agence (frais : ${fee.toLocaleString('fr-FR')} FCFA).`, type: 'TRANSACTION' }
            });

            return transaction;
        }, { timeout: 15000 });
        // Timeout relevé à 15s (défaut Prisma : 5s) — cette transaction enchaîne une
        // douzaine d'allers-retours séquentiels (session, agence, client, plafonds,
        // anti-fractionnement, écritures) ; contre la base distante, elle expirait déjà
        // sous charge réseau réelle, y compris avant l'ajout du crédit Corporate ci-dessus
        // (vérifié en le reproduisant : "Transaction already closed... 5335 ms passed").
    }

}

