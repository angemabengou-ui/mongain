import bcrypt from 'bcryptjs';
import cors from 'cors';
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
import walletRoutes from './routes/wallet';

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

// ==========================================
// ROUTES FINANCIERES (PROTECTED BY CIRCUIT BREAKER)
// ==========================================
app.use('/api/wallet', circuitBreakerMiddleware, walletRoutes);
app.use('/api/merchant', circuitBreakerMiddleware, merchantRoutes);
app.use('/api/tontine', circuitBreakerMiddleware, tontineRoutes);
app.use('/api/services', circuitBreakerMiddleware, servicesRoutes);
app.use('/api/agency', circuitBreakerMiddleware, agencyRoutes);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', app: 'Mongain Backend', socket: true }));

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

async function initializeApp() {
    // Seed Corporate Account
    const corpPhone = '+2410000000';

    const existing = await prisma.user.findUnique({ where: { phone: corpPhone } });
    if (!existing) {
        const hashedPin = await bcrypt.hash('0000', 10);
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

    // Init Tontine Cron
    initCronJobs();

    server.listen(PORT, () => {
        console.log(`✅ Serveur Mongain en ligne sur http://localhost:${PORT}`);
        console.log(`🛰️  WebSockets (Socket.io) Actifs`);
        if (isProd && !process.env.TWILIO_ACCOUNT_SID) {
            console.warn('\n⚠️  ⚠️  ⚠️  SMS NON CONFIGURÉ EN PRODUCTION ⚠️  ⚠️  ⚠️');
            console.warn('Tous les codes OTP (inscription, connexion, réinitialisation de PIN) sont');
            console.warn('actuellement fixés à "1234" — quiconque connaît ce code peut réinitialiser');
            console.warn('le PIN de N\'IMPORTE QUEL compte. Ce mode démo doit être désactivé (en');
            console.warn('configurant TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER) avant');
            console.warn('d\'accepter de vrais utilisateurs.\n');
        }
    });
}

initializeApp().catch(console.error);
