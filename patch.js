const fs = require('fs');
const files = [
    'src/app/withdraw.tsx',
    'src/app/transfer.tsx',
    'src/app/transfer-confirm.tsx',
    'src/app/support.tsx',
    'src/app/services/tv.tsx',
    'src/app/services/seeg.tsx',
    'src/app/services/electricity.tsx',
    'src/app/services/airtime.tsx',
    'src/app/recharge.tsx',
    'src/app/recharge-form.tsx',
    'src/app/receive-qr.tsx',
    'src/app/receipt.tsx',
    'src/app/qr.tsx',
    'src/app/profile-edit.tsx',
    'src/app/pin-change.tsx',
    'src/app/pay.tsx',
    'src/app/notifications.tsx',
    'src/app/client-withdraw-desk.tsx',
    'src/app/auth/reset-pin.tsx',
    'src/app/auth/forgot-pin.tsx',
    'src/app/agent-action.tsx',
    'src/app/(tabs)/history.tsx'
];

let totalPatched = 0;
files.forEach(f => {
    let p = 'd:/Users/om0886/Desktop/mongain/' + f;
    if (!fs.existsSync(p)) return;
    let text = fs.readFileSync(p, 'utf8');

    // Skip if already patched
    if (text.includes("import { SafeAreaView } from 'react-native-safe-area-context'")) return;

    // Add import block
    text = text.replace(/(from\s+['"]react-native['"];?)/, "$1\nimport { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';");

    // Remove native SafeAreaView
    text = text.replace(/\bSafeAreaView\s*,\s*/g, '');
    text = text.replace(/,\s*SafeAreaView\b/g, '');
    text = text.replace(/{\s*SafeAreaView\s*}/g, '{}');

    fs.writeFileSync(p, text);
    console.log('Patched: ' + f);
    totalPatched++;
});
console.log('Total patched:', totalPatched);
