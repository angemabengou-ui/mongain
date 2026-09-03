import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { prisma } from '../prisma';
import { verifyUserPin } from '../utils/pinAuth';
import logger from '../utils/logger';

const router = Router();

// Cette route n'est jamais appelée par le téléphone du client : c'est le serveur de
// l'agrégateur télécom (Airtel/Moov) qui la relaie après avoir lui-même authentifié
// l'appelant sur son propre réseau (SS7/session USSD), et c'est LUI qui affirme le
// `phoneNumber`. Sans secret partagé, n'importe qui sur Internet peut prétendre être ce
// relais et agir au nom de n'importe quel numéro connu — d'où cette vérification, sur le
// même principe que la clé de webhook PVit (routes/webhooks.ts) : comparaison à temps
// constant, échec fermé (503) si la clé n'est pas configurée en production.
function isGatewayAuthorized(req: Request): boolean {
    const expected = process.env.USSD_GATEWAY_SECRET || '';
    if (!expected) return process.env.NODE_ENV !== 'production';
    const provided = typeof req.headers['x-gateway-secret'] === 'string' ? req.headers['x-gateway-secret'] as string : '';
    return provided.length === expected.length
        && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Endpoint webhook for Telco (Airtel, Moov) USSD Gateway.
 * Simulates a standard Africa's Talking / Telco USSD payload:
 * { sessionId, serviceCode, phoneNumber, text }
 */
router.post('/gateway', async (req: Request, res: Response) => {
    try {
        if (!isGatewayAuthorized(req)) {
            logger.warn('[USSD Gateway] Requête rejetée : clé de passerelle absente ou invalide.');
            return res.status(403).send(`END Passerelle non autorisée.`);
        }

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

                if (!amount || amount <= 0) return res.send(`END Montant invalide.`);

                const pinCheck = await verifyUserPin(user, pin);
                if (!pinCheck.ok) return res.send(`END ${pinCheck.error}`);

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
                // Non implémenté : afficher une confirmation de paiement qui ne débite ni ne
                // crédite réellement induirait le client en erreur sur un vrai règlement de facture.
                return res.send(`END Paiement de facture indisponible par USSD pour le moment. Utilisez l'application Mongain ou une agence.`);
            }
        }

        // 4. BNPL — même raison : pas d'octroi de crédit réel possible depuis ce canal aujourd'hui.
        if (text === '4') {
            return res.send(`END Le Micro-Crédit BNPL n'est pas encore disponible par USSD. Ouvrez l'application Mongain pour en bénéficier.`);
        }

        return res.send(`END Option invalide.`);
    } catch (e: any) {
        logger.error(`[USSD Gateway Error] ${e.message}`);
        return res.send(`END Le service Mongain USSD est momentanément indisponible.`);
    }
});

export default router;
