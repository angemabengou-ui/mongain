const axios = require('axios');
const API = 'http://localhost:3000';

async function run() {
  try {
     const { PrismaClient } = require('@prisma/client');
     const p = new PrismaClient();
     const bcrypt = require('bcryptjs');
     
     const fullPhone = '+24177777777';
     const hashedPin = await bcrypt.hash('1234', 10);
     let user = await p.user.findUnique({ where: { phone: fullPhone }});
     if (user) {
        await p.user.update({ where: { id: user.id }, data: { pin: hashedPin, failedPinAttempts: 0, lockedUntil: null }});
     } else {
        user = await p.user.create({ data: { name: 'TestE2E', phone: fullPhone, pin: hashedPin, wallet: {create:{}} }});
     }

     console.log('2. Requesting OTP...');
     const l = await axios.post(API + '/api/auth/login', { phone: fullPhone, pin: '1234' });
     console.log('Login res:', l.data);
     
     console.log('3. Submitting OTP...');
     const v = await axios.post(API + '/api/auth/verify-login-otp', { phone: fullPhone, otpCode: '1234' });
     const token = v.data.token;
     console.log('Token acquired:', token.substring(0,20) + '...');
     
     console.log('4. Calling /me...');
     const me = await axios.get(API + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token }});
     console.log('/me success! User ID:', me.data.id);

     console.log('5. Testing Wallet GET ...');
     const balance = await axios.get(API + '/api/wallet/balance', { headers: { Authorization: 'Bearer ' + token }});
     console.log('Balance:', balance.data);
     
     console.log('ALL PASSED!');
  } catch(e) {
     console.log('ERROR:', e.response?.status, e.response?.data || e.message);
  }
}
run();
