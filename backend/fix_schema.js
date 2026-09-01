const fs = require('fs');
let content = fs.readFileSync('prisma/schema.prisma', 'utf8');

// Add cryptoWallets to User
const userMatch = content.match(/model User \{[\s\S]*?\}/);
if (userMatch) {
    let userStr = userMatch[0];
    if (!userStr.includes('cryptoWallets')) {
        userStr = userStr.replace('}', '  cryptoWallets              CryptoWallet[]\n}');
        content = content.replace(userMatch[0], userStr);
    }
}

// Add models to the end
if (!content.includes('model CryptoWallet')) {
    content += `\nmodel CryptoWallet {\n  id              String      @id @default(uuid())\n  userId          String\n  user            User        @relation(fields: [userId], references: [id])\n  asset           String      // "BTC", "ETH", "USDT"\n  balance         Float       @default(0)\n  createdAt       DateTime    @default(now())\n  updatedAt       DateTime    @updatedAt\n}\n\nmodel CryptoTransaction {\n  id              String      @id @default(uuid())\n  userId          String\n  type            String      // "BUY", "SELL"\n  asset           String      // e.g "BTC"\n  amountCrypto    Float       \n  amountFiat      Float       // XAF equivalent\n  exchangeRate    Float\n  fee             Float\n  createdAt       DateTime    @default(now())\n}\n`;
}

fs.writeFileSync('prisma/schema.prisma', content);
console.log('Schema updated natively');
