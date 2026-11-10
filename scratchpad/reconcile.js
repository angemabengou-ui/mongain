require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const out = {};

    const wallet = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::text AS count, SUM(balance)::text AS sum_balance,
               SUM(CASE WHEN balance <> round(balance) THEN 1 ELSE 0 END)::text AS non_integer,
               SUM("dailySpent")::text AS sum_daily, SUM("monthlySpent")::text AS sum_monthly
        FROM "Wallet"
    `);
    out.Wallet = wallet[0];

    const tx = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::text AS count, SUM(amount)::text AS sum_amount, SUM(fee)::text AS sum_fee,
               SUM(CASE WHEN amount <> round(amount) THEN 1 ELSE 0 END)::text AS non_integer_amount,
               SUM(CASE WHEN fee <> round(fee) THEN 1 ELSE 0 END)::text AS non_integer_fee
        FROM "Transaction"
    `);
    out.Transaction = tx[0];

    const tables = [
        { name: 'Branch', cols: ['balance'] },
        { name: 'Vault', cols: ['balance'] },
        { name: 'TreasuryRequest', cols: ['amount'] },
        { name: 'RefundRequest', cols: ['amount'] },
        { name: 'TontineCycle', cols: ['totalExpected', 'totalCollected'] },
        { name: 'CashSession', cols: ['initialCash', 'finalCash', 'totalCashInValue', 'totalCashOutValue'] },
        { name: 'PayoutBulk', cols: ['totalAmount'] },
        { name: 'VirtualCard', cols: ['balance', 'spendingLimit'] },
        { name: 'Loan', cols: ['amount', 'totalOwed'] },
        { name: 'StakingVault', cols: ['amount'] },
        { name: 'BnplContract', cols: ['totalAmount', 'remaining'] },
    ];

    for (const t of tables) {
        const sums = t.cols.map(c => `SUM("${c}")::text AS sum_${c}`).join(', ');
        const nonint = t.cols.map(c => `SUM(CASE WHEN "${c}" <> round("${c}") THEN 1 ELSE 0 END)::text AS nonint_${c}`).join(', ');
        try {
            const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::text AS count, ${sums}, ${nonint} FROM "${t.name}"`);
            out[t.name] = rows[0];
        } catch (e) {
            out[t.name] = { error: e.message };
        }
    }

    console.log(JSON.stringify(out, null, 2));
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
