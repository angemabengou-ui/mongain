const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function run() {
  const u = await p.user.findUnique({ where: { phone: '+24162781878' }});
  console.log(u);
}
run();
