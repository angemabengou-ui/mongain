import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { prisma } from '../prisma';

// The routing module orchestrates USSD/SMS fallback transactions
const router = Router();

/**
 * Endpoint for a telecom aggregator (ex: Twilio, Africa's Talking)
 * The telecom sends the SMS/USSD payload to this webhook.
 */
router.post('/sms-gateway', async (req, res) => {
    try {
        // payload generally looks like: { from: "+241074...", text: "SEND 077XXXXXX 5000 1234" }
        const { from, text, api_key } = req.body;

        if (api_key !== process.env.USSD_GATEWAY_API_KEY) {
            return res.status(401).json({ error: "Unauthorized gateway" });
        }

        const senderPhone = from.startsWith('+241') ? from.replace('+241', '0') : from;
        const bodyText = text.trim().toUpperCase();

        const senderUser = await prisma.user.findUnique({
            where: { phone: senderPhone },
            include: { wallet: true }
        });

        if (!senderUser || !senderUser.wallet) {
            return res.json({ message: "Erreur: Profil introuvable." });
        }

        const args = bodyText.split(' ');
        const command = args[0];

        switch (command) {
            case 'SEND': {
                // Syntax: SEND <tel> <montant> <pin>
                if (args.length !== 4) return res.json({ message: "Erreur syntaxe. Utilisez: SEND TEL MONTANT PIN" });

                const receiverPhone = args[1];
                const amount = parseFloat(args[2]);
                const pin = args[3];

                if (isNaN(amount) || amount <= 0) return res.json({ message: "Erreur: Montant invalide." });

                const isValidPin = await bcrypt.compare(pin, senderUser.pin);
                if (!isValidPin) return res.json({ message: "Erreur: Code PIN incorrect." });

                const receiverUser = await prisma.user.findUnique({
                    where: { phone: receiverPhone },
                    include: { wallet: true }
                });

                if (!receiverUser || !receiverUser.wallet) {
                    return res.json({ message: "Erreur: Bénéficiaire introuvable." });
                }

                if (senderUser.wallet.balance < amount) {
                    return res.json({ message: "Erreur: Solde insuffisant." });
                }

                // Execute transfer using atomic limits
                await prisma.$transaction(async (tx) => {
                    await tx.wallet.update({
                        where: { id: senderUser.wallet!.id, balance: { gte: amount } },
                        data: { balance: { decrement: amount } }
                    });

                    await tx.wallet.update({
                        where: { id: receiverUser.wallet!.id },
                        data: { balance: { increment: amount } }
                    });

                    const ref = `OFFLINE_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
                    await tx.transaction.create({
                        data: {
                            amount,
                            status: 'COMPLETED',
                            reference: ref,
                            senderWalletId: senderUser.wallet!.id,
                            receiverWalletId: receiverUser.wallet!.id,
                            fee: 0
                        }
                    });
                });

                return res.json({ message: `Succes: ${amount} FCFA envoye a ${receiverUser.name}.` });
            }
            case 'SOLDE': {
                // Syntax: SOLDE <pin>
                if (args.length !== 2) return res.json({ message: "Erreur syntaxe. Utilisez: SOLDE PIN" });
                const pin = args[1];
                const isValidPin = await bcrypt.compare(pin, senderUser.pin);
                if (!isValidPin) return res.json({ message: "Erreur: Code PIN incorrect." });

                return res.json({ message: `Solde actuel: ${senderUser.wallet.balance} FCFA.` });
            }
            default:
                return res.json({ message: "Commande inconnue. Commandes valides: SEND, SOLDE." });
        }
    } catch (e: any) {
        console.error("USSD Error:", e);
        return res.json({ message: "Erreur interne des serveurs Mongain." });
    }
});

export default router;
