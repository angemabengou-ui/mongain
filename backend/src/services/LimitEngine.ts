import { prisma } from '../prisma';
import { startOfDayInTimezone, startOfMonthInTimezone, startOfWeekInTimezone } from '../utils/timezone';

// Plafond Absolu Réglementaire CEMAC / COBAC (Exemple: 10M FCFA)
export const MAXIMUM_ALLOWED_LIMIT = 10000000;

// Valeurs de repli si SystemSettings n'a pas encore été seedé (évite un crash
// si un appelant oublie de passer par getSystemSettings()).
const FALLBACK_SETTINGS = {
    dailyLimitTier0: 50000, dailyLimitTier1: 2000000, dailyLimitTier2: 5000000,
    monthlyLimitTier0: 1000000, monthlyLimitTier1: 10000000, monthlyLimitTier2: 50000000,
    perTxLimitTier0: 50000, perTxLimitTier1: 500000, perTxLimitTier2: 2000000,
};

export class LimitEngine {

    /**
     * Calcule précisément les limites applicables pour un client à un instant T.
     * Ordre de résolution : Réglementaire > KYC (SystemSettings) > Custom (Si approuvé & non expiré).
     */
    static async getApplicableLimits(user: any, settings: any) {
        settings = settings || FALLBACK_SETTINGS;

        // Base limits based on KYC Level
        let baseDaily = settings.dailyLimitTier0;
        let baseMonthly = settings.monthlyLimitTier0 || 1000000;
        let basePerTx = settings.perTxLimitTier0 || 50000;

        if (user.kycLevel === 1) {
            baseDaily = settings.dailyLimitTier1;
            baseMonthly = settings.monthlyLimitTier1 || 10000000;
            basePerTx = settings.perTxLimitTier1 || 500000;
        } else if (user.kycLevel >= 2) {
            baseDaily = settings.dailyLimitTier2 || 5000000;
            baseMonthly = settings.monthlyLimitTier2 || 50000000;
            basePerTx = settings.perTxLimitTier2 || 2000000;
        }

        const now = new Date();
        const customActive = user.customLimitExpiresAt ? user.customLimitExpiresAt > now : true;

        // Custom limits override KYC if they exist and are active
        let effectiveDaily = (customActive && user.customDailyLimit) ? user.customDailyLimit : baseDaily;
        let effectiveMonthly = (customActive && user.customMonthlyLimit) ? user.customMonthlyLimit : baseMonthly;
        let effectivePerTx = (customActive && user.customPerTxLimit) ? user.customPerTxLimit : basePerTx;
        let effectiveWeekly: number | null = null;

        // Comptes Enfant : plafond parent-contrôlé (self-service, sans workflow d'approbation —
        // voir routes/family.ts), appliqué EN PLUS du plafond KYC ci-dessus, jamais à sa place :
        // le plus restrictif des deux gagne. Un DAILY resserre simplement effectiveDaily ; un
        // WEEKLY n'a pas d'équivalent KYC préexistant dans ce moteur, donc il alimente son propre
        // effectiveWeekly (vérifié séparément, par agrégation live, dans
        // verifyAndIncrementConsumption — pas de nouveau compteur sur Wallet).
        if (user.role === 'CHILD' && user.childSpendLimitAmount) {
            if (user.childSpendLimitPeriod === 'WEEKLY') {
                effectiveWeekly = user.childSpendLimitAmount;
            } else {
                effectiveDaily = Math.min(effectiveDaily, user.childSpendLimitAmount);
            }
        }

        // Regulatory Absolute Clamp
        effectiveDaily = Math.min(effectiveDaily, MAXIMUM_ALLOWED_LIMIT);
        effectiveMonthly = Math.min(effectiveMonthly, MAXIMUM_ALLOWED_LIMIT * 5); // Ex: 50M
        effectivePerTx = Math.min(effectivePerTx, MAXIMUM_ALLOWED_LIMIT);
        if (effectiveWeekly !== null) effectiveWeekly = Math.min(effectiveWeekly, MAXIMUM_ALLOWED_LIMIT);

        return {
            effectiveDaily,
            effectiveMonthly,
            effectivePerTx,
            effectiveWeekly,
            baseDaily,
            baseMonthly,
            basePerTx,
            isCustomActive: !!((user.customDailyLimit || user.customMonthlyLimit || user.customPerTxLimit) && customActive)
        };
    }

