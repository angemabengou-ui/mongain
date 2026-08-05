import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity, useColorScheme, View
} from 'react-native';
import { useAppTheme } from '../constants/theme';
import { apiWithdraw } from '../services/api';

export default function WithdrawScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const COLORS = useAppTheme();
    const isDark = useColorScheme() === 'dark';
    const [agentPhone, setAgentPhone] = useState(params.agentPhone as string || '');
    const [amount, setAmount] = useState(params.amount as string || '');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ balance: number } | null>(null);

    const handleWithdraw = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!agentPhone) {
            setError('Veuillez entrer le numéro ou code de l\'Agent.');
            return;
        }
        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }
        if (!pin || pin.length !== 4) {
            setError('Veuillez entrer votre code PIN à 4 chiffres.');
            return;
        }

        setLoading(true);
        try {
            const result = await apiWithdraw(amountNum, pin, agentPhone);
            setSuccess({ balance: result.balance });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.successIconWrap, { backgroundColor: COLORS.success + '20' }]}>
                    <Ionicons name="checkmark-circle" size={90} color={COLORS.success} />
                </View>
                <Text style={[styles.successTitle, { color: COLORS.textPrimary }]}>Retrait autorisé !</Text>
                <Text style={[styles.successSubtitle, { color: COLORS.textSecondary }]}>
                    Vous pouvez maintenant retirer{'\n'}
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>
                        {parseFloat(amount).toLocaleString('fr-FR')} FCFA
                    </Text>
                    {'\n'}auprès de l'agent.
                </Text>
                <View style={[styles.remainingCard, { backgroundColor: COLORS.surface }]}>
                    <Text style={[styles.remainingLabel, { color: COLORS.textSecondary }]}>Nouveau solde</Text>
                    <Text style={[styles.remainingAmount, { color: COLORS.textPrimary }]}>{success.balance.toLocaleString('fr-FR')} FCFA</Text>
                </View>
                <TouchableOpacity style={[styles.doneBtn, { backgroundColor: COLORS.success }]} onPress={() => router.replace('/(tabs)' as any)}>
                    <Text style={styles.doneBtnText}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <View style={[styles.header, { backgroundColor: COLORS.background }]}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Faire un retrait</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    <TouchableOpacity
                        style={[styles.qrScanBtn, { backgroundColor: COLORS.primary }]}
                        onPress={() => router.push('/qr')}
                    >
                        <Ionicons name="qr-code-outline" size={24} color="#fff" style={{ marginRight: 10 }} />
                        <Text style={styles.actionBtnText}>Scanner le QR de l'Agent</Text>
                    </TouchableOpacity>

                    <View style={styles.divider}>
                        <View style={[styles.dividerLine, { backgroundColor: COLORS.border }]} />
                        <Text style={[styles.dividerText, { color: COLORS.textSecondary }]}>OU</Text>
                        <View style={[styles.dividerLine, { backgroundColor: COLORS.border }]} />
                    </View>

                    <View style={[styles.infoCard, { backgroundColor: COLORS.primary + '15' }]}>
                        <Ionicons name="wallet-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
                        <Text style={[styles.infoTitle, { color: COLORS.primary }]}>Retrait par Numéro/Code Agent</Text>
                        <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>Saisissez le code de l'Agent et le montant pour générer une autorisation.</Text>
                    </View>

                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={18} color="#EF4444" />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Numéro / Code Agent</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Ionicons name="storefront-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="Ex: +241..."
                            keyboardType="phone-pad"
                            value={agentPhone}
                            onChangeText={setAgentPhone}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Montant (FCFA)</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.currencyPrefix, { color: COLORS.textPrimary, borderRightColor: COLORS.border }]}>FCFA</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="0"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN secret</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="••••"
                            keyboardType="number-pad"
                            secureTextEntry={!showPin}
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                        <TouchableOpacity onPress={() => setShowPin(!showPin)} style={{ padding: 4 }}>
                            <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: COLORS.primary }]} onPress={handleWithdraw} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Confirmer le retrait manuel</Text>}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    content: { padding: 24 },
    qrScanBtn: {
        height: 56, borderRadius: 16, flexDirection: 'row',
        justifyContent: 'center', alignItems: 'center',
        shadowOpacity: 0.2, shadowRadius: 8, elevation: 4
    },
    divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 32 },
    dividerLine: { flex: 1, height: 1 },
    dividerText: { marginHorizontal: 16, fontSize: 14, fontWeight: '700' },
    infoCard: { padding: 20, borderRadius: 16, marginBottom: 24, alignItems: 'center' },
    infoTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
    infoText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
    errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
    errorText: { color: '#EF4444', fontSize: 14, flex: 1 },
    label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 16, borderWidth: 1 },
    currencyPrefix: { fontSize: 15, fontWeight: '700', marginRight: 12, borderRightWidth: 1, paddingRight: 12 },
    input: { flex: 1, fontSize: 18, fontWeight: '600', height: '100%' },
    actionBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowOpacity: 0.3, shadowRadius: 12, elevation: 6, marginTop: 10 },
    actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    successIconWrap: { marginBottom: 24, borderRadius: 50 },
    successTitle: { fontSize: 28, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
    successSubtitle: { fontSize: 17, textAlign: 'center', lineHeight: 26, marginBottom: 24 },
    remainingCard: { borderRadius: 20, paddingHorizontal: 32, paddingVertical: 20, alignItems: 'center', marginBottom: 32 },
    remainingLabel: { fontSize: 13, marginBottom: 6 },
    remainingAmount: { fontSize: 26, fontWeight: '800' },
    doneBtn: { paddingHorizontal: 48, paddingVertical: 16, borderRadius: 16 },
    doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
