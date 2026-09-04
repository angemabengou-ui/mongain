import { Router } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { circuitBreakerMiddleware } from '../middleware/circuitBreaker';
import { prisma } from '../prisma';
import { LimitEngine } from '../services/LimitEngine';
import { friendlyErrorMessage } from '../utils/errors';
import { verifyUserPin } from '../utils/pinAuth';
import { getSystemSettings } from './settings';

const router = Router();

// Define explicit function to fetch active context
async function getActiveUser(userId?: string) {
    if (!userId) return null;
    return await prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
}

// ==========================================
// INVOICES (MERCHANT)
// ==========================================

// Create an Invoice
router.post('/invoices', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await getActiveUser(req.userId);
        if (!user || user.role !== 'MERCHANT') {
            return res.status(403).json({ error: "Réservé aux Marchands." });
        }

        const { customerPhone, amount, description } = req.body;

        // Un montant nul, négatif ou non numérique n'était jamais rejeté : réglé sur
        // /invoices/:id/pay, un montant négatif inverse silencieusement le sens des
        // `increment`/`decrement` de la transaction (le client payeur est CRÉDITÉ, le
        // marchand est DÉBITÉ) — un mécanisme d'auto-paiement à l'envers, hors de toute
        // logique de facturation, sans frais ni contrôle de plafond cohérent.
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: "Montant de facture invalide." });
        }
        if (!customerPhone || typeof customerPhone !== 'string') {
            return res.status(400).json({ error: "Numéro de téléphone client requis." });
        }

        const invoice = await prisma.invoice.create({
            data: {
                merchantId: user.id,
                customerPhone,
                amount: parsedAmount,
                description
            }
        });

        res.status(201).json({ success: true, invoice });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// List Invoices
router.get('/invoices', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await getActiveUser(req.userId);
        if (!user || user.role !== 'MERCHANT') {
            return res.status(403).json({ error: "Réservé aux Marchands." });
        }

        const invoices = await prisma.invoice.findMany({
            where: { merchantId: user.id },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, invoices });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Get My Pending Invoices (Customer)
router.get('/invoices/my', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await getActiveUser(req.userId);
        if (!user) return res.status(401).json({ error: "Profil illisible" });

        const invoices = await prisma.invoice.findMany({
            where: {
                customerPhone: user.phone,
                status: 'PENDING'
            },
            include: { merchant: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, invoices });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Pay an Invoice (Customer)
router.post('/invoices/:id/pay', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { pin } = req.body;
        const invoiceId = req.params.id as string;

        const user = await getActiveUser(req.userId);
        if (!user) return res.status(401).json({ error: "Profil illisible" });

        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId }
        });

        if (!invoice) return res.status(404).json({ error: "Facture introuvable." });
        if (invoice.status !== 'PENDING') return res.status(400).json({ error: "Cette facture est déjà payée ou annulée." });
        if (invoice.customerPhone !== user.phone) return res.status(403).json({ error: "Accès refusé." });

        if (!user.wallet) {
            return res.status(400).json({ error: "Wallets non initialisés." });
        }

        // Authenticate PIN — utilise le contrôle centralisé (verrouillage 3 échecs), comme
        // les autres rails de paiement ; un bcrypt.compare nu ici n'avait aucune limite de
        // tentatives, rendant l'espace à 4 chiffres du PIN brute-forçable.
        const pinCheck = await verifyUserPin(user, pin);
        if (!pinCheck.ok) return res.status(pinCheck.status).json({ error: pinCheck.error });

        const settings = await getSystemSettings();

        // Execute payment via Prisma atomic transaction
        const ref = `B2B_INV_${invoice.id.substring(0, 8).toUpperCase()}`;

        await prisma.$transaction(async (tx) => {
            // Plafonds AML/KYC — ce paiement de facture débitait le client sans passer par
            // aucun contrôle de plafond, contrairement aux rails de paiement équivalents.
            await LimitEngine.verifyAndIncrementConsumption(tx, user.id, user.wallet!.id, invoice.amount, settings);

            const senderWallet = await tx.wallet.findUnique({ where: { userId: user.id } });
            const merchantWallet = await tx.wallet.findUnique({ where: { userId: invoice.merchantId } });

            if (!senderWallet || !merchantWallet) throw new Error("Portefeuille introuvable.");
            if (senderWallet.balance < invoice.amount) throw new Error("Solde insuffisant.");

            // Débit atomique
            await tx.wallet.update({
                where: { id: senderWallet.id, balance: { gte: invoice.amount } },
                data: { balance: { decrement: invoice.amount } }
            });

            // Crédit marchand
            await tx.wallet.update({
                where: { id: merchantWallet.id },
                data: { balance: { increment: invoice.amount } }
            });

            // Traçabilité 
            await tx.transaction.create({
                data: {
                    amount: invoice.amount,
                    status: 'COMPLETED',
                    reference: ref,
                    senderWalletId: senderWallet.id,
                    receiverWalletId: merchantWallet.id,
                    fee: 0 // Optional platform fee logic
                }
            });

            // Marquer facturée
            await tx.invoice.update({
                where: { id: invoice.id },
                data: { status: 'PAID', paidAt: new Date(), transactionId: ref }
            });
        });

        res.json({ success: true, message: "Facture réglée avec succès." });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Reject an Invoice (Customer)
router.post('/invoices/:id/reject', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const invoiceId = req.params.id as string;

        const user = await getActiveUser(req.userId);
        if (!user) return res.status(401).json({ error: "Profil illisible" });

        const invoice = await prisma.invoice.findUnique({
            where: { id: invoiceId }
        });

        if (!invoice) return res.status(404).json({ error: "Facture introuvable." });
        if (invoice.status !== 'PENDING') return res.status(400).json({ error: "Cette facture est déjà traitée." });
        if (invoice.customerPhone !== user.phone) return res.status(403).json({ error: "Accès refusé." });

        await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'CANCELLED' }
        });

        res.json({ success: true, message: "Facture rejetée." });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// ==========================================
