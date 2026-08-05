import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
    TouchableOpacity,
    View,
} from 'react-native';
import { apiDeposit } from '../services/api';

const COLORS = {
    primary: '#059669', // Vert pour le dépôt
    surface: '#ffffff',
    background: '#f8f9fe',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    error: '#E11D48',
};

export default function DepositScreen() {
    const router = useRouter();
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ balance: number } | null>(null);

    const handleDeposit = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }

        setLoading(true);
        try {
            const result = await apiDeposit(amountNum);
            setSuccess({ balance: result.balance });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={styles.successIconWrap}>
                    <Ionicons name="checkmark-circle" size={90} color={COLORS.primary} />
                </View>
                <Text style={styles.successTitle}>Dépôt réussi !</Text>
                <Text style={styles.successSubtitle}>
                    Votre compte a été crédité de{'\n'}
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>
                        {parseFloat(amount).toLocaleString('fr-FR')} FCFA
                    </Text>
                </Text>
                <View style={styles.remainingCard}>
                    <Text style={styles.remainingLabel}>Nouveau solde</Text>
                    <Text style={styles.remainingAmount}>{success.balance.toLocaleString('fr-FR')} FCFA</Text>
                </View>
                <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)' as any)}>
                    <Text style={styles.doneBtnText}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Faire un dépôt</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.infoCard}>
                        <Ionicons name="cash-outline" size={32} color={COLORS.primary} style={{ marginBottom: 12 }} />
                        <Text style={styles.infoTitle}>Ajouter des fonds</Text>
                        <Text style={styles.infoText}>Ce montant sera ajouté à votre solde principal via votre agent ou carte bancaire.</Text>
                    </View>

                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={styles.label}>Montant (FCFA)</Text>
                    <View style={styles.inputContainer}>
                        <Text style={styles.currencyPrefix}>FCFA</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="0"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <View style={styles.amountShortcuts}>
                        {['1 000', '5 000', '10 000', '50 000'].map(v => (
                            <TouchableOpacity
                                key={v}
                                style={styles.shortcutPill}
                                onPress={() => setAmount(v.replace(/\s/g, ''))}
                            >
                                <Text style={styles.shortcutText}>+ {v}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TouchableOpacity style={styles.actionBtn} onPress={handleDeposit} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Confirmer le dépôt</Text>}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    content: { padding: 24 },
    infoCard: { backgroundColor: COLORS.primary + '15', padding: 20, borderRadius: 20, marginBottom: 24, alignItems: 'center' },
    infoTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 8 },
    infoText: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
    errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
    errorText: { color: COLORS.error, fontSize: 14, flex: 1 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
    currencyPrefix: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1', paddingRight: 12 },
    input: { flex: 1, fontSize: 18, color: COLORS.textPrimary, fontWeight: '600', height: '100%' },
    amountShortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
    shortcutPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: '#e2e8f0' },
    shortcutText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
    actionBtn: { backgroundColor: COLORS.primary, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    actionBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
    successIconWrap: { marginBottom: 24 },
    successTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 12, textAlign: 'center' },
    successSubtitle: { fontSize: 17, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 26, marginBottom: 24 },
    remainingCard: { backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 32, paddingVertical: 20, alignItems: 'center', marginBottom: 32, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
    remainingLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 },
    remainingAmount: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary },
    doneBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 48, paddingVertical: 16, borderRadius: 16, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
    doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
