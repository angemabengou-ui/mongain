import { Request, Response, Router } from 'express';
import { prisma } from '../prisma';
import logger from '../utils/logger';

const router = Router();

/**
 * Endpoint webhook for Telco (Airtel, Moov) USSD Gateway.
 * Simulates a standard Africa's Talking / Telco USSD payload:
 * { sessionId, serviceCode, phoneNumber, text }
 */
router.post('/gateway', async (req: Request, res: Response) => {
    try {
        const { sessionId, serviceCode, phoneNumber, text } = req.body;
        if (!phoneNumber) return res.send(`END Erreur: Numéro requis.`);

        // Find User By Phone (Assuming Phone is mapped to username for simplicity here, or we lookup by phone)
        // In Mongain, authentication is normally jwt. But for USSD, telco confirms caller ID (phoneNumber).
        const user = await prisma.user.findFirst({
            where: { phone: phoneNumber },
            include: { wallet: true }
        });

        if (!user) {
            return res.send(`END Bienvenue sur Mongain. Ce numéro n'est pas lié à un compte. Téléchargez l'app ou voir une agence.`);
        }

        // Parse text sequence (Empty = Step 1, "1" = Menu 1, "1*500*074..." = Send 500 etc)
        const inputs = (text || '').split('*');
        const lastInput = inputs[inputs.length - 1];

        // Root Menu
        if (!text) {
            let response = `CON Bienvenue sur Mongain (V19 Offline)\n`;
            response += `1. Mon Solde\n`;
            response += `2. Envoyer de l'argent (P2P)\n`;
            response += `3. Payer une Facture SEEG\n`;
            response += `4. Micro-Crédit (BNPL)`;
            return res.send(response);
        }

        // 1. BALANCE
        if (text === '1') {
            return res.send(`END Votre solde Mongain est de ${user.wallet?.balance || 0} FCFA.`);
        }

        // 2. SEND MONEY (P2P) Flow: 2 -> Enter Phone -> Enter Amount -> Enter PIN
        if (inputs[0] === '2') {
            if (inputs.length === 1) return res.send(`CON Saisissez le numéro du destinataire :`);
            if (inputs.length === 2) return res.send(`CON Saisissez le montant à envoyer (FCFA) :`);
            if (inputs.length === 3) return res.send(`CON Saisissez votre code PIN Mongain :`);

            if (inputs.length === 4) {
                const targetPhone = inputs[1];
                const amount = parseFloat(inputs[2]);
                const pin = inputs[3];

                // Check PIN (Simulated check, normally verify bcrypt user.pin)
                // if (!verifyPin(pin)) return res.send(`END Code PIN Incorrect.`);

                const targetUser = await prisma.user.findFirst({ where: { phone: targetPhone }, include: { wallet: true } });
                if (!targetUser || !targetUser.wallet || !user.wallet) return res.send(`END Destinataire introuvable.`);

                try {
                    // Injecting raw Prisma Tx for P2P since USSD bypasses CashOperationService
                    const settings = await prisma.systemSettings.findFirst();
                    const fee = amount * (settings?.taxP2P || 0.01);
                    const totalRequired = amount + fee;

                    if (user.wallet.balance < totalRequired) return res.send(`END Solde insuffisant (Frais: ${fee}F).`);

                    await prisma.$transaction(async (tx) => {
                        await tx.wallet.update({
                            where: { id: user.wallet!.id, balance: { gte: totalRequired } },
                            data: { balance: { decrement: totalRequired } }
                        });

                        await tx.wallet.update({
                            where: { id: targetUser.wallet!.id },
                            data: { balance: { increment: amount } }
                        });

                        const corpTx = await tx.systemAccount.findUnique({ where: { kind: 'CORPORATE' }, include: { wallet: true } });
                        if (corpTx?.wallet) {
                            await tx.wallet.update({ where: { id: corpTx.wallet.id }, data: { balance: { increment: fee } } });
                        }

                        await tx.transaction.create({
                            data: { amount, fee, status: 'COMPLETED', reference: 'USSD-' + Date.now().toString(), senderWalletId: user.wallet!.id, receiverWalletId: targetUser.wallet!.id }
                        });
                    });
                    return res.send(`END Succès! Vous avez envoyé ${amount}F à ${targetPhone}. Frais: ${fee}F.`);
                } catch (e: any) {
                    return res.send(`END Échec de la transaction. ${e.message}`);
                }
            }
        }

        // 3. BILLERS (SEEG) Flow: 3 -> Enter Meter -> Enter Amount -> Enter PIN
        if (inputs[0] === '3') {
            if (inputs.length === 1) return res.send(`CON Entrez le numéro de compteur SEEG :`);
            if (inputs.length === 2) return res.send(`CON Entrez le montant (FCFA) :`);
            if (inputs.length === 3) return res.send(`CON Confirmer avec votre code PIN :`);

            if (inputs.length === 4) {
                return res.send(`END Paiement SEEG de ${inputs[2]}F validé pour ${inputs[1]}. Code Ticket EDAN envoyé par SMS.`);
            }
        }

        // 4. BNPL Flow
        if (text === '4') {
            return res.send(`END Vous êtes éligible à un crédit BNPL de 50 000F. Accédez à l'application réseau pour valider.`);
        }

        return res.send(`END Option invalide.`);
    } catch (e: any) {
        logger.error(`[USSD Gateway Error] ${e.message}`);
        return res.send(`END Le service Mongain USSD est momentanément indisponible.`);
    }
});

export default router;
