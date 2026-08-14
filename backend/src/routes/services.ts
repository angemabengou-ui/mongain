import bcrypt from 'bcryptjs';
import express from 'express';
import { z } from 'zod';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';

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

        if (user.wallet.balance < amount) return res.status(400).json({ error: 'Solde insuffisant pour payer cette facture.' });

        // Trouver ou créer le portefeuille du Service (SEEG / CANAL)
        const servicePhone = service === 'SEEG' ? '+24188888888' : '+24177777777';
        let serviceUser = await prisma.user.findUnique({ where: { phone: servicePhone }, include: { wallet: true } });

        if (!serviceUser) {
            serviceUser = await prisma.user.create({
                data: {
                    phone: servicePhone,
                    name: `SERVICE PARTENAIRE - ${service}`,
                    role: 'ADMIN',
                    pin: await bcrypt.hash('0000', 10),
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }

        // Simuler un appel API vers SEEG/Edan ou Canal+
        await new Promise(r => setTimeout(r, 1200));

        // Code Jeton Edan de 20 chiffres (Simulé)
        const seegCode = service === 'SEEG' ? Array.from({ length: 4 }, () => Math.floor(10000 + Math.random() * 90000).toString()).join('-') : undefined;
        const ref = `${service}-${accountNumber}-${Math.random().toString(36).substring(7).toUpperCase()}`;

        await prisma.$transaction(async (tx) => {
            // Débiter le client
            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { decrement: amount } }
            });

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
        res.status(500).json({ error: e.message });
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

        if (user.wallet.balance < amount) return res.status(400).json({ error: 'Solde insuffisant pour cette recharge de crédit.' });

        const telecomPhone = '+24166666666'; // MOCK AGGREGATOR WALLET
        let telecomUser = await prisma.user.findUnique({ where: { phone: telecomPhone }, include: { wallet: true } });

        if (!telecomUser) {
            telecomUser = await prisma.user.create({
                data: {
                    phone: telecomPhone,
                    name: `SERVICE PARTENAIRE - TELECOM`,
                    role: 'ADMIN',
                    pin: await bcrypt.hash('0000', 10),
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                },
                include: { wallet: true }
            });
        }

        // Simulate third party Telecom API
        await new Promise(r => setTimeout(r, 1200));

        const ref = `AIRTIME-${network}-${Math.random().toString(36).substring(7).toUpperCase()}`;

        await prisma.$transaction(async (tx) => {
            await tx.wallet.update({
                where: { id: user.wallet!.id },
                data: { balance: { decrement: amount } }
            });

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
        res.status(500).json({ error: e.message });
    }
});

export default router;
