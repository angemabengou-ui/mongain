import { friendlyErrorMessage } from '../utils/errors';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { getSystemAccount } from '../services/systemAccounts';
import { verifyUserPin } from '../utils/pinAuth';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const router = express.Router();

const payBillSchema = z.object({
    service: z.enum(['SEEG', 'CANAL']),
    accountNumber: z.string().min(5, 'Le numéro de compteur/abonné est invalide.'),
    amount: z.number().int('Pas de centimes.').positive('Montant invalide.'),
    pin: z.string().length(4)
});

// Aucune intégration réelle avec SEEG/Edan ou Canal+ n'existe : le code ci-dessous ne
// fait que débiter le client et créditer un compte interne factice ("service partenaire")
// tout en affichant un faux jeton/succès — l'argent quitte vraiment le solde du client
// sans que rien ne se passe réellement côté SEEG/Canal+. Désactivé tant que ce n'est pas
// branché à un vrai fournisseur (même schéma que ENABLE_UNVERIFIED_CARD_TOPUP).
router.post('/pay-bill', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES !== 'true') {
        return res.status(501).json({
            error: 'Le paiement de factures nécessite une intégration réelle avec le fournisseur (SEEG/Canal+). Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const parsed = payBillSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
        const { service, accountNumber, amount, pin } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        // verifyUserPin applique le verrouillage 3 échecs/15min (absent ici jusqu'ici) et
        // conserve le statut 400 (pas 401) — voir commentaire dans /login.
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        // Trouver ou créer le portefeuille du Service (SEEG / CANAL)
        const serviceUser = await getSystemAccount(service === 'SEEG' ? 'SERVICE_PARTNER_SEEG' : 'SERVICE_PARTNER_CANAL');
        if (!serviceUser.wallet) return res.status(500).json({ error: 'Portefeuille service introuvable.' });

        // Simuler un appel API vers SEEG/Edan ou Canal+
        await new Promise(r => setTimeout(r, 1200));

        // Code Jeton Edan de 20 chiffres (Simulé)
        const seegCode = service === 'SEEG' ? Array.from({ length: 4 }, () => crypto.randomInt(10000, 100000).toString()).join('-') : undefined;
        const ref = generateReference(`${service}-${accountNumber}`);

        await prisma.$transaction(async (tx) => {
            // La limite Anti-Blanchiment s'applique aux paiements de factures comme au
            // reste des mouvements sortants — un client Tier 0 ne doit pas pouvoir la
            // contourner en passant par ce rail plutôt que par un transfert P2P.
            const settings = await getSystemSettings();
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, amount, settings);

            // Débiter le client — la clause `balance: gte` rend le débit atomique et
            // empêche un double-clic/retry concurrent de passer sous zéro.
            const updated = await tx.wallet.updateMany({
                where: { id: user.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });
            if (updated.count === 0) throw new Error('Solde insuffisant pour payer cette facture.');

            // Créditer le service
            await tx.wallet.update({
                where: { id: serviceUser!.wallet!.id },
                data: { balance: { increment: amount } }
            });

            // Transaction
            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: serviceUser!.wallet!.id,
                    status: 'COMPLETED',
                    reference: ref
                }
            });
        });

        res.json({
            message: `Paiement ${service} validé avec succès.`,
            seegCode,
            reference: ref
        });

    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// -- AIRTIME TOP-UP --
const topupSchema = z.object({
    network: z.enum(['AIRTEL', 'MOOV']),
    phoneNumber: z.string().min(8, 'Le numéro de téléphone est invalide.'),
    amount: z.number().int('Pas de centimes.').positive('Montant invalide.'),
    pin: z.string().length(4)
});

// Même problème que /pay-bill ci-dessus : aucune intégration réelle avec Airtel/Moov pour
// l'achat de crédit — le client est vraiment débité pour un crédit qui n'est jamais
// réellement livré. Désactivé tant que ce n'est pas branché à un vrai agrégateur telecom.
router.post('/topup', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    if (process.env.ENABLE_UNVERIFIED_EXTERNAL_SERVICES !== 'true') {
        return res.status(501).json({
            error: 'La recharge de crédit téléphonique nécessite une intégration réelle avec l\'opérateur (Airtel/Moov). Cette fonctionnalité est désactivée tant que cette intégration n\'est pas en place.'
        });
    }
    try {
        const parsed = topupSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
        const { network, phoneNumber, amount, pin } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        // Même correctif que /pay-bill ci-dessus (verrouillage 3 échecs/15min).
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const telecomUser = await getSystemAccount('SERVICE_PARTNER_TELECOM');
        if (!telecomUser.wallet) return res.status(500).json({ error: 'Portefeuille service introuvable.' });

        // Simulate third party Telecom API
        await new Promise(r => setTimeout(r, 1200));

        const ref = generateReference(`AIRTIME-${network}`);

        await prisma.$transaction(async (tx) => {
            const settings = await getSystemSettings();
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, amount, settings);

            const updated = await tx.wallet.updateMany({
                where: { id: user.wallet!.id, balance: { gte: amount } },
                data: { balance: { decrement: amount } }
            });
            if (updated.count === 0) throw new Error('Solde insuffisant pour cette recharge de crédit.');

            await tx.wallet.update({
                where: { id: telecomUser!.wallet!.id },
                data: { balance: { increment: amount } }
            });

            await tx.transaction.create({
                data: {
                    amount,
                    senderWalletId: user.wallet!.id,
                    receiverWalletId: telecomUser!.wallet!.id,
                    status: 'COMPLETED',
                    reference: ref
                }
            });
        });

        res.json({
            message: `Recharge de ${amount} FCFA (${network}) effectuée avec succès sur le ${phoneNumber}.`,
            reference: ref
        });

    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
