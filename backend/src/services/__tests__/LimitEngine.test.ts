import { LimitEngine, MAXIMUM_ALLOWED_LIMIT } from '../LimitEngine';

const settings = {
    dailyLimitTier0: 50000, dailyLimitTier1: 2000000, dailyLimitTier2: 5000000,
    monthlyLimitTier0: 1000000, monthlyLimitTier1: 10000000, monthlyLimitTier2: 50000000,
    perTxLimitTier0: 50000, perTxLimitTier1: 500000, perTxLimitTier2: 2000000,
};

describe('LimitEngine.getApplicableLimits', () => {
    it('devrait retourner les limites Tier0 par défaut', async () => {
        const limits = await LimitEngine.getApplicableLimits({ kycLevel: 0 }, settings);
        expect(limits.baseDaily).toBe(50000);
        expect(limits.baseMonthly).toBe(1000000);
        expect(limits.basePerTx).toBe(50000);
        expect(limits.effectiveDaily).toBe(50000);
    });

    it('devrait retourner les limites Tier1', async () => {
        const limits = await LimitEngine.getApplicableLimits({ kycLevel: 1 }, settings);
        expect(limits.baseDaily).toBe(2000000);
        expect(limits.baseMonthly).toBe(10000000);
        expect(limits.basePerTx).toBe(500000);
    });

    it('devrait retourner les limites Tier2 pour kycLevel >= 2', async () => {
        const limits = await LimitEngine.getApplicableLimits({ kycLevel: 2 }, settings);
        expect(limits.baseDaily).toBe(5000000);
        expect(limits.baseMonthly).toBe(50000000);
        expect(limits.basePerTx).toBe(2000000);
    });

    it('devrait retourner les limites Tier2 aussi pour kycLevel > 2', async () => {
        const limits = await LimitEngine.getApplicableLimits({ kycLevel: 3 }, settings);
        expect(limits.baseDaily).toBe(5000000);
    });

    it('devrait utiliser les limites custom actives si définies', async () => {
        const user = { kycLevel: 0, customDailyLimit: 80000, customMonthlyLimit: 1500000, customPerTxLimit: 60000, customLimitExpiresAt: null };
        const limits = await LimitEngine.getApplicableLimits(user, settings);
        expect(limits.effectiveDaily).toBe(80000);
        expect(limits.effectiveMonthly).toBe(1500000);
        expect(limits.effectivePerTx).toBe(60000);
        expect(limits.isCustomActive).toBe(true);
    });

    it('devrait ignorer les limites custom expirées et retomber sur les limites de base', async () => {
        const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24);
        const user = { kycLevel: 0, customDailyLimit: 80000, customLimitExpiresAt: pastDate };
        const limits = await LimitEngine.getApplicableLimits(user, settings);
        expect(limits.effectiveDaily).toBe(50000);
        expect(limits.isCustomActive).toBe(false);
    });

    it('devrait considérer les limites custom actives si customLimitExpiresAt est dans le futur', async () => {
        const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24);
        const user = { kycLevel: 0, customDailyLimit: 90000, customLimitExpiresAt: futureDate };
        const limits = await LimitEngine.getApplicableLimits(user, settings);
        expect(limits.effectiveDaily).toBe(90000);
    });

    it('devrait plafonner effectiveDaily au maximum réglementaire absolu', async () => {
        const user = { kycLevel: 2, customDailyLimit: MAXIMUM_ALLOWED_LIMIT + 5000000, customLimitExpiresAt: null };
        const limits = await LimitEngine.getApplicableLimits(user, settings);
        expect(limits.effectiveDaily).toBe(MAXIMUM_ALLOWED_LIMIT);
    });

    it('devrait plafonner effectiveMonthly à 5x le maximum réglementaire', async () => {
        const user = { kycLevel: 2, customMonthlyLimit: MAXIMUM_ALLOWED_LIMIT * 10, customLimitExpiresAt: null };
        const limits = await LimitEngine.getApplicableLimits(user, settings);
        expect(limits.effectiveMonthly).toBe(MAXIMUM_ALLOWED_LIMIT * 5);
    });

    it('devrait utiliser les valeurs de repli si settings est null/undefined', async () => {
        const limits = await LimitEngine.getApplicableLimits({ kycLevel: 0 }, null);
        expect(limits.baseDaily).toBe(50000);
        expect(limits.baseMonthly).toBe(1000000);
    });
});

