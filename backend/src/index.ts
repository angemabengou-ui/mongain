import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { initCronJobs } from './cron';
import adminRoutes from './routes/admin';
import adminMerchantsRoutes from './routes/admin.merchants';
import adminSearchRoutes from './routes/admin.search';
import adminSystemAccountsRoutes from './routes/admin.systemAccounts';
import adminTontinesRoutes from './routes/admin.tontines';
import adminVaultsRoutes from './routes/admin.vaults';
import agencyRoutes from './routes/agency';
import aiRoutes from './routes/ai';
import authRoutes from './routes/auth';
import cardsRoutes from './routes/cards';
import corpRoutes from './routes/corp';
import cryptoRoutes from './routes/crypto';
import merchantRoutes from './routes/merchant';
import notificationRoutes from './routes/notifications';
import pushRoutes from './routes/push';
import rbacRoutes from './routes/rbac';
import scoringRoutes from './routes/scoring';
import servicesRoutes from './routes/services';
import settingsRoutes from './routes/settings';
import tontineRoutes from './routes/tontine';
import treasuryRoutes from './routes/treasury';
import vaultRoutes from './routes/vault';
import walletRoutes from './routes/wallet';
import webhookRoutes from './routes/webhooks';
import { getSystemAccount } from './services/systemAccounts';
import { resolveSocketRoom } from './sockets/socketAuth';
import { logError } from './utils/errorLog';
import { withDbRetry } from './utils/errors';
import logger from './utils/logger';

const app = express();

// Render (comme Heroku/Fly.io) place l'app derrière EXACTEMENT un saut de proxy inverse à
// son bord — sans ce réglage, `req.ip` renvoie l'IP interne de ce proxy (la même pour
// toutes les requêtes) plutôt que la vraie IP du client, et express-rate-limit clé alors
// ses 3 limiteurs par IP (SMS, connexion client, connexion staff) sur cette même valeur
// partagée : leur limite par IP devient de fait une limite globale, unique, partagée par
// TOUS les utilisateurs à la fois. `1` (pas `true`) : ne fait confiance qu'au dernier
// maillon X-Forwarded-For posé par Render, jamais à une valeur que le client pourrait
// injecter lui-même plus en amont.
app.set('trust proxy', 1);

const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// CORS configuration (Restrict domains) — extrait en fonction nommée pour être partagé
// entre le CORS Express (API REST) et le CORS Socket.io ci-dessous : celui-ci acceptait
// jusqu'ici `origin: '*'` (n'importe quelle page web pouvait ouvrir une connexion
// WebSocket vers ce serveur), alors que l'API REST est déjà correctement restreinte à
// une liste précise depuis le début. Une seule logique d'autorisation, jamais deux
// copies qui peuvent diverger.
const isProd = process.env.NODE_ENV === 'production';
const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

function isOriginAllowed(origin: string | undefined): boolean {
    // Pas d'origine (apps mobiles, curl, Postman, clients Socket.io natifs) : autorisé.
    if (!origin) return true;
    const allowed = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:8081',
        'https://mongain-backend.onrender.com',
        'https://mongain.vercel.app',
        ...extraAllowedOrigins,
    ];
    if (allowed.includes(origin)) return true;
    // Sous-domaines de preview (Vercel/Netlify/Render) : uniquement hors production.
    // En production, seule la liste explicite ci-dessus (+ ALLOWED_ORIGINS) est acceptée.
    if (!isProd && (origin.endsWith('.vercel.app') || origin.endsWith('.netlify.app') || origin.endsWith('.onrender.com'))) {
        return true;
    }
    return false;
}

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin)) return callback(null, true);
            callback(new Error('CORS: origine non autorisée — ' + origin));
        }
    }
});

app.set('io', io); // Makes it available to routes via req.app.get('io')

// Security Middleware (XSS, Clickjacking, Sniffing prevention)
app.use(helmet());

app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        callback(new Error('CORS: origine non autorisée — ' + origin));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Bypass-Tunnel-Reminder', 'ngrok-skip-browser-warning']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- DEBUG LOGGER (dev uniquement) --- Restait actif en production : loggait le corps de
// CHAQUE réponse d'erreur (peut contenir des PII — nom, téléphone, montant) ainsi qu'un
// extrait du header Authorization sur la console du serveur, sans aucune protection.
if (!isProd) {
    app.use((req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            if (res.statusCode >= 400) {
                console.log(`[DEBUG HTTP] ${req.method} ${req.path} -> ${res.statusCode} | RES: ${JSON.stringify(body).slice(0, 200)}`);
                if (req.headers.authorization) console.log(`   authHeader: ${req.headers.authorization.substring(0, 30)}...`);
            }
            return originalJson(body);
        };
        next();
    });
}
// --------------------

import { adminIpAllowlistMiddleware } from './middleware/adminIpAllowlist';
import { circuitBreakerMiddleware } from './middleware/circuitBreaker';
import reclamationRoutes from './routes/reclamation';

