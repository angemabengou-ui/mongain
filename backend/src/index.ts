import bcrypt from 'bcryptjs';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { initCronJobs } from './cron';
import { prisma } from './prisma';
import adminRoutes from './routes/admin';
import agencyRoutes from './routes/agency';
import authRoutes from './routes/auth';
import corpRoutes from './routes/corp';
import merchantRoutes from './routes/merchant';
import notificationRoutes from './routes/notifications';
import servicesRoutes from './routes/services';
import settingsRoutes from './routes/settings';
import tontineRoutes from './routes/tontine';
import treasuryRoutes from './routes/treasury';
import vaultRoutes from './routes/vault';
import walletRoutes from './routes/wallet';
import { logError } from './utils/errorLog';
import { withDbRetry } from './utils/errors';
import logger from './utils/logger';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.set('io', io); // Makes it available to routes via req.app.get('io')

const PORT = process.env.PORT || 3000;

// Security Middleware (XSS, Clickjacking, Sniffing prevention)
app.use(helmet());

// CORS configuration (Restrict domains)
const isProd = process.env.NODE_ENV === 'production';
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        const allowed = [
            'http://localhost:5173',
            'http://localhost:3000',
            'http://localhost:8081',
            'https://mongain-backend.onrender.com',
            'https://mongain.vercel.app',
            ...extraAllowedOrigins,
        ];
        if (allowed.includes(origin)) {
            return callback(null, true);
        }
        // Sous-domaines de preview (Vercel/Netlify/Render) : uniquement hors production.
        // En production, seule la liste explicite ci-dessus (+ ALLOWED_ORIGINS) est acceptée.
        if (
            !isProd &&
            (origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app') || origin.endsWith('.onrender.com'))
        ) {
            return callback(null, true);
        }
        callback(new Error('CORS: origine non autorisée — ' + origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder', 'ngrok-skip-browser-warning']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

import { circuitBreakerMiddleware } from './middleware/circuitBreaker';
import reclamationRoutes from './routes/reclamation';
import webhookRoutes from './routes/webhooks';

// ==========================================
// ROUTES SYSTEME ET ADMINISTRATION (SAFE)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/treasury', treasuryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reclamation', reclamationRoutes);
// /api/corp = authentification/session du personnel (login, me, changement de mot de
// passe), pas d'opération financière : si on la protège par le Circuit Breaker, l'activer
// verrouille aussi la connexion elle-même, empêchant quiconque n'a pas déjà une session
// active de se reconnecter pour aller le désactiver depuis Paramètres — un auto-blocage.
app.use('/api/corp', corpRoutes);
// Notifications entrantes de PVit — jamais derrière le Circuit Breaker : un dépôt déjà
// débité côté opérateur doit toujours pouvoir être confirmé et crédité, même en verrouillage
// d'urgence, sinon l'argent du client reste bloqué en PENDING indéfiniment.
app.use('/api/webhooks', webhookRoutes);

// ==========================================
// ROUTES FINANCIERES (PROTECTED BY CIRCUIT BREAKER)
// ==========================================
app.use('/api/wallet', circuitBreakerMiddleware, walletRoutes);
app.use('/api/merchant', circuitBreakerMiddleware, merchantRoutes);
app.use('/api/vaults', circuitBreakerMiddleware, vaultRoutes);
app.use('/api/tontine', circuitBreakerMiddleware, tontineRoutes);
app.use('/api/services', circuitBreakerMiddleware, servicesRoutes);
app.use('/api/agency', circuitBreakerMiddleware, agencyRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'Mongain Backend', socket: true }));

// Filet de sécurité : capture toute exception qu'un handler de route n'a pas déjà attrapée
// dans son propre try/catch (Express 5 route les rejets de promesse async ici automatiquement).
// Journalisée dans ErrorLog (page "Erreurs Système" de l'admin-web) pour rester visible même
// sans try/catch dédié à chaque endroit.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Erreur non gérée:', err);
    logError('UNCAUGHT', err?.message || String(err), { stack: err?.stack, method: req.method }, { path: req.path });
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Une erreur inattendue est survenue.' });
});

// Socket.io Connection Helper
io.on('connection', (socket) => {
    console.log('⚡ Socket connected:', socket.id);

    // Le client enverra un événement 'register' avec son numéro de téléphone ou ID
    socket.on('register', (phone: string) => {
        socket.join(`user_${phone}`);
        console.log(`🔗 Scocket ${socket.id} joined room user_${phone}`);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Socket disconnected:', socket.id);
    });
});

// Le port doit s'ouvrir IMMÉDIATEMENT, avant toute requête base de données — Render (et tout
// hébergeur avec un health-check de port) tue le déploiement si rien n'écoute assez vite, et
// /health lui-même ne dépend pas de la base. Avant ce correctif, le seed du compte Corporate
// ci-dessous bloquait server.listen() : un simple ralentissement Neon au démarrage suffisait
// à faire échouer tout le déploiement ("Port scan timeout"), alors que rien de fonctionnel
// n'en dépendait vraiment.
server.listen(PORT, () => {
    logger.info(`✅ Serveur Mongain en ligne sur http://localhost:${PORT}`);
    logger.info(`🛰️  WebSockets (Socket.io) Actifs`);
    if (isProd && !process.env.TWILIO_ACCOUNT_SID) {
        logger.warn('\n⚠️  ⚠️  ⚠️  SMS NON CONFIGURÉ EN PRODUCTION ⚠️  ⚠️  ⚠️');
        logger.warn('Tous les codes OTP (inscription, connexion, réinitialisation de PIN) sont');
        console.warn('actuellement fixés à "1234" — quiconque connaît ce code peut réinitialiser');
        console.warn('le PIN de N\'IMPORTE QUEL compte. Ce mode démo doit être désactivé (en');
        console.warn('configurant TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER) avant');
        console.warn('d\'accepter de vrais utilisateurs.\n');
    }
});

initCronJobs();

async function seedCorporateAccount() {
    const corpPhone = '+2410000000';
    try {
        const existing = await withDbRetry(() => prisma.user.findUnique({ where: { phone: corpPhone } }));
        if (!existing) {
            // PIN aléatoire non journalisé (cohérent avec getOrCreateCorporateWallet dans
            // wallet.ts) — ce compte est un portefeuille technique, jamais censé être utilisé
            // pour se connecter. Un PIN "0000" fixe et documenté en dur était un accès admin
            // total trivialement devinable dès que l'OTP est en mode démo (voir auth.ts).
            const hashedPin = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
            await prisma.user.create({
                data: {
                    name: 'Mongain Corporate',
                    phone: corpPhone,
                    pin: hashedPin,
                    role: 'ADMIN',
                    wallet: { create: { balance: 0, currency: 'FCFA' } }
                }
            });
            console.log('✅ Admin Corporate Account Created.');
        }
    } catch (e) {
        // Non bloquant : ce seed est idempotent et se retentera au prochain redémarrage.
        console.error('⚠️  Échec de la vérification/création du compte Corporate (non bloquant) :', e);
    }
}

seedCorporateAccount();
