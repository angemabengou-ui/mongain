import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import { retryWebhookDelivery } from '../utils/webhookDelivery';
// admin.push.ts (qui définissait ce helper) a été supprimé : c'était un doublon non protégé
// de routes/push.ts, entièrement shadowé côté route — mais cette fonction d'envoi (elle,
// utilisée ici) était un vrai dépendant. wallet.ts exporte déjà le même helper à un
// destinataire unique, sous le nom `sendPush` — réutilisé plutôt que redupliqué.
import { sendPush as sendPushNotification } from './wallet';

const router = Router();

// ==========================================
// Mongain Connect (API publique marchand) — self-service
// ==========================================
// Distinct du flux ADMIN équivalent (routes/admin.ts POST/GET/PATCH /api-integrations et
// /api-integrations/:id/rotate, réservé au staff SUPER_ADMIN/COMPLIANCE_CHECKER/RISK, qui
// gère ces mêmes ApiIntegration POUR le compte d'un marchand) : ici c'est le marchand
// LUI-MÊME qui génère/consulte/tourne ses propres clés, sans intervention du personnel.
// ApiLog.actorId (simple String, pas une clé étrangère) porte alors l'id du MARCHAND plutôt
// que celui d'un Staff — cohérent avec le reste du modèle (le commentaire de schema.prisma
// décrit l'usage staff le plus courant, pas une contrainte).
//
// Ancien modèle ApiKey (keyHash SHA-256 nu, sans salage) entièrement abandonné au profit
// d'ApiIntegration (secretHash bcrypt, webhookSigningSecret, liaison Invoice.integrationId
// pour les webhooks sortants) — vérifié : ApiKey n'était utilisé nulle part ailleurs dans les
// routes de ce backend.

async function requireMerchant(userId: string | undefined) {
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'MERCHANT') return null;
    return user;
}

function generateRawSecret(): string {
    return `sk_live_${crypto.randomBytes(32).toString('hex')}`;
}

function generateWebhookSigningSecret(): string {
    return crypto.randomBytes(32).toString('hex');
}

