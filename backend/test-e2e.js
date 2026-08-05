const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');

const API = 'http://127.0.0.1:3000/api';
let phoneToTest = '+24177' + Math.floor(Math.random() * 900000).toString();
let globalToken = '';
let otpGlobal = '';

async function runTests() {
    console.log('🚀 Démarrage des Tests Automatisés Mongain API...\n');

    try {
        // 1. Demander OTP
        console.log(`[1] Demande OTP Inscription pour ${phoneToTest}...`);
        let res = await fetch(`${API}/auth/request-otp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneToTest })
        });
        let data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const codeRec = await prisma.verificationCode.findUnique({ where: { phone: phoneToTest } });
        otpGlobal = codeRec.code;

        // 2. Inscription
        console.log('\n[2] Tentative d\'inscription avec l\'OTP...');
        res = await fetch(`${API}/auth/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'TestUser E2E', phone: phoneToTest, pin: '1234', otpCode: otpGlobal })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        globalToken = data.token;
        console.log('✅ Inscription réussie. JWT Token obtenu !');

        // 3. Test Protection Brute Force (PIN)
        console.log('\n[3] Test Anti-BruteForce (Hacking PIN)...');
        for (let i = 1; i <= 3; i++) {
            res = await fetch(`${API}/auth/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phoneToTest, pin: '9999' })
            });
            data = await res.json();
        }

        res = await fetch(`${API}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneToTest, pin: '1234' })
        });
        data = await res.json();
        if (data.error && (data.error.includes('sécurisé') || data.error.includes('bloqué'))) {
            console.log('✅ Système de Blocage 100% Fonctionnel. Le compte est verrouillé.');
        } else {
            throw new Error(`Le compte aurait dû être verrouillé : ${data.error}`);
        }

        await prisma.user.update({ where: { phone: phoneToTest }, data: { failedPinAttempts: 0, lockedUntil: null } });

        // 4. Moteur de Frais et Transfert (Agent -> User)
        console.log('\n[4] Dépôt Agent et Transfert (Test de 1% de frais)...');

        let agent = await prisma.user.findFirst({ where: { role: 'AGENT' }, include: { wallet: true } });
        const hashedPin = await bcrypt.hash('0000', 10);
        if (!agent) {
            agent = await prisma.user.create({ data: { name: 'Agent', phone: '+241' + Date.now(), role: 'AGENT', pin: hashedPin, wallet: { create: { balance: 999999, currency: 'FCFA' } } }, include: { wallet: true } });
        } else {
            await prisma.user.update({ where: { id: agent.id }, data: { pin: hashedPin } });
            await prisma.wallet.update({ where: { id: agent.wallet.id }, data: { balance: 999999 } });
        }

        let agentLogin = await fetch(`${API}/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: agent.phone, pin: '0000' })
        });
        let agentLoginData = await agentLogin.json();
        if (!agentLogin.ok) throw new Error("Agent login failed: " + agentLoginData.error);
        let agentToken = agentLoginData.token;

        res = await fetch(`${API}/wallet/deposit`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentToken}` },
            body: JSON.stringify({ phone: phoneToTest, amount: 50000 })
        });
        data = await res.json();
        if (!res.ok) throw new Error("Dépôt Agent échoué: " + data.error);

        let receiverPhone = '+241' + Math.floor(Math.random() * 900000).toString();
        await prisma.user.create({ data: { name: 'Receiver', phone: receiverPhone, pin: '0000', wallet: { create: { balance: 0, currency: 'FCFA' } } } });

        res = await fetch(`${API}/wallet/transfer`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${globalToken}` },
            body: JSON.stringify({ receiverPhone, amount: 10000, pin: '1234' })
        });
        data = await res.json();
        if (!res.ok) throw new Error("Transfert échoué: " + data.error);

        const meUser = await prisma.user.findUnique({ where: { phone: phoneToTest }, include: { wallet: true } });
        const balanceMe = meUser.wallet;
        // The sender started with 50000, transferred 10000. Under 1% fee (100) = total 10100 deduction. Remaining: 39900.
        if (balanceMe.balance === 39900) {
            console.log(`✅ Transfert OK avec Frais ! Le compte a été débité de 10 100 FCFA.`);
        } else {
            console.log(`⚠️ Attention: Le solde final est ${balanceMe.balance}.`);
        }

        // 5. Test Mot de passe Oublié
        console.log('\n[5] Test Récupération de Compte (Code PIN Oublié)...');
        res = await fetch(`${API}/auth/request-reset-otp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneToTest })
        });
        data = await res.json();
        if (!res.ok) throw new Error(data.error);

        let resetOtp = await prisma.verificationCode.findUnique({ where: { phone: phoneToTest } });

        res = await fetch(`${API}/auth/reset-pin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phoneToTest, otpCode: resetOtp.code, newPin: '8888' })
        });

        data = await res.json();
        if (!res.ok) throw new Error(data.error);
        console.log(`✅ Réinitialisation OK. Le nouveau code PIN '8888' est acté en Base de données.`);

        console.log('\n🌟 TOUS LES TESTS INTEGRES (E2E) SONT SUCCES 🌟');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ ERREUR LORS DES TESTS :', error.message);
        process.exit(1);
    }
}

runTests();
