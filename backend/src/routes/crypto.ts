import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import logger from '../utils/logger';
import { getSystemSettings } from './settings';
import { notifyParentOfChildSpend } from './wallet';

const router = express.Router();

// Mocked live exchange rates against XAF for DEMO
const RATES: Record<string, number> = {
    'BTC': 37500000,
    'ETH': 1950000,
    'USDT': 610
};

// GET /api/crypto/market
router.get('/market', authMiddleware, async (req: AuthRequest, res) => {
    try {
        // Fetch current fake rates + random jitter for live look
        const market = Object.keys(RATES).map(asset => {
            const jitter = 1 + (Math.random() * 0.02 - 0.01); // +/- 1%
            return {
                asset,
                priceXAF: Math.floor(RATES[asset] * jitter),
                change24h: (Math.random() * 10 - 5).toFixed(2)
            };
        });

        // Also fetch user's crypto wallets
        const wallets = await prisma.cryptoWallet.findMany({
            where: { userId: req.userId }
        });

        res.json({ market, wallets });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/crypto/buy
// Aucune bourse, custodian ni blockchain n'est connectée (voir RATES ci-dessus, "Mocked... for
// DEMO") : un achat ici débite réellement le portefeuille XAF du client contre un actif qui
// n'existe nulle part ailleurs que dans cette base. Même garde que services.ts/biller.ts —
// désactivé tant qu'un partenaire d'exchange réel n'est pas intégré. `/sell` reste ouvert
// pour ne pas enfermer un client qui détiendrait déjà une position simulée sans moyen de la
// reconvertir en XAF réel.
router.post('/buy', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_CRYPTO !== 'true') {
        return res.status(501).json({
            error: 'L\'achat de cryptomonnaies nécessite une intégration réelle avec une bourse/custodian. Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const { asset, amountXaf, pin } = req.body;
        // Le FCFA n'a aucune sous-unité — arrondi ici, sinon l'écriture Prisma échoue sur un
        // montant décimal (Transaction.amount/CryptoTransaction.amountFiat sont Int).
        const xafAmount = Math.round(parseFloat(amountXaf));
        if (isNaN(xafAmount) || xafAmount <= 1000) return res.status(400).json({ error: 'Minimum achat : 1000 XAF' });
        if (!RATES[asset]) return res.status(400).json({ error: 'Actif non supporté' });

        const user = await prisma.user.findUnique({ where: { id: req.userId! }, include: { wallet: true } });
        if (!user || user.accountStatus !== 'ACTIVE') return res.status(403).json({ error: 'Compte inactif' });
        // Restriction Comptes Enfant : l'achat de cryptomonnaies ne fait pas partie des
        // fonctionnalités approuvées pour un compte enfant (voir docs produit). Le mobile
        // masque déjà le bouton correspondant (changement parallèle), mais un masquage d'UI
        // seul n'est jamais une garantie — c'est ce contrôle serveur qui constitue le
        // véritable point d'application.
        if (user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });
        if (!pin) return res.status(400).json({ error: 'Code PIN requis.' });
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });
        if (user.wallet!.balance < xafAmount) return res.status(400).json({ error: 'Solde XAF insuffisant' });

        const currentRate = RATES[asset];
        const fee = Math.round(xafAmount * 0.015); // 1.5% fee
        const netPurchase = xafAmount - fee;
        const amountCrypto = Number((netPurchase / currentRate).toFixed(8));
        const settings = await getSystemSettings();

        await prisma.$transaction(async (tx: any) => {
            // Plafonds AML/KYC — cet achat était l'un des rails de paiement à ne passer par
            // aucun contrôle de plafond malgré un débit réel du portefeuille XAF.
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, xafAmount, settings);

            // Debit XAF — garde atomique (balance: gte) : le contrôle `user.wallet!.balance <
            // xafAmount` ci-dessus lit une valeur non verrouillée avant l'ouverture de la
            // transaction, donc deux achats concurrents (double-tap, script) passaient tous les
            // deux ce contrôle et pouvaient faire passer le solde XAF en négatif — même classe de
            // bug déjà corrigée sur wallet.ts/market.ts/treasury.ts, manquante ici.
            const debited = await tx.wallet.updateMany({
                where: { id: user.wallet!.id, balance: { gte: xafAmount } },
                data: { balance: { decrement: xafAmount } }
            });
            if (debited.count === 0) throw new Error('Solde XAF insuffisant');

            // Credit Crypto Wallet
            let cryptoWallet = await tx.cryptoWallet.findFirst({ where: { userId: user.id, asset } });
            if (!cryptoWallet) {
                cryptoWallet = await tx.cryptoWallet.create({
                    data: { userId: user.id, asset, balance: amountCrypto }
                });
            } else {
                cryptoWallet = await tx.cryptoWallet.update({
                    where: { id: cryptoWallet.id },
                    data: { balance: { increment: amountCrypto } }
                });
            }

            // Log Transaction (Fiat flow)
            await tx.transaction.create({
                data: {
                    type: 'SERVICE',
                    amount: netPurchase,
                    fee,
                    status: 'COMPLETED',
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: user.wallet!.id,
                    reference: 'BUY-CRYPTO-' + Date.now()
                }
            });

            // Log Crypto flow
            await tx.cryptoTransaction.create({
                data: {
                    userId: user.id,
                    type: 'BUY',
                    asset,
                    amountCrypto,
                    amountFiat: netPurchase,
                    exchangeRate: currentRate,
                    fee
                }
            });
        });

        await notifyParentOfChildSpend(user.id, xafAmount, `achat de ${asset}`);

        res.json({ message: 'Achat réussi', amountCrypto });
    } catch (e: any) {
        logger.error(`[Crypto Buy] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/crypto/sell
router.post('/sell', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { asset, amountCrypto, pin } = req.body;
        const cryptoQty = parseFloat(amountCrypto);
        if (isNaN(cryptoQty) || cryptoQty <= 0) return res.status(400).json({ error: 'Quantité invalide' });

        const cryptoWallet = await prisma.cryptoWallet.findFirst({ where: { userId: req.userId!, asset } });
        if (!cryptoWallet || cryptoWallet.balance < cryptoQty) return res.status(400).json({ error: 'Solde crypto insuffisant' });

        const currentRate = RATES[asset] || 0;
        // Arrondi une seule fois, sur la base commune : fee + netSale === grossSale
        // exactement, plutôt que d'arrondir fee et netSale indépendamment (qui pourrait
        // laisser 1 FCFA d'écart entre les deux).
        const grossSale = Math.round(cryptoQty * currentRate);
        const fee = Math.round(grossSale * 0.015); // 1.5% fee
        const netSale = grossSale - fee;

        const user = await prisma.user.findUnique({ where: { id: req.userId! }, include: { wallet: true } });
        if (!user) return res.status(403).json({ error: 'Compte introuvable' });
        // Restriction Comptes Enfant : même raisonnement que /buy ci-dessus — la vente de
        // cryptomonnaies ne fait pas partie des fonctionnalités approuvées pour un compte
        // enfant. Le mobile masque déjà le bouton correspondant, mais seul ce contrôle
        // serveur constitue une vraie barrière (un masquage d'UI seul n'en est jamais une).
        if (user.role === 'CHILD') return res.status(403).json({ error: 'Cette fonctionnalité n\'est pas disponible pour les comptes enfant.' });
        if (!pin) return res.status(400).json({ error: 'Code PIN requis.' });
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        await prisma.$transaction(async (tx: any) => {
            // Debit Crypto — garde atomique (balance: gte) : le contrôle `cryptoWallet.balance <
            // cryptoQty` ci-dessus lit une valeur non verrouillée avant l'ouverture de la
            // transaction, donc deux ventes concurrentes de la même quantité détenue une seule
            // fois passaient toutes les deux ce contrôle et pouvaient faire passer le solde crypto
            // en négatif (XAF crédité deux fois pour un seul actif réellement détenu).
            const debited = await tx.cryptoWallet.updateMany({
                where: { id: cryptoWallet.id, balance: { gte: cryptoQty } },
                data: { balance: { decrement: cryptoQty } }
            });
            if (debited.count === 0) throw new Error('Solde crypto insuffisant');

            // Credit XAF
            await tx.wallet.update({
                where: { id: user!.wallet!.id },
                data: { balance: { increment: netSale } }
            });

            // Log Transaction (Fiat flow)
            await tx.transaction.create({
                data: {
                    type: 'RECHARGE',
                    amount: netSale,
                    fee,
                    status: 'COMPLETED',
                    senderWalletId: user!.wallet!.id,
                    receiverWalletId: user!.wallet!.id,
                    reference: 'SELL-CRYPTO-' + Date.now()
                }
            });

            // Log Crypto flow
            await tx.cryptoTransaction.create({
                data: {
                    userId: user!.id,
                    type: 'SELL',
                    asset,
                    amountCrypto: cryptoQty,
                    amountFiat: netSale,
                    exchangeRate: currentRate,
                    fee
                }
            });
        });

        res.json({ message: 'Vente réussie', netSale });
    } catch (e: any) {
        logger.error(`[Crypto Sell] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
