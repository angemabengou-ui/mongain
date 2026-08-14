import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { initCronJobs } from './cron';
import { prisma } from './prisma';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import merchantRoutes from './routes/merchant';
import notificationRoutes from './routes/notifications';
import servicesRoutes from './routes/services';
import settingsRoutes from './routes/settings';
import tontineRoutes from './routes/tontine';
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
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        const allowed = [
            'http://localhost:5173',
            'http://localhost:3000',
            'http://localhost:8081',
            'https://mongain-backend.onrender.com',
        ];
        if (
            allowed.includes(origin) ||
            origin.endsWith('.vercel.app') ||
            origin.endsWith('.netlify.app') ||
            origin.endsWith('.onrender.com')
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

import reclamationRoutes from './routes/reclamation';

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reclamation', reclamationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/tontine', tontineRoutes);
app.use('/api/services', servicesRoutes);

// ▶️ Route d'initialisation Super Admin (à appeler UNE SEULE FOIS)
app.get('/api/init-admin', async (_req, res) => {
    try {
        const bcrypt = await import('bcryptjs');
        const hashedPin = await bcrypt.hash('0000', 10);
        const admin = await prisma.user.upsert({
            where: { phone: '+2410000000' },
            update: { role: 'ADMIN', isActive: true },
            create: {
                phone: '+2410000000',
                name: 'Super Admin Mongain',
                username: 'superadmin',
                pin: hashedPin,
                role: 'ADMIN',
                isActive: true,
                wallet: { create: { balance: 0 } }
            }
        });
        return res.json({ success: true, message: '✅ Super Admin créé/mis à jour.', phone: admin.phone, role: admin.role });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// ▶️ Route de Nettoyage Doublons
app.get('/api/merge-admins', async (_req, res) => {
    try {
        const oldCorp = await prisma.user.findUnique({ where: { phone: '+24100000000' }, include: { wallet: true } });
        const newCorp = await prisma.user.findUnique({ where: { phone: '+2410000000' }, include: { wallet: true } });

        let actions = [];

        if (oldCorp && newCorp) {
            const oldBalance = oldCorp.wallet?.balance || 0;
            if (oldBalance > 0 && newCorp.wallet) {
                await prisma.wallet.update({
                    where: { id: newCorp.wallet.id },
                    data: { balance: { increment: oldBalance } }
                });
                actions.push(`Transféré ${oldBalance} FCFA vers le nouveau compte.`);
            }

            await prisma.user.update({
                where: { id: oldCorp.id },
                data: { phone: '+24100000000_ARCHIVED_' + Date.now(), role: 'USER', isActive: false }
            });
            actions.push('Ancien compte archivé et déchu.');

            if (oldCorp.wallet) {
                await prisma.wallet.update({ where: { id: oldCorp.wallet.id }, data: { balance: 0 } });
            }
        }

        return res.json({ success: true, oldCorpExists: !!oldCorp, newCorpExists: !!newCorp, actions });
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

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
    });
}

initializeApp().catch(console.error);
