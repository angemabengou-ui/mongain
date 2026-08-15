import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';
import { prisma } from '../prisma';

const router = express.Router();

router.post('/init', async (req, res) => {
    try {
        const count = await prisma.staff.count();
        if (count > 0) return res.status(403).json({ error: 'Root already initialized' });

        // Create Headquarters Branch
        const hq = await prisma.branch.create({
            data: { name: 'Mongain Headquarters', city: 'Libreville', isHQ: true }
        });

        const hash = await bcrypt.hash('admin1234', 10);
        const root = await prisma.staff.create({
            data: {
                email: 'admin@mongain.com',
                password: hash,
                name: 'Root SuperAdmin',
                role: 'SUPER_ADMIN',
                branchId: hq.id
            }
        });

        res.json({ message: 'Root initialized', email: root.email, password: 'admin1234' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const staff = await prisma.staff.findUnique({ where: { email } });

        if (!staff || !staff.isActive) {
            return res.status(401).json({ error: 'Identifiants invalides ou compte suspendu' });
        }

        if (staff.status === 'PENDING') {
            return res.status(401).json({ error: 'Accès refusé. Votre recrutement est "EN ATTENTE" de validation par la Direction (Maker-Checker).' });
        }

        const valid = await bcrypt.compare(password, staff.password);
        if (!valid) {
            return res.status(401).json({ error: 'Identifiants invalides' });
        }

        const token = jwt.sign({ userId: staff.id, role: staff.role, isCorp: true }, JWT_SECRET, { expiresIn: '12h' });
        res.json({
            token,
            user: {
                id: staff.id,
                name: staff.name,
                role: staff.role,
                email: staff.email,
                branchId: staff.branchId
            }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