// ==========================================
// ROUTES SYSTEME ET ADMINISTRATION (SAFE)
// ==========================================
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, adminRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, rbacRoutes); // RBAC: /api/admin/staff/:id/permissions & /api/admin/rbac/me
// Extraits du monolithe admin.ts — vaults/tontines/search/system-accounts sont des sections
// autonomes sans dépendance croisée avec branches/staff/users/KYC restés dans admin.ts.
app.use('/api/admin', adminIpAllowlistMiddleware, adminVaultsRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, adminTontinesRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, adminMerchantsRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, adminSearchRoutes);
app.use('/api/admin', adminIpAllowlistMiddleware, adminSystemAccountsRoutes);
app.use('/api/admin/push', adminIpAllowlistMiddleware, pushRoutes);
app.use('/api/admin/scoring', adminIpAllowlistMiddleware, scoringRoutes);
// /api/settings mélange une route publique (GET / — taux de frais lus par l'app mobile,
// accessible depuis n'importe où par nature) et des routes réservées au personnel : la
// restriction IP est appliquée route par route À L'INTÉRIEUR de settings.ts, jamais ici au
// niveau du mount, sous peine de couper l'app mobile de tous ses clients.
app.use('/api/settings', settingsRoutes);
app.use('/api/treasury', adminIpAllowlistMiddleware, treasuryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reclamation', reclamationRoutes);
// /api/corp = authentification/session du personnel (login, me, changement de mot de
// passe), pas d'opération financière : si on la protège par le Circuit Breaker, l'activer
// verrouille aussi la connexion elle-même, empêchant quiconque n'a pas déjà une session
// active de se reconnecter pour aller le désactiver depuis Paramètres — un auto-blocage.
// La restriction IP, elle, s'applique bien ici (y compris sur /corp/login) : c'est
// précisément l'effet recherché — une IP non listée ne doit jamais pouvoir même tenter de
// s'authentifier comme membre du personnel.
app.use('/api/corp', adminIpAllowlistMiddleware, corpRoutes);
// Notifications entrantes de PVit — jamais derrière le Circuit Breaker : un dépôt déjà
// débité côté opérateur doit toujours pouvoir être confirmé et crédité, même en verrouillage
// d'urgence, sinon l'argent du client reste bloqué en PENDING indéfiniment.
app.use('/api/webhooks', webhookRoutes);

// ==========================================
// ROUTES FINANCIERES (PROTECTED BY CIRCUIT BREAKER)
// ==========================================
app.use('/api/wallet', circuitBreakerMiddleware, walletRoutes);
app.use('/api/wallet/cards', circuitBreakerMiddleware, cardsRoutes);
app.use('/api/crypto', circuitBreakerMiddleware, cryptoRoutes);
app.use('/api/ai', circuitBreakerMiddleware, aiRoutes);
app.use('/api/merchant', circuitBreakerMiddleware, merchantRoutes);
app.use('/api/vaults', circuitBreakerMiddleware, vaultRoutes);
app.use('/api/tontine', circuitBreakerMiddleware, tontineRoutes);
app.use('/api/services', circuitBreakerMiddleware, servicesRoutes);
app.use('/api/agency', adminIpAllowlistMiddleware, circuitBreakerMiddleware, agencyRoutes);

// Health check
// `RENDER_GIT_COMMIT` est posée automatiquement par Render à chaque déploiement — bien plus
// utile que la version statique de package.json pour diagnostiquer un décalage entre deux
// services déployés séparément (ex: admin-web sur Vercel en retard sur ce backend, ou
// l'inverse) : ce champ permet de vérifier en un coup d'œil quel commit tourne réellement,
// au lieu de devoir tester chaque route à la main pour deviner si le déploiement a pris.
app.get('/health', (_req, res) => res.json({
    status: 'ok',
    app: 'Mongain Backend',
    socket: true,
    commit: process.env.RENDER_GIT_COMMIT || null,
}));

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

    // Le client envoie son token JWT (voir sockets/socketAuth.ts pour la faille corrigée par
    // ce changement) ; la salle rejointe est dérivée du numéro réel en base pour l'utilisateur
    // authentifié par ce token, jamais d'une valeur fournie telle quelle par le client.
    socket.on('register', async (authToken: string) => {
        const room = await resolveSocketRoom(authToken);
        if (room) {
            socket.join(room);
            console.log(`🔗 Socket ${socket.id} joined room ${room}`);
        }
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
    try {
        await withDbRetry(() => getSystemAccount('CORPORATE'));
    } catch (e) {
        // Non bloquant : getSystemAccount est idempotent (upsert par kind) et se retentera
        // au prochain redémarrage, ou au premier prélèvement de frais qui l'appelle aussi.
        console.error('⚠️  Échec de la vérification/création du compte Corporate (non bloquant) :', e);
    }
}

seedCorporateAccount();
