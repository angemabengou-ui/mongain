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
