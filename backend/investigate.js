const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const vaults = await prisma.vault.findMany({ select: { id: true, name: true, balance: true } });
    const branches = await prisma.branch.findMany({ select: { id: true, name: true, balance: true, wallet: { select: { balance: true } } } });
    const userWallets = await prisma.wallet.findMany({
        where: { balance: { gt: 0 } },
        select: { userId: true, balance: true, currency: true, user: { select: { name: true, role: true } } },
        orderBy: { balance: 'desc' },
        take: 20
    });

    console.log('--- VAULTS ---');
    console.log(JSON.stringify(vaults, null, 2));
    console.log('--- BRANCHES ---');
    console.log(JSON.stringify(branches, null, 2));
    console.log('--- TOP USER WALLETS ---');
    console.log(JSON.stringify(userWallets, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
