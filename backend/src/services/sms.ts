import twilio from 'twilio';

const SMS_ENABLED = process.env.SMS_ENABLED === 'true';
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

let client: twilio.Twilio | null = null;
if (SMS_ENABLED && accountSid && authToken) {
    client = twilio(accountSid, authToken);
}

export const sendSms = async (to: string, body: string) => {
    if (!SMS_ENABLED || !client) {
        // En production, un SMS qui "réussit" silencieusement sans jamais être livré est
        // pire qu'une erreur visible : le code OTP correspondant reste un secret que
        // personne n'a jamais reçu — inutilisable, mais son échec doit être su, pas caché.
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Service SMS non configuré.');
        }
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