    /**
     * Algorithmique SAR (Suspicious Activity Reporting).
     * Gèle algorithmiquement un compte si une signature de Smurfing ou Structuration est detectée.
     * Exemple : > 20 transactions en 1 heure.
     */
    static async detectAndFreezeSAR(tx: any, userId: string): Promise<boolean> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const velocity = await tx.transaction.count({
            where: {
                senderWallet: { userId },
                createdAt: { gte: oneHourAgo }
            }
        });

        if (velocity > 15) {
            // BUG CORRIGÉ : écrire le gel via `tx` (le client transactionnel de l'appelant) ne
            // servait à rien, même une fois les champs d'AuditLog corrigés — `verifyAndIncrementConsumption`
            // lève volontairement une exception juste après ce retour pour bloquer l'opération en
            // cours, et un `throw` à l'intérieur d'un `$transaction` interactif Prisma annule
            // TOUTES ses écritures. Le gel et l'entrée d'audit se retrouvaient donc annulés
            // (ROLLBACK) à chaque déclenchement réel du SAR — silencieusement, puisque le tx mocké
            // des tests n'a pas cette sémantique et laissait croire que le gel persistait. On
            // écrit ici via le client racine `prisma`, dans sa propre transaction indépendante,
            // qui committe immédiatement quel que soit le sort de la transaction appelante.
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: userId },
                    data: { isActive: false, kycStatus: 'REJECTED' }
                }),
                prisma.auditLog.create({
                    data: {
                        adminId: userId,
                        action: 'AML_FREEZE_SAR',
                        details: `Vélocité suspecte détectée (${velocity} tx/h). Compte gelé automatiquement.`,
                    }
                })
            ]);
            return true;
        }
        return false;
    }

    /**
     * Moteur central pour interroger ET incrémenter les consommations de manière transactionnelle.
     */
    static async verifyAndIncrementConsumption(
        tx: any,
        userId: string,
        walletId: string,
        requestedAmount: number,
        settings: any
    ) {
        // 1. Charger User avec la date d'expiration custom
        const user = await tx.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                role: true,
                kycLevel: true,
                customDailyLimit: true,
                customMonthlyLimit: true,
                customPerTxLimit: true,
                customLimitExpiresAt: true,
                childSpendLimitAmount: true,
                childSpendLimitPeriod: true,
                isActive: true,
                lockedUntil: true
            }
        });

        if (!user) throw new Error('Compte introuvable');
        // CHILD doit rester soumis aux plafonds (voir getApplicableLimits) — seul un rôle
        // Staff/Internal (AGENT, ADMIN, MERCHANT...) est réellement exempté. Un simple
        // `!== 'USER'` exemptait AUSSI un compte enfant de toute vérification, l'exact inverse
        // de ce que le plafond parent-contrôlé est censé garantir.
        if (user.role !== 'USER' && user.role !== 'CHILD') return; // Exemptions for Staff/Internal

        if (!user.isActive || (user.lockedUntil && user.lockedUntil > new Date())) {
            throw new Error('Le compte est gelé ou suspendu. Action interdite.');
        }

        // 2. Charger le Wallet SOUS VERROU DE LIGNE explicite. Un simple `findUnique` ne
        // verrouille rien en PostgreSQL (READ COMMITTED) : N requêtes concurrentes sur le même
        // wallet lisent toutes le même `dailySpent`/`monthlySpent` de départ, passent toutes
        // le contrôle des plafonds ci-dessous, puis s'incrémentent chacune correctement (pas de
        // perte de compteur) — mais la DÉCISION, elle, a déjà été prise N fois sur une valeur
        // périmée : le plafond réglementaire peut être dépassé d'un facteur N en parallélisant
        // les requêtes, alors même que le solde réel reste protégé par la garde `balance: gte`
        // des appelants. `SELECT ... FOR UPDATE` fait attendre toute transaction concurrente
        // sur ce wallet jusqu'au commit de celle-ci, fermant la fenêtre de course.
        await tx.$queryRaw`SELECT id FROM "Wallet" WHERE id = ${walletId} FOR UPDATE`;
        const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
        if (!wallet) throw new Error('Portefeuille introuvable');

        // 2.5 SAR Engine Check (Anti-Smurfing)
        const isFrozen = await this.detectAndFreezeSAR(tx, userId);
        if (isFrozen) throw new Error("Compte gelé par réseau Sécurité (SAR Fraud). Vélocité anormale détectée.");

        // 3. Calculs des Limites Hiérarchisées
        const limits = await this.getApplicableLimits(user, settings);

        // 4. Vérification PER TRANSACTION
        if (requestedAmount > limits.effectivePerTx) {
            throw new Error(`Plafond par transaction dépassé. (Max autorisé: ${limits.effectivePerTx.toLocaleString('fr-FR')} FCFA).`);
        }

        // 5. Réinitialisation temporelle si on a changé de jour/mois — frontière calculée dans
        // le fuseau CONFIGURÉ (SystemSettings.timezone, Africa/Libreville par défaut), jamais
        // l'heure locale du process serveur (UTC sur Render) : `new Date(now.getFullYear(),
        // now.getMonth(), now.getDate())` calculait minuit heure SERVEUR, décalé jusqu'à 1h de
        // minuit à Libreville — le reset des plafonds journaliers/mensuels AML pouvait donc se
        // déclencher jusqu'à 1h trop tôt ou trop tard par rapport à la journée réglementaire
        // voulue (même bug que merchant.ts /stats, déjà corrigé avec ce même helper).
        const now = new Date();
        const timezone = settings?.timezone || 'Africa/Libreville';
        const startOfDay = startOfDayInTimezone(timezone, now);
        const startOfMonth = startOfMonthInTimezone(timezone, now);

        // `dailyReset`/`monthlyReset` calculés UNE SEULE FOIS ici, sur les valeurs ORIGINALES
        // de `wallet` (jamais mutées) — la version précédente écrivait `wallet.dailySpentResetAt
        // = now` avant de comparer `wallet.dailySpentResetAt < startOfDay` plus bas (point 7),
        // donc cette comparaison portait toujours sur `now < startOfDay` (toujours faux) : ni
        // `dailySpent` ni `monthlySpent` n'étaient JAMAIS réellement remis à zéro par ce code —
        // seul un CRON séparé (cron.ts) compensait pour le journalier, rien n'existait pour le
        // mensuel, qui grossissait indéfiniment et rendait le plafond mensuel inopposable.
        const dailyReset = wallet.dailySpentResetAt < startOfDay;
        const monthlyReset = !wallet.monthlySpentResetAt || wallet.monthlySpentResetAt < startOfMonth;

        const currentDailySpent = dailyReset ? 0 : wallet.dailySpent;
        const currentMonthlySpent = monthlyReset ? 0 : (wallet.monthlySpent || 0);

        // 6. Vérifications des Cumuls
        const newDaily = currentDailySpent + requestedAmount;
        const newMonthly = currentMonthlySpent + requestedAmount;

        if (newDaily > limits.effectiveDaily) {
            const dispo = Math.max(0, limits.effectiveDaily - currentDailySpent);
            throw new Error(`Plafond journalier dépassé. Limite: ${limits.effectiveDaily.toLocaleString()} FCFA. Reste: ${dispo.toLocaleString()}`);
        }

        if (newMonthly > limits.effectiveMonthly) {
            const dispo = Math.max(0, limits.effectiveMonthly - currentMonthlySpent);
            throw new Error(`Plafond mensuel dépassé. Limite: ${limits.effectiveMonthly.toLocaleString()} FCFA. Reste: ${dispo.toLocaleString()}`);
        }

        // 6.5 Plafond HEBDOMADAIRE (Comptes Enfant uniquement — voir getApplicableLimits).
        // Gaté par `effectiveWeekly !== null` : sans coût pour tout compte non-CHILD, qui ne
        // déclenche jamais cette requête.
        if (limits.effectiveWeekly !== null) {
            const currentWeeklySpent = await this.getWeeklySpent(tx, walletId, settings);
            const newWeekly = currentWeeklySpent + requestedAmount;

            if (newWeekly > limits.effectiveWeekly) {
                const dispo = Math.max(0, limits.effectiveWeekly - currentWeeklySpent);
                throw new Error(`Plafond hebdomadaire dépassé. Limite: ${limits.effectiveWeekly.toLocaleString()} FCFA. Reste: ${dispo.toLocaleString()}`);
            }
        }

        // 7. Mise à jour — incrément relatif, pas un SET absolu basé sur la lecture du
        // point 2 : deux transactions concurrentes sur le même wallet liraient le même
        // `dailySpent` de départ et écriraient chacune leur propre valeur absolue, la
        // seconde écrasant la contribution de la première. Le plafond journalier/mensuel
        // pouvait ainsi être dépassé en enchaînant des requêtes en parallèle (le solde
        // réel reste protégé par la garde `balance: gte` des routes appelantes, mais le
        // suivi de conformité AML/plafonds, lui, se corrompait silencieusement).
        // (dailyReset/monthlyReset déjà calculés au point 5, sur les valeurs non mutées.)
        await tx.wallet.update({
            where: { id: walletId },
            data: {
                dailySpent: dailyReset ? requestedAmount : { increment: requestedAmount },
                dailySpentResetAt: dailyReset ? now : undefined,
                monthlySpent: monthlyReset ? requestedAmount : { increment: requestedAmount },
                monthlySpentResetAt: monthlyReset ? now : undefined
            }
        });
    }

    /**
     * Cumul hebdomadaire glissant (semaine calendaire, démarrant le lundi) pour le plafond
     * parent-contrôlé d'un Compte Enfant — calculé par agrégation live sur Transaction plutôt
     * qu'un nouveau compteur sur Wallet (même principe que calculateWithdrawalFee plus bas dans
     * ce fichier), pour ne rien écrire de supplémentaire à chaque transaction de chaque
     * utilisateur pour un besoin propre aux seuls comptes enfant. Partagée entre l'application
     * du plafond (verifyAndIncrementConsumption) et son affichage (GET /wallet/limits).
     *
     * `settings` optionnel (et non le 3e argument obligatoire) pour rester appelable sans
     * changement partout où seul le fuseau par défaut importe ; les deux appelants réels
     * (verifyAndIncrementConsumption, GET /wallet/limits) ont déjà `settings` sous la main et
     * le passent, pour éviter tout aller-retour DB supplémentaire dans ce chemin financier.
     */
    static async getWeeklySpent(tx: any, walletId: string, settings?: any): Promise<number> {
        // Même correctif de fuseau que verifyAndIncrementConsumption ci-dessus (heure du
        // process serveur -> heure configurée, Africa/Libreville par défaut) : sans lui, le
        // début de semaine glissant pouvait basculer jusqu'à 1h trop tôt/trop tard, faussant le
        // plafond hebdomadaire des Comptes Enfant tout comme les plafonds journalier/mensuel.
        const timezone = settings?.timezone || 'Africa/Libreville';
        const startOfWeek = startOfWeekInTimezone(timezone);

        const weeklyAgg = await tx.transaction.aggregate({
            where: {
                senderWalletId: walletId,
                createdAt: { gte: startOfWeek },
                status: 'COMPLETED',
            },
            _sum: { amount: true },
        });
        return weeklyAgg._sum.amount || 0;
    }

    /**
     * Anti-Fractionnement (Structuration) — extrait de CashOperationService.executeCashOut
     * pour être partagé par TOUS les rails de cash-out (retrait guichet Staff, /qr-cash-out et
     * /client-initiated-withdraw dans wallet.ts) : seul executeCashOut appliquait jusqu'ici
     * cette protection, laissant les deux autres rails totalement ouverts au fractionnement
     * (structuring) d'un retrait sur plusieurs opérations/agences pour rester sous le radar.
     *
     * `authorId` (Staff.id) est utilisé comme auteur du RiskFlag créé en cas d'ALERT/BLOCK/
     * APPLY_FEE — RiskFlag.authorId est une FK vers Staff (jamais vers User), donc `null`
     * doit être passé depuis les rails self-service (aucun Staff impliqué, ex: retrait chez
     * un Agent/Commerçant initié par le client lui-même) : le blocage et la pénalité
     * s'appliquent alors identiquement, seule la trace RiskFlag (best-effort, réservée aux
     * guichets tenus par un Staff) est omise faute d'auteur valide.
     */
    static async checkAntiFractioning(
        tx: any,
        clientId: string,
        walletId: string,
        amount: number,
        branchId: string | null | undefined,
        authorId: string | null | undefined,
        settings: any
    ): Promise<number> {
        if (!settings) return 0;

        const hours = settings.antiFractioningWindowHours || 24;
        const windowEnd = new Date();
        const windowStart = new Date(windowEnd.getTime() - hours * 3600 * 1000);

        const pastOps = await tx.transaction.findMany({
            where: {
                senderWalletId: walletId,
                type: 'CASH_OUT',
                createdAt: { gte: windowStart }
            },
            select: { amount: true, branchId: true }
        });

        const totalPastAmount = pastOps.reduce((sum: number, t: any) => sum + t.amount, 0);
        const combinedAmount = totalPastAmount + amount;

        const uniqueBranches = new Set(pastOps.map((t: any) => t.branchId).filter(Boolean));
        if (branchId) uniqueBranches.add(branchId);

        let penalty = 0;
        if (combinedAmount > settings.antiFractioningMaxAmount && (uniqueBranches.size > 1 || pastOps.length >= settings.antiFractioningMaxCount)) {
            const action = settings.antiFractioningAction;
            if (action === 'BLOCK') {
                if (authorId) {
                    await tx.riskFlag.create({
                        data: {
                            userId: clientId, authorId, type: 'ANTI_FRACTIONING',
                            description: `Action bloquage Cash-Out de ${amount} suite dépassement du seuil par cumul.`
                        }
                    });
                }
                throw new Error("Opération rejetée : Politique d'Anti-Fractionnement activée.");
            } else if (action === 'ALERT' || action === 'APPLY_FEE') {
                if (authorId) {
                    await tx.riskFlag.create({
                        data: {
                            userId: clientId, authorId, type: 'ANTI_FRACTIONING',
                            description: `${action === 'ALERT' ? 'Alerte' : 'Frais dissuasif appliqué'} sur Cash-Out de ${amount} suite dépassement du seuil par cumul (${combinedAmount} FCFA cumulés).`
                        }
                    });
                }
                if (action === 'APPLY_FEE') {
                    // Même taux marginal agence que calculateWithdrawalFee/executeCashOut (taux
                    // déjà configurable par l'admin, pas une valeur inventée ici) : appliqué au
                    // seul dépassement du seuil anti-fractionnement.
                    const agencyRate = settings?.agencyTaxWithdraw ?? 0.01;
                    penalty = Math.round((combinedAmount - settings.antiFractioningMaxAmount) * agencyRate);
                }
            }
        }
        return penalty;
    }

    /**
     * Anti-Fractionnement (Taxation centralisée)
     * Calcule la taxe sur un retrait en tenant compte du cumul journalier du client.
     * Si le client a déjà épuisé son quota gratuit du jour, TOUT nouveau retrait est taxé.
     */
    static async calculateWithdrawalFee(tx: any, walletId: string, amount: number, settings: any): Promise<number> {
        // Fuseau CONFIGURÉ (SystemSettings.timezone), jamais l'heure locale du process
        // serveur (UTC sur Render) — même bug et même correctif que verifyAndIncrementConsumption
        // ci-dessus : `new Date(); setHours(0,0,0,0)` calculait minuit heure SERVEUR, décalé
        // jusqu'à 1h de minuit à Libreville, faisant démarrer/finir le cumul journalier des
        // frais de retrait jusqu'à 1h trop tôt ou trop tard par rapport à la journée réelle.
        const timezone = settings?.timezone || 'Africa/Libreville';
        const startOfDay = startOfDayInTimezone(timezone, new Date());

        const todaysWithdrawals = await tx.transaction.aggregate({
            where: {
                senderWalletId: walletId,
                // `type: 'CASH_OUT'` (posé par TOUS les rails de retrait — executeCashOut,
                // /qr-cash-out, /client-initiated-withdraw, /push) au lieu de l'ancien
                // `reference: { startsWith: 'QROUT' }`, qui n'était en réalité écrit que par
                // /qr-cash-out : les retraits AGENT de /client-initiated-withdraw (référence
                // par défaut, sans préfixe QROUT) ne comptaient donc jamais dans ce cumul
                // journalier, permettant de contourner le seuil de frais en alternant les rails.
                type: 'CASH_OUT',
                createdAt: { gte: startOfDay },
                status: 'COMPLETED'
            },
            _sum: { amount: true }
        });

        const sumToday = todaysWithdrawals._sum.amount || 0;
        const threshold = settings.agencyWithdrawThreshold;

        // La partie du montant actuel qui dépasse la franchise restante pour aujourd'hui
        const taxableAmount = Math.max(0, (sumToday + amount) - Math.max(sumToday, threshold));

        return Math.round(taxableAmount * settings.agencyTaxWithdraw);
    }
}