describe('LimitEngine.verifyAndIncrementConsumption', () => {
    const buildTx = (overrides: any = {}) => ({
        // Verrou de ligne (SELECT ... FOR UPDATE) pris avant la lecture du wallet — voir
        // LimitEngine.ts. Le résultat n'est jamais utilisé, un mock résolu suffit.
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'wallet_1' }]),
        user: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'user_1', role: 'USER', kycLevel: 0,
                customDailyLimit: null, customMonthlyLimit: null, customPerTxLimit: null,
                customLimitExpiresAt: null, isActive: true, lockedUntil: null,
                ...overrides.user,
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        wallet: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'wallet_1', dailySpent: 0, monthlySpent: 0,
                dailySpentResetAt: new Date(), monthlySpentResetAt: new Date(),
                ...overrides.wallet,
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        // detectAndFreezeSAR (vérifié avant les plafonds classiques) compte les transactions
        // de la dernière heure — 0 par défaut ici (sous le seuil de 15/h) pour ne pas geler le
        // compte pendant les tests des plafonds classiques, qui ne testent pas ce mécanisme.
        transaction: {
            count: jest.fn().mockResolvedValue(overrides.transactionCount ?? 0),
        },
        auditLog: {
            create: jest.fn().mockResolvedValue({}),
        },
    });

    it('devrait lever une exception si l\'utilisateur est introuvable', async () => {
        const tx = buildTx();
        (tx.user.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings))
            .rejects.toThrow('Compte introuvable');
    });

    it('devrait retourner sans erreur (exempté) si le rôle n\'est pas USER', async () => {
        const tx = buildTx({ user: { role: 'ADMIN' } });

        await LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings);

        expect(tx.wallet.update).not.toHaveBeenCalled();
        expect(tx.wallet.findUnique).not.toHaveBeenCalled();
    });

    it('devrait lever une exception si le compte est inactif', async () => {
        const tx = buildTx({ user: { isActive: false } });

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings))
            .rejects.toThrow('Le compte est gelé ou suspendu. Action interdite.');
    });

    it('devrait lever une exception si le compte est verrouillé (lockedUntil futur)', async () => {
        const futureDate = new Date(Date.now() + 1000 * 60 * 60);
        const tx = buildTx({ user: { lockedUntil: futureDate } });

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings))
            .rejects.toThrow('Le compte est gelé ou suspendu. Action interdite.');
    });

    it('devrait lever une exception si le portefeuille est introuvable', async () => {
        const tx = buildTx();
        (tx.wallet.findUnique as jest.Mock).mockResolvedValue(null);

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings))
            .rejects.toThrow('Portefeuille introuvable');
    });

    it('devrait lever une exception si le montant dépasse le plafond par transaction', async () => {
        const tx = buildTx();

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 60000, settings))
            .rejects.toThrow('Plafond par transaction dépassé.');
    });

    it('devrait lever une exception si le cumul journalier dépasse la limite', async () => {
        const tx = buildTx({ wallet: { dailySpent: 45000, dailySpentResetAt: new Date() } });

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 10000, settings))
            .rejects.toThrow('Plafond journalier dépassé.');
    });

    it('devrait lever une exception si le cumul mensuel dépasse la limite', async () => {
        const tx = buildTx({ wallet: { dailySpent: 0, monthlySpent: 995000, dailySpentResetAt: new Date(), monthlySpentResetAt: new Date() } });

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 10000, settings))
            .rejects.toThrow('Plafond mensuel dépassé.');
    });

    it('devrait incrémenter dailySpent et monthlySpent en relatif quand pas de reset nécessaire', async () => {
        const now = new Date();
        const tx = buildTx({ wallet: { dailySpent: 1000, monthlySpent: 2000, dailySpentResetAt: now, monthlySpentResetAt: now } });

        await LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 5000, settings);

        expect(tx.wallet.update).toHaveBeenCalledWith({
            where: { id: 'wallet_1' },
            data: {
                dailySpent: { increment: 5000 },
                dailySpentResetAt: undefined,
                monthlySpent: { increment: 5000 },
                monthlySpentResetAt: undefined,
            },
        });
    });

    it('devrait remettre à zéro ET persister le compteur journalier si dailySpentResetAt est avant aujourd\'hui', async () => {
        const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 48);
        // dailySpent élevé (40000) : si le reset (validation ET écriture) ne s'appliquait pas,
        // 40000 + 5000 dépasserait la limite Tier0 (50000) — il ne la dépasse pas car
        // currentDailySpent est bien remis à 0 avant la vérification.
        const tx = buildTx({ wallet: { dailySpent: 40000, monthlySpent: 1000, dailySpentResetAt: yesterday, monthlySpentResetAt: new Date() } });

        await LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 5000, settings);

        const call = (tx.wallet.update as jest.Mock).mock.calls[0][0];
        // Un vrai reset SET la valeur au montant de la requête (pas un increment relatif sur
        // l'ancienne valeur de 40000), et persiste la nouvelle date de reset.
        expect(call.data.dailySpent).toBe(5000);
        expect(call.data.dailySpentResetAt).toBeInstanceOf(Date);
        // Le mensuel, lui, n'était pas dû (resetAt = aujourd'hui) : increment normal.
        expect(call.data.monthlySpent).toEqual({ increment: 5000 });
        expect(call.data.monthlySpentResetAt).toBeUndefined();
    });

    it('devrait remettre à zéro ET persister le compteur mensuel quand monthlySpentResetAt était null', async () => {
        const tx = buildTx({ wallet: { dailySpent: 0, monthlySpent: 0, dailySpentResetAt: new Date(), monthlySpentResetAt: null } });

        await LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 5000, settings);

        const call = (tx.wallet.update as jest.Mock).mock.calls[0][0];
        expect(call.data.monthlySpent).toBe(5000);
        expect(call.data.monthlySpentResetAt).toBeInstanceOf(Date);
    });

    it('devrait geler le compte et lever une exception si la vélocité SAR dépasse 15 tx/h', async () => {
        const tx = buildTx({ transactionCount: 16 });

        await expect(LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings))
            .rejects.toThrow('Compte gelé par réseau Sécurité (SAR Fraud). Vélocité anormale détectée.');

        expect(tx.user.update).toHaveBeenCalledWith({
            where: { id: 'user_1' },
            data: { isActive: false, kycStatus: 'REJECTED' },
        });
        expect(tx.auditLog.create).toHaveBeenCalled();
        // Le gel doit intervenir AVANT toute écriture sur les compteurs de plafond.
        expect(tx.wallet.update).not.toHaveBeenCalled();
    });

    it('ne devrait pas geler le compte à exactement 15 tx/h (seuil strict >15)', async () => {
        const tx = buildTx({ transactionCount: 15 });

        await LimitEngine.verifyAndIncrementConsumption(tx, 'user_1', 'wallet_1', 1000, settings);

        expect(tx.user.update).not.toHaveBeenCalled();
        expect(tx.wallet.update).toHaveBeenCalled();
    });
});
