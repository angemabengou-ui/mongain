import crypto from 'crypto';
import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { prisma } from '../prisma';
import { friendlyErrorMessage } from '../utils/errors';
import { sendPushNotification } from './admin.push';

const router = Router();

// ==========================================
// Mongain Connect (Public/Merchant Gateway)
// ==========================================

// 1. Merchant Dashboard - Generate API Key
router.post('/keys/generate', authMiddleware, async (req: AuthRequest, res) => {
    try {
        if (!req.userId) return res.status(401).json({ error: "Unauthorized" });

        const user = await prisma.user.findUnique({
            where: { id: req.userId }
        });

        if (!user || user.role !== 'MERCHANT') {
            return res.status(403).json({ error: "Only Merchants can generate API Keys." });
        }

        const rawKey = `sk_live_${crypto.randomBytes(32).toString('hex')}`;

        // Hash it before storing in DB (Best Practice, like Stripe)
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        await prisma.apiKey.create({
            data: {
                merchantId: user.id,
                keyHash: keyHash,
                isActive: true
            }
        });

        // We only show the raw key ONCE to the user.
        res.status(201).json({
            success: true,
            message: "Clé API générée avec succès. Copiez-la, elle ne s'affichera plus.",
            apiKey: rawKey
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// 2. Gateway Endpoint (Used by Third-Party Apps to charge users)
// Typically, the third party app requests a payment, we send an OTP/Push to User, User approves -> Money moves.
router.post('/charge', async (req, res) => {
    try {
        // Authenticate the Merchant using Bearer Token (API Key)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: "Missing API Key" });
        }

        const rawKey = authHeader.split(' ')[1];
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const apiKey = await prisma.apiKey.findUnique({
            where: { keyHash },
            include: { merchant: { include: { wallet: true } } }
        });

        if (!apiKey || !apiKey.isActive) {
            return res.status(401).json({ error: "Invalid API Key" });
        }

        const { customerPhone, amount, orderId } = req.body;
        const chargeAmount = parseFloat(amount);

        if (!customerPhone || isNaN(chargeAmount) || chargeAmount < 100) {
            return res.status(400).json({ error: "Invalid Checkout Payload" });
        }

        const customer = await prisma.user.findUnique({
            where: { phone: customerPhone },
            include: { wallet: true }
        });

        if (!customer || !customer.wallet) {
            return res.status(404).json({ error: "Mongain User not found" });
        }

        // Ideally here we send a Push Notification / OTP to the customer and HOLD the transaction.
        // For architectural prototype Phase 1, we simulate an 'Invoice' creation that the user can pay.

        const invoice = await prisma.invoice.create({
            data: {
                merchantId: apiKey.merchantId,
                customerPhone: customerPhone,
                amount: chargeAmount,
                description: `Mongain Connect Checkout: ${orderId || 'WEB_ORD'}`
            }
        });

        // Etape V21: 3D Secure Notification
        if (customer.pushToken) {
            await sendPushNotification(
                customer.pushToken,
                "Autorisation de Paiement 🔒",
                `Le marchand ${apiKey.merchant.name || apiKey.merchant.phone} demande à prélever ${chargeAmount} CFA. Ouvrez l'app pour valider.`,
                { invoiceId: invoice.id, merchantName: apiKey.merchant.name }
            );
        }

        res.status(200).json({
            success: true,
            status: "REQUIRES_CUSTOMER_APPROVAL",
            invoiceId: invoice.id,
            message: "Facture soumise. En attente de validation client sur l'application Mongain."
        });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

export default router;
