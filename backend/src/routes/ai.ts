import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import logger from '../utils/logger';

const router = express.Router();

/**
 * Basic Heuristic NLP Engine for the Demo
 */
const detectIntent = (text: string) => {
    const clean = text.toLowerCase();
    if (clean.match(/solde|compte|argent|combien|balance/)) return 'BALANCE';
    if (clean.match(/crypto|bitcoin|btc|eth|cours|marché/)) return 'CRYPTO';
    if (clean.match(/carte|virtuel|cb/)) return 'CARDS';
    if (clean.match(/tontine|groupe|épargne/)) return 'TONTINE';
    return 'UNKNOWN';
};

// POST /api/ai/chat
router.post('/chat', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message vide.' });

        const intent = detectIntent(message);
        logger.info(`[AI Chat] User ${req.userId} intent: ${intent} (Message: "${message}")`);

        const user = await prisma.user.findUnique({
            where: { id: req.userId! },
            include: {
                wallet: true,
                virtualCards: true,
                cryptoWallets: true
            }
        });

        if (!user) return res.status(403).json({ error: 'Compte introuvable' });

        let aiResponse = '';

        switch (intent) {
            case 'BALANCE':
                aiResponse = `Bonjour ${user.name.split(' ')[0]} ! 💰\nVotre solde principal actuel est de **${user.wallet?.balance.toLocaleString()} XAF**.\n\nAvez-vous besoin d'aide pour effectuer un transfert ?`;
                break;

            case 'CRYPTO':
                let cryptoText = `📈 **Point Crypto :**\n`;
                if (user.cryptoWallets && user.cryptoWallets.length > 0) {
                    cryptoText += `Vous détenez actuellement :\n`;
                    user.cryptoWallets.forEach(cw => {
                        cryptoText += `- ${cw.balance.toFixed(4)} ${cw.asset}\n`;
                    });
                } else {
                    cryptoText += `Vous n'avez pas encore investi dans la crypto.\nLe Bitcoin tourne autour de ~37,500,000 XAF aujourd'hui.`;
                }
                aiResponse = cryptoText + `\n\nN'hésitez pas à aller sur l'onglet Crypto V8 pour trader instantanément !`;
                break;

            case 'CARDS':
                if (user.virtualCards && user.virtualCards.length > 0) {
                    const activeCards = user.virtualCards.filter(c => c.status === 'ACTIVE').length;
                    aiResponse = `💳 Vous avez **${user.virtualCards.length} carte(s) virtuelle(s)**, dont ${activeCards} active(s).\n\nPour des questions de sécurité, souvenez-vous que vous pouvez geler votre carte à tout moment depuis l'onglet "Cartes".`;
                } else {
                    aiResponse = `💳 Vous n'avez pas encore de carte virtuelle générée.\nLa création est 100% gratuite. Visitez l'onglet "Cartes" pour obtenir votre carte holographique !`;
                }
                break;

            case 'TONTINE':
                aiResponse = `🤝 **Tontines V5 :**\nL'intelligence de groupe au service de l'épargne !\nConsultez l'onglet Profil > Tontines pour retrouver votre historique de tontine, valider des paiements ou annuler des cycles d'épargne rotative.`;
                break;

            default:
                aiResponse = `🤖 Je suis **Montia**, l'intelligence artificielle de Mongain.\nJe peux vous aider à consulter votre solde, vérifier vos cryptos, ou surveiller vos cartes. Que souhaitez-vous savoir ?`;
                break;
        }

        // Simulate 1.5s thinking time
        setTimeout(() => {
            res.json({ reply: aiResponse });
        }, 1500);

    } catch (e: any) {
        logger.error(`[AI Chat] ${e.message}`);
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
