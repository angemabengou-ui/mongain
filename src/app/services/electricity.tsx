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
import { useAppTheme } from '../../constants/theme';
import { apiPayService } from '../../services/api';

export default function ElectricityServiceScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();
    const styles = getStyles(COLORS);
    const [amount, setAmount] = useState('');
    const [meter, setMeter] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ amount: number, token: string } | null>(null);

    const handlePay = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!meter || meter.replace(/\s/g, '').length < 11) {
            setError('Le numéro de compteur doit comporter au moins 11 chiffres.');
            return;
        }

        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }

        setLoading(true);
        try {
            const result = await apiPayService('ELECTRICITY', amountNum, meter);
            if (result.serviceToken) {
                setSuccess({ amount: amountNum, token: result.serviceToken });
            } else {
                throw new Error("Jeton non reçu.");
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.successIconWrap, { backgroundColor: '#10b981' + '15', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="flash" size={80} color="#10b981" />
                </View>
                <Text style={styles.successTitle}>Achat Validé !</Text>
                <Text style={styles.successSubtitle}>
                    Vous avez acheté de l'électricité pour {'\n'}
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>
                        {success.amount.toLocaleString('fr-FR')} FCFA
                    </Text>
                </Text>

                <View style={styles.tokenBox}>
                    <Text style={styles.tokenLabel}>Votre Code EDAN</Text>
                    <Text style={styles.tokenValue}>{success.token}</Text>
                    <Text style={{ textAlign: 'center', fontSize: 13, color: COLORS.textSecondary, marginTop: 12 }}>
                        Saisissez ce code sur votre compteur.
                    </Text>
                </View>

                <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)' as any)}>
                    <Text style={styles.doneBtnText}>Terminé</Text>
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
                    <Text style={styles.headerTitle}>Électricité (EDAN)</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    <View style={styles.heroCard}>
                        <Ionicons name="bulb-outline" size={40} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 }}>Achat d'Unités</Text>
                        <Text style={{ color: '#ecfdf5', fontSize: 13, textAlign: 'center', marginTop: 5 }}>Obtenez instantanément votre code EDAN après paiement.</Text>
                    </View>

                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={styles.label}>Numéro de Compteur</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="flash-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                        <TextInput
                            style={styles.input}
                            placeholder="012 345 678 91"
                            keyboardType="numeric"
                            value={meter}
                            onChangeText={setMeter}
                            placeholderTextColor={COLORS.textSecondary}
                            maxLength={14}
                        />
                    </View>

                    <Text style={styles.label}>Montant (FCFA)</Text>
                    <View style={styles.inputContainer}>
                        <Text style={styles.currencyPrefix}>FCFA</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Montant minimum: 1 000"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <TouchableOpacity style={styles.actionBtn} onPress={handlePay} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : (
                            <Text style={styles.actionBtnText}>
                                Payer {amount ? parseFloat(amount.replace(/\s/g, '').replace(',', '.')).toLocaleString('fr-FR') : '0'} FCFA
                            </Text>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    content: { padding: 24 },

    heroCard: {
        backgroundColor: '#10b981',
        padding: 24, borderRadius: 20, marginBottom: 24, alignItems: 'center',
        shadowColor: '#10b981', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 8
    },

    errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
    errorText: { color: COLORS.error, fontSize: 14, flex: 1 },
    label: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 6, marginLeft: 4 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 16, height: 56, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
    currencyPrefix: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1', paddingRight: 12 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, fontWeight: '600', height: '100%' },

    actionBtn: { backgroundColor: '#10b981', height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#10b981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    actionBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },

    successIconWrap: { marginBottom: 24 },
    successTitle: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8, textAlign: 'center' },
    successSubtitle: { fontSize: 16, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 32 },

    tokenBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', padding: 24, borderRadius: 16, marginBottom: 30, width: '100%' },
    tokenLabel: { fontSize: 14, color: '#dc2626', fontWeight: '700', textAlign: 'center', marginBottom: 10 },
    tokenValue: { fontSize: 24, fontWeight: '900', color: '#991b1b', textAlign: 'center', letterSpacing: 2 },

    doneBtn: { backgroundColor: COLORS.primary, width: '100%', height: 60, justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
    doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
