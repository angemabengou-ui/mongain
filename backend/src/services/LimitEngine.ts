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

        // Regulatory Absolute Clamp
        effectiveDaily = Math.min(effectiveDaily, MAXIMUM_ALLOWED_LIMIT);
        effectiveMonthly = Math.min(effectiveMonthly, MAXIMUM_ALLOWED_LIMIT * 5); // Ex: 50M
        effectivePerTx = Math.min(effectivePerTx, MAXIMUM_ALLOWED_LIMIT);

        return {
            effectiveDaily,
            effectiveMonthly,
            effectivePerTx,
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
            await tx.user.update({
                where: { id: userId },
                data: { isActive: false, kycStatus: 'REJECTED' }
            });
            await tx.auditLog.create({
                data: {
                    userId,
                    action: 'AML_FREEZE_SAR',
                    details: `Suspicious velocity detected (${velocity} tx/h). Account automatically frozen.`,
                    ipAddress: 'INTERNAL_AML_ENGINE'
                }
            });
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
                isActive: true,
                lockedUntil: true
            }
        });

        if (!user) throw new Error('Compte introuvable');
        if (user.role !== 'USER') return; // Exemptions for Staff/Internal

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

        // 5. Réinitialisation temporelle si on a changé de jour/mois
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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
     * Anti-Fractionnement (Taxation centralisée)
     * Calcule la taxe sur un retrait en tenant compte du cumul journalier du client.
     * Si le client a déjà épuisé son quota gratuit du jour, TOUT nouveau retrait est taxé.
     */
    static async calculateWithdrawalFee(tx: any, walletId: string, amount: number, settings: any): Promise<number> {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const todaysWithdrawals = await tx.transaction.aggregate({
            where: {
                senderWalletId: walletId,
                reference: { startsWith: 'QROUT' }, // Both client-initiated and agent-initiated use QROUT or similar
                createdAt: { gte: startOfDay },
                status: 'COMPLETED'
            },
            _sum: { amount: true }
        });

        const sumToday = todaysWithdrawals._sum.amount || 0;
        const threshold = settings.agencyWithdrawThreshold;

        // La partie du montant actuel qui dépasse la franchise restante pour aujourd'hui
        const taxableAmount = Math.max(0, (sumToday + amount) - Math.max(sumToday, threshold));

        return taxableAmount * settings.agencyTaxWithdraw;
    }
}
