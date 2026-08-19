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

        // 2. Charger le Wallet (Pessimistic lock implicite dans la transaction P2P)
        const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
        if (!wallet) throw new Error('Portefeuille introuvable');

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

        let currentDailySpent = wallet.dailySpent;
        let currentMonthlySpent = wallet.monthlySpent || 0;

        if (wallet.dailySpentResetAt < startOfDay) {
            currentDailySpent = 0;
            wallet.dailySpentResetAt = now;
        }
        if (!wallet.monthlySpentResetAt || wallet.monthlySpentResetAt < startOfMonth) {
            currentMonthlySpent = 0;
            wallet.monthlySpentResetAt = now;
        }

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
        const dailyReset = wallet.dailySpentResetAt < startOfDay;
        const monthlyReset = !wallet.monthlySpentResetAt || wallet.monthlySpentResetAt < startOfMonth;

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

    // NOTE : une précédente version de calculateWithdrawalFee() a été retirée ici —
    // elle n'était appelée nulle part dans le code (confirmé par recherche globale).
    // Elle calculait une taxe progressive basée sur le cumul des retraits COUT-/QROUT-
    // du jour, contrairement au calcul actuel dans wallet.ts (qr-cash-out,
    // client-initiated-withdraw) qui ne regarde que le montant de la transaction en
    // cours. Un client peut donc aujourd'hui fractionner un gros retrait en plusieurs
    // retraits QR sous le seuil pour éviter la taxe agence — ce report de conception
    // (accumuler par jour comme le fait déjà l'anti-fractionnement bloquant de
    // CashOperationService.executeCashOut) nécessite une décision produit avant d'être
    // réintégré, plutôt que d'être deviné ici.
}