// POST /api/gateway/keys/generate — génère une nouvelle intégration pour le marchand
// authentifié. Le secret ET le secret de signature webhook ne sont affichés QU'UNE SEULE
// FOIS dans cette réponse (seul secretHash, un hash bcrypt, est conservé en base).
router.post('/keys/generate', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const rawSecret = generateRawSecret();
        const secretHash = await bcrypt.hash(rawSecret, 10);
        const webhookSigningSecret = generateWebhookSigningSecret();

        const { appName } = req.body;

        const integration = await prisma.apiIntegration.create({
            data: {
                merchantId: user.id,
                appName: (typeof appName === 'string' && appName.trim()) ? appName.trim() : 'Mongain Connect',
                environment: 'LIVE',
                secretHash,
                webhookSigningSecret,
            },
        });

        await prisma.apiLog.create({
            data: {
                integrationId: integration.id,
                action: 'GENERATE',
                actorId: user.id,
                ipAddress: req.ip ? String(req.ip) : null,
            },
        });

        return res.status(201).json({
            success: true,
            message: "Clé API générée avec succès. Copiez ces informations, elles ne s'afficheront plus.",
            publicKey: integration.publicKey,
            secret: rawSecret,
            webhookSigningSecret,
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/gateway/keys — liste les intégrations du marchand, JAMAIS les secrets (ni
// secretHash, ni webhookSigningSecret).
router.get('/keys', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const integrations = await prisma.apiIntegration.findMany({
            where: { merchantId: user.id },
            select: {
                id: true,
                appName: true,
                environment: true,
                publicKey: true,
                webhookUrl: true,
                isActive: true,
                permissions: true,
                description: true,
                rotatedAt: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ success: true, integrations });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// PATCH /api/gateway/keys/:id — le marchand ajuste son webhookUrl et/ou active/désactive
// son intégration (jamais son secret : voir POST /keys/:id/rotate pour ça).
router.patch('/keys/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const integration = await prisma.apiIntegration.findUnique({ where: { id: req.params.id as string } });
        if (!integration || integration.merchantId !== user.id) {
            return res.status(404).json({ error: 'Intégration introuvable.' });
        }

        const { webhookUrl, isActive } = req.body;
        const data: { webhookUrl?: string | null; isActive?: boolean } = {};

        if (webhookUrl !== undefined) {
            if (webhookUrl !== null && typeof webhookUrl !== 'string') {
                return res.status(400).json({ error: 'webhookUrl doit être une chaîne ou null.' });
            }
            data.webhookUrl = webhookUrl;
        }
        if (isActive !== undefined) {
            if (typeof isActive !== 'boolean') {
                return res.status(400).json({ error: 'isActive doit être un booléen.' });
            }
            data.isActive = isActive;
        }
        if (Object.keys(data).length === 0) {
            return res.status(400).json({ error: 'Aucune modification fournie.' });
        }

        const updated = await prisma.apiIntegration.update({ where: { id: integration.id }, data });

        return res.json({
            success: true,
            integration: {
                id: updated.id,
                appName: updated.appName,
                environment: updated.environment,
                publicKey: updated.publicKey,
                webhookUrl: updated.webhookUrl,
                isActive: updated.isActive,
                permissions: updated.permissions,
                description: updated.description,
            },
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// POST /api/gateway/keys/:id/rotate — régénère secret ET secret de signature webhook (les
// anciens deviennent immédiatement invalides). Journalisé (ApiLog action ROTATE).
router.post('/keys/:id/rotate', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const integration = await prisma.apiIntegration.findUnique({ where: { id: req.params.id as string } });
        if (!integration || integration.merchantId !== user.id) {
            return res.status(404).json({ error: 'Intégration introuvable.' });
        }

        const rawSecret = generateRawSecret();
        const secretHash = await bcrypt.hash(rawSecret, 10);
        const webhookSigningSecret = generateWebhookSigningSecret();

        await prisma.apiIntegration.update({
            where: { id: integration.id },
            data: { secretHash, webhookSigningSecret, rotatedAt: new Date() },
        });

        await prisma.apiLog.create({
            data: {
                integrationId: integration.id,
                action: 'ROTATE',
                actorId: user.id,
                ipAddress: req.ip ? String(req.ip) : null,
            },
        });

        return res.json({
            success: true,
            message: "Secret régénéré. Copiez ces informations, elles ne s'afficheront plus.",
            publicKey: integration.publicKey,
            secret: rawSecret,
            webhookSigningSecret,
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// Encaissement (appelé par l'application tierce du marchand, pas par l'app Mongain)
// ==========================================

// POST /api/gateway/charge — authentifié par clé API (Authorization: Bearer
// {publicKey}.{secret}), PAS par une session Mongain classique. Typiquement, l'app tierce
// demande un prélèvement, le client Mongain approuve depuis l'app mobile (Invoice PENDING),
// exactement comme un B2B classique (routes/b2b.ts /invoices/:id/pay).
router.post('/charge', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Clé API manquante.' });
        }

        const rawToken = authHeader.slice('Bearer '.length);
        // Format simple `{publicKey}.{secret}` — un point sépare les deux, le secret lui-même
        // (hex uniquement) n'en contient jamais, donc le PREMIER point rencontré marque
        // toujours la frontière exacte entre les deux parties.
        const separatorIndex = rawToken.indexOf('.');
        if (separatorIndex <= 0 || separatorIndex === rawToken.length - 1) {
            return res.status(401).json({ error: 'Format de clé API invalide.' });
        }
        const publicKey = rawToken.slice(0, separatorIndex);
        const secret = rawToken.slice(separatorIndex + 1);

        const integration = await prisma.apiIntegration.findUnique({
            where: { publicKey },
            include: { merchant: { include: { wallet: true } } },
        });

        if (!integration || !integration.isActive) {
            return res.status(401).json({ error: 'Clé API invalide.' });
        }

        const secretMatch = await bcrypt.compare(secret, integration.secretHash);
        if (!secretMatch) {
            return res.status(401).json({ error: 'Clé API invalide.' });
        }

        const { customerPhone, amount, orderId } = req.body;
        // Le FCFA n'a aucune sous-unité — arrondi ici, sinon l'écriture Prisma échoue sur un
        // montant décimal (Invoice.amount est Int).
        const chargeAmount = Math.round(parseFloat(amount));

        if (!customerPhone || isNaN(chargeAmount) || chargeAmount < 100) {
            return res.status(400).json({ error: 'Requête de paiement invalide.' });
        }

        const customer = await prisma.user.findUnique({
            where: { phone: customerPhone },
            include: { wallet: true },
        });

        if (!customer || !customer.wallet) {
            return res.status(404).json({ error: 'Utilisateur Mongain introuvable.' });
        }

        // Ideally here we send a Push Notification / OTP to the customer and HOLD the transaction.
        // For architectural prototype Phase 1, we simulate an 'Invoice' creation that the user can pay.
        const invoice = await prisma.invoice.create({
            data: {
                merchantId: integration.merchantId,
                integrationId: integration.id,
                customerPhone,
                amount: chargeAmount,
                description: `Mongain Connect Checkout: ${orderId || 'WEB_ORD'}`,
            },
        });

        if (customer.pushToken) {
            await sendPushNotification(
                customer.pushToken,
                'Autorisation de Paiement 🔒',
                `Le marchand ${integration.merchant.name || integration.merchant.phone} demande à prélever ${chargeAmount} CFA. Ouvrez l'app pour valider.`,
                { invoiceId: invoice.id, merchantName: integration.merchant.name }
            );
        }

        return res.status(200).json({
            success: true,
            status: 'REQUIRES_CUSTOMER_APPROVAL',
            invoiceId: invoice.id,
            message: "Facture soumise. En attente de validation client sur l'application Mongain.",
        });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// Webhooks sortants (voir utils/webhookDelivery.ts, branché sur routes/b2b.ts
// /invoices/:id/pay et /reject)
// ==========================================

// POST /api/gateway/webhook-deliveries/:id/retry — rejeu manuel d'une livraison FAILED,
// geste explicite du marchand (contrairement à la livraison initiale, best-effort et sans
// retry automatique — voir utils/webhookDelivery.ts).
router.post('/webhook-deliveries/:id/retry', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const delivery = await prisma.apiWebhookDelivery.findUnique({
            where: { id: req.params.id as string },
            include: { integration: true },
        });
        if (!delivery || delivery.integration.merchantId !== user.id) {
            return res.status(404).json({ error: 'Livraison introuvable.' });
        }

        await retryWebhookDelivery(delivery, delivery.integration);

        const updated = await prisma.apiWebhookDelivery.findUnique({ where: { id: delivery.id } });
        return res.json({ success: true, delivery: updated });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// GET /api/gateway/webhook-deliveries?integrationId=
router.get('/webhook-deliveries', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await requireMerchant(req.userId);
        if (!user) return res.status(403).json({ error: 'Réservé aux Marchands.' });

        const { integrationId } = req.query;
        if (!integrationId || typeof integrationId !== 'string') {
            return res.status(400).json({ error: 'integrationId requis.' });
        }

        const integration = await prisma.apiIntegration.findUnique({ where: { id: integrationId } });
        if (!integration || integration.merchantId !== user.id) {
            return res.status(404).json({ error: 'Intégration introuvable.' });
        }

        const deliveries = await prisma.apiWebhookDelivery.findMany({
            where: { integrationId },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ success: true, deliveries });
    } catch (e: any) {
        return res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
