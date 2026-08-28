const jwt = require('jsonwebtoken');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const user = await prisma.user.findFirst();
  if(!user) { console.log('No user'); return; }
  const JWT_SECRET = process.env.JWT_SECRET;
  console.log('Using secret:', JWT_SECRET);
  console.log('User DB jwtVersion:', user.jwtVersion);
  
  const token = jwt.sign({ userId: user.id, jwtVersion: user.jwtVersion }, JWT_SECRET, { expiresIn: '30m' });
  console.log('Token created.');
  
  try {
     const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
     console.log('Decoded:', decoded);
     
     const check = await prisma.user.findUnique({ where: { id: decoded.userId }});
     if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== check.jwtVersion) {
         console.log('MISMATCH! Decoded:', decoded.jwtVersion, 'DB:', check.jwtVersion);
     } else {
         console.log('MATCH PERFECTLY!');
     }
  } catch(e) {
     console.log('VERIFY ERROR:', e.message);
  }
}
run().catch(console.error);
