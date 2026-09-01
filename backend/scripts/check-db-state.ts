import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
    const [branches, systemAccs, ct, ss] = await Promise.all([
        p.branch.findMany({ select: { id: true, name: true, isHQ: true, status: true } }),
        p.systemAccount.findMany({ select: { id: true, kind: true, name: true } }),
        p.centralTreasury.findMany({ select: { id: true, name: true } }),
        p.systemSettings.findMany({ select: { id: true } }),
    ]);
    console.log('Branches:', JSON.stringify(branches, null, 2));
    console.log('SystemAccounts:', JSON.stringify(systemAccs, null, 2));
    console.log('CentralTreasury:', JSON.stringify(ct, null, 2));
    console.log('SystemSettings count:', ss.length);
}
main().catch(e => console.error(e.message)).finally(() => p.$disconnect());
