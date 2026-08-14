const BASE_URL = 'http://localhost:3000';

async function req(method: string, path: string, body?: any, token?: string) {
    const headers: any = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    const data = await res.json();
    if (!res.ok) {
        throw new Error(`[${method} ${path}] Failed: ${data.error || JSON.stringify(data)}\nStatus: ${res.status}`);
    }
    return data;
}

const randomId = Math.floor(Math.random() * 90000 + 10000); // 5 digits

async function runTests() {
    console.log("🚀 Lancement des tests avec id aléatoire: " + randomId);

    try {
        const phone1 = `+24190${randomId}1`, pin1 = '1111';
        console.log("👉 Création de", phone1);
        const r1 = await req('POST', '/api/auth/register', { name: 'Test Client', phone: phone1, pin: pin1 });
        const t1 = r1.token;

        const adminLogin = await req('POST', '/api/auth/login', { phone: '+24100000000', pin: '0000' });
        const adminToken = adminLogin.token;

        const agentPhone = `+24190${randomId}2`, agentPin = '2222';
        console.log("👉 Création Agent", agentPhone);
        await req('POST', '/api/admin/users/create-pro', { phone: agentPhone, name: 'Test Agent', role: 'AGENT', pin: agentPin }, adminToken);
        const agentLogin = await req('POST', '/api/auth/login', { phone: agentPhone, pin: agentPin });
        const agentToken = agentLogin.token;

        console.log("👉 Mint de 50000 FCFA sur l'Agent");
        await req('POST', '/api/admin/mint', { phone: agentPhone, amount: 50000 }, adminToken);

        console.log("👉 Dépôt de 10000 FCFA Agent -> Client");
        await req('POST', '/api/wallet/deposit', { phone: phone1, amount: 10000 }, agentToken);

        let clientBal1 = await req('GET', '/api/wallet/balance', null, t1);
        if (clientBal1.balance < 10000) throw new Error("Solde incorrect après dépôt.");

        const phone3 = `+24190${randomId}3`, pin3 = '3333';
        console.log("👉 Création test client 2: ", phone3);
        const r3 = await req('POST', '/api/auth/register', { name: 'Test Bob', phone: phone3, pin: pin3 });
        const t3 = r3.token;

        console.log("👉 Transfert Client 1 -> Bob (5000 FCFA)");
        await req('POST', '/api/wallet/transfer', { receiverPhone: phone3, amount: 5000, pin: pin1 }, t1);

        console.log("👉 Retrait Bob chez Agent (2000 FCFA)");
        await req('POST', '/api/wallet/withdraw', { agentPhone: agentPhone, amount: 2000, pin: pin3 }, t3);

        const bobBal = await req('GET', '/api/wallet/balance', null, t3);
        const stats = await req('GET', '/api/admin/stats', null, adminToken);
        console.log(`✅ Stats Admin: Users=${stats.totalUsers}, Revenue (Corporate)=${stats.revenue}, Circulant=${stats.totalCirculating}`);

        console.log("🎉 TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS 🎉");

    } catch (e: any) {
        console.error("❌ ERREUR:", e.message);
        process.exit(1);
    }
}

runTests();
