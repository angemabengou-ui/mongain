import { prisma } from './src/prisma';

async function main() {
    const logs = await prisma.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    console.log('Total logs:', logs.length);
    for (const log of logs) {
        console.log('\n---');
        console.log('Date:', log.createdAt.toISOString());
        console.log('Source:', log.source);
        console.log('Message:', log.message);
        console.log('Details:', log.details);
    }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
