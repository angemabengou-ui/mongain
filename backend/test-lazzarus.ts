import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

async function verifyLazzarus() {
    console.log("Checking DB users...");
    const users = await prisma.user.findMany({ select: { id: true, name: true, phone: true, role: true, wallet: { select: { balance: true } } } });
    console.log("USERS:", users);

    // Create lazzarus if it doesn't exist
    let lazzarus = users.find(u => u.name.toLowerCase() === 'lazzarus');
    if (!lazzarus) {
        console.log("Creating Lazzarus...");
        const hashedPin = await bcrypt.hash('1234', 10);
        lazzarus = (await prisma.user.create({
            data: {
                name: 'Lazzarus',
                phone: '+24111223344',
                pin: hashedPin,
                role: 'CLIENT',
                wallet: { create: { balance: 100000 } }
            },
            include: { wallet: true }
        })) as any;
    }

    // Identify agent and a test sender
    let agent = users.find(u => u.role === 'AGENT');
    let admin = users.find(u => u.role === 'ADMIN');

    if (!agent) {
        const hashedPin = await bcrypt.hash('1234', 10);
        agent = (await prisma.user.create({
            data: {
                name: 'Agent Test',
                phone: '+24177665544',
                pin: hashedPin,
                role: 'AGENT',
                wallet: { create: { balance: 500000 } }
            },
            include: { wallet: true }
        })) as any;
    }

    console.log(`\n\n=== VERIFICATION SCENARIO FOR LAZZARUS ===\n`);
    console.log(`1. Lazzarus Phone: ${lazzarus!.phone} | Wallet: ${lazzarus!.wallet?.balance} FCFA`);
    console.log(`2. Agent Phone: ${agent!.phone} | Wallet: ${agent!.wallet?.balance} FCFA`);
}

verifyLazzarus().catch(console.error).finally(() => prisma.$disconnect());
