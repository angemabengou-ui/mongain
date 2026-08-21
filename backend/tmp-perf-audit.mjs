import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const BASE = 'http://localhost:3000';
const pin = '1234';
let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`PASS - ${label}`); }
  else { fail++; console.log(`FAIL - ${label} :: ${detail}`); }
}
async function j(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const P1 = '+24170000099', P2 = '+24170000098';
const STAFF_EMAIL = 'audit-perf-tmp@mongain.internal';

async function wipeUser(phone) {
  const u = await prisma.user.findUnique({ where: { phone } });
  if (!u) return;
  const w = await prisma.wallet.findUnique({ where: { userId: u.id } });
  if (w) await prisma.transaction.deleteMany({ where: { OR: [{ senderWalletId: w.id }, { receiverWalletId: w.id }] } });
  await prisma.notification.deleteMany({ where: { userId: u.id } });
  await prisma.wallet.deleteMany({ where: { userId: u.id } });
  await prisma.user.delete({ where: { id: u.id } });
}
async function cleanup() {
  const staff = await prisma.staff.findUnique({ where: { email: STAFF_EMAIL } });
  if (staff) await prisma.staff.delete({ where: { id: staff.id } }).catch(() => {});
  for (const p of [P1, P2]) await wipeUser(p);
}
async function register(phone, name, username) {
  await j('POST', '/api/auth/request-otp', { phone });
  const reg = await j('POST', '/api/auth/register', { name, username, phone, pin, otpCode: '1234' });
  return { token: reg.data?.token, user: await prisma.user.findUnique({ where: { phone } }) };
}

async function run() {
  await cleanup();
  const a = await register(P1, 'Client Perf A', 'clientperfa99');
  const b = await register(P2, 'Client Perf B', 'clientperfb98');
  await prisma.wallet.update({ where: { userId: a.user.id }, data: { balance: 100000 } });

  // 1. Balance + limits (authMiddleware + /limits select fix)
  const bal = await j('GET', '/api/wallet/balance', undefined, a.token);
  check('GET /balance fonctionne après le select scopé sur authMiddleware', bal.status === 200 && bal.data.balance === 100000, JSON.stringify(bal.data));

  const limits = await j('GET', '/api/wallet/limits', undefined, a.token);
  check('GET /limits renvoie les bons champs après select scopé', limits.status === 200 && typeof limits.data.dailyLimit === 'number' && limits.data.kycStatus !== undefined, JSON.stringify(limits.data));

  // 2. Transfer + GET /transactions (select scopé sur user)
  const transfer = await j('POST', '/api/wallet/transfer', { receiverPhone: P2, amount: 5000, pin }, a.token);
  check('transfert réussi', transfer.status === 200, JSON.stringify(transfer.data));

  const txs = await j('GET', '/api/wallet/transactions', undefined, a.token);
  check('GET /transactions renvoie bien nom/téléphone du destinataire après select scopé', txs.status === 200 && Array.isArray(txs.data) && txs.data.length > 0 && txs.data[0].counterpart, JSON.stringify(txs.data?.[0]));
  check('aucune fuite de champ KYC dans la réponse (pas de idCardFront/selfie)', !JSON.stringify(txs.data).includes('idCardFront'), '');

  // 3. Admin dashboard /stats (company select fix + fundTxs select fix)
  const hq = await prisma.branch.findFirst({ where: { isHQ: true } });
  const staffPassword = 'AuditPerf123!';
  await prisma.staff.create({ data: { email: STAFF_EMAIL, password: await bcrypt.hash(staffPassword, 10), name: 'Audit Perf', role: 'SUPER_ADMIN', status: 'ACTIVE', isActive: true, branchId: hq?.id } });
  const login = await j('POST', '/api/corp/login', { email: STAFF_EMAIL, password: staffPassword });
  const staffToken = login.data.token;

  const stats = await j('GET', '/api/admin/stats', undefined, staffToken);
  check('GET /admin/stats fonctionne après suppression du code mort + select scopé', stats.status === 200 && typeof stats.data.revenue === 'number', JSON.stringify(stats.data));

  console.log(`\n=== RESULTAT : ${pass} reussis, ${fail} echoues ===`);
  await cleanup();
  console.log('nettoye');
}
run().catch(e => console.error('SCRIPT ERROR', e)).finally(() => prisma.$disconnect());
