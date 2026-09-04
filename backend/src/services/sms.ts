import twilio from 'twilio';

const SMS_ENABLED = process.env.SMS_ENABLED === 'true';
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

let client: twilio.Twilio | null = null;
if (SMS_ENABLED && accountSid && authToken) {
    client = twilio(accountSid, authToken);
}

// Source de vérité unique pour "un vrai SMS partira-t-il ?" — auth.ts et corp.ts décidaient
// chacun leur propre condition de mode démo (`!TWILIO_ACCOUNT_SID` seul), qui pouvait diverger
// de celle-ci : un `TWILIO_ACCOUNT_SID` posé dans l'environnement (config partielle, secret
// oublié) sans SMS_ENABLED=true ni TWILIO_AUTH_TOKEN désactivait leur mode démo (code aléatoire
// au lieu de 1234) alors qu'aucun SMS n'était réellement envoyé — le code réel n'atterrissait
// alors que dans les logs serveur (la branche "SMS SIMULATOR" ci-dessous), jamais visible pour
// qui teste depuis l'écran de connexion.
export const isSmsConfigured = !!(SMS_ENABLED && accountSid && authToken);

export const sendSms = async (to: string, body: string) => {
    if (!SMS_ENABLED || !client) {
        console.log('\n=============================================');
        console.log('📱 [SMS SIMULATOR - SMS_ENABLED=false]');
        console.log(`À: ${to}`);
        console.log(`Message:\n${body}`);
        console.log('=============================================\n');
        return true;
    }

    try {
        const message = await client.messages.create({
            body,
            from: twilioNumber,
            to,
        });
        console.log(`✅ [SMS SUCCESS] Sent to ${to}. SID: ${message.sid}`);
        return true;
    } catch (error: any) {
        console.error(`❌ [SMS ERROR] Failed to send to ${to}:`, error.message);
        throw error;
    }
};