// MASS PAYOUTS (PAYROLL)
// ==========================================

router.post('/payouts', authMiddleware, circuitBreakerMiddleware, async (req: AuthRequest, res) => {
    try {
        const { name, entries } = req.body; // entries: [{ phone, amount }]

        const user = await getActiveUser(req.userId);
        if (!user || user.role !== 'MERCHANT') {
            return res.status(403).json({ error: "Réservé aux Marchands." });
        }

        if (!entries || !Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: "Liste de bénéficiaires invalide." });
        }

        // CRITIQUE : une entrée à montant négatif ou non numérique n'était jamais rejetée.
        // processBulkAsync ci-dessous applique `decrement: entry.amount` au marchand et
        // `increment: entry.amount` au bénéficiaire tel quel — avec un montant négatif, ces
        // deux opérations s'inversent silencieusement (le marchand est CRÉDITÉ, le
        // bénéficiaire est DÉBITÉ), sans le consentement de ce dernier, sans PIN, sans
        // aucune limite : n'importe quel compte MARCHAND pouvait ainsi vider le solde de
        // N'IMPORTE QUEL numéro de téléphone en le glissant dans un lot de paie.
        for (const e of entries) {
            const amt = parseFloat(e?.amount);
            if (!e?.phone || typeof e.phone !== 'string' || !Number.isFinite(amt) || amt <= 0) {
                return res.status(400).json({ error: "Chaque bénéficiaire doit avoir un téléphone et un montant positif valides." });
            }
        }

        const totalAmount = entries.reduce((sum: number, e: any) => sum + parseFloat(e.amount), 0);

        if (!user.wallet || user.wallet.balance < totalAmount) {
            return res.status(400).json({ error: `Solde insuffisant pour un total de ${totalAmount} FCFA.` });
        }

        const bulk = await prisma.payoutBulk.create({
            data: {
                merchantId: user.id,
                name: name || "Paie groupée",
                totalAmount,
                status: 'PROCESSING',
                entries: {
                    create: entries.map(e => ({
                        phone: e.phone,
                        amount: parseFloat(e.amount)
                    }))
                }
            },
            include: { entries: true }
        });

        // Trigger processing asynchrously
        processBulkAsync(bulk.id, user.id);

        res.status(202).json({ success: true, message: "Paiement groupé en cours de traitement.", bulkId: bulk.id });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

router.get('/payouts', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const user = await getActiveUser(req.userId);
        if (!user || user.role !== 'MERCHANT') {
            return res.status(403).json({ error: "Réservé aux Marchands." });
        }

        const bulks = await prisma.payoutBulk.findMany({
            where: { merchantId: user.id },
            include: { entries: true },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ success: true, bulks });
    } catch (e: any) {
        res.status(500).json({ error: friendlyErrorMessage(e) });
    }
});

// Async processor wrapper
async function processBulkAsync(bulkId: string, merchantId: string) {
    const bulk = await prisma.payoutBulk.findUnique({
        where: { id: bulkId },
        include: { entries: true }
    });
    if (!bulk) return;

    const merchantWallet = await prisma.wallet.findUnique({ where: { userId: merchantId } });
    if (!merchantWallet) return;

    for (const entry of bulk.entries) {
        try {
            await prisma.$transaction(async (tx) => {
                const targetUser = await tx.user.findUnique({ where: { phone: entry.phone }, include: { wallet: true } });
                if (!targetUser || !targetUser.wallet) throw new Error("Bénéficiaire introuvable");

                // Garde atomique B2B
                await tx.wallet.update({
                    where: { id: merchantWallet.id, balance: { gte: entry.amount } },
                    data: { balance: { decrement: entry.amount } }
                });

                await tx.wallet.update({
                    where: { id: targetUser.wallet.id },
                    data: { balance: { increment: entry.amount } }
                });

                const ref = `B2B_BULK_${entry.id.substring(0, 8).toUpperCase()}`;
                await tx.transaction.create({
                    data: {
                        amount: entry.amount,
                        status: 'COMPLETED',
                        reference: ref,
                        senderWalletId: merchantWallet.id,
                        receiverWalletId: targetUser.wallet.id,
                        fee: 0
                    }
                });

                await tx.payoutEntry.update({
                    where: { id: entry.id },
                    data: { status: 'SUCCESS', transactionId: ref }
                });
            });
        } catch (e: any) {
            await prisma.payoutEntry.update({
                where: { id: entry.id },
                data: { status: 'FAILED', errorReason: e.message }
            });
        }
    }

    // Mark Bulk finished
    await prisma.payoutBulk.update({
        where: { id: bulk.id },
        data: { status: 'COMPLETED', completedAt: new Date() }
    });
}

export default router;
