import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { prisma } from './prisma';
import adminRoutes from './routes/admin';
import authRoutes from './routes/auth';
import merchantRoutes from './routes/merchant';
import notificationRoutes from './routes/notifications';
import settingsRoutes from './routes/settings';
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
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://mongain-backend.onrender.com'], // Vite Admin & Local Mobile/Web
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
    const corpPhone = '+24100000000';
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

    server.listen(PORT, () => {
        console.log(`✅ Serveur Mongain en ligne sur http://localhost:${PORT}`);
        console.log(`🛰️  WebSockets (Socket.io) Actifs`);
    });
}

initializeApp().catch(console.error);
