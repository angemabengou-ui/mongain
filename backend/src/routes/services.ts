import { friendlyErrorMessage } from '../utils/errors';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { generateReference } from '../utils/reference';
import { getSystemSettings } from './settings';

const router = express.Router();

const payBillSchema = z.object({
    service: z.enum(['SEEG', 'CANAL']),
    accountNumber: z.string().min(5, 'Le numéro de compteur/abonné est invalide.'),
    amount: z.number().int('Pas de centimes.').positive('Montant invalide.'),
    pin: z.string().length(4)
});

router.post('/pay-bill', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = payBillSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
        const { service, accountNumber, amount, pin } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const pinMatch = await bcrypt.compare(pin, user.pin);
        if (!pinMatch) return res.status(401).json({ error: 'Code PIN incorrect.' });

        // Trouver ou créer le portefeuille du Service (SEEG / CANAL)
        const servicePhone = service === 'SEEG' ? '+24188888888' : '+24177777777';
        let serviceUser = await prisma.user.findUnique({ where: { phone: servicePhone }, include: { wallet: true } });

        if (!serviceUser) {
            serviceUser = await prisma.user.create({
                data: {
                    phone: servicePhone,
                    name: `SERVICE PARTENAIRE - ${service}`,
                    role: 'ADMIN',
                    pin: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }
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

router.post('/topup', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const parsed = topupSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
        const { network, phoneNumber, amount, pin } = parsed.data;

        const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { wallet: true } });
        if (!user || !user.wallet) return res.status(404).json({ error: 'Compte introuvable.' });

        const pinMatch = await bcrypt.compare(pin, user.pin);
        if (!pinMatch) return res.status(401).json({ error: 'Code PIN incorrect.' });

        const telecomPhone = '+24166666666'; // MOCK AGGREGATOR WALLET
        let telecomUser = await prisma.user.findUnique({ where: { phone: telecomPhone }, include: { wallet: true } });

        if (!telecomUser) {
            telecomUser = await prisma.user.create({
                data: {
                    phone: telecomPhone,
                    name: `SERVICE PARTENAIRE - TELECOM`,
                    role: 'ADMIN',
                    pin: await bcrypt.hash(crypto.randomBytes(8).toString('hex'), 10),
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }
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
