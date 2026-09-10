import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiStakeFunds } from '../services/api';

const MIN_AMOUNT = 10000;
// Mêmes paliers que backend/src/routes/invest.ts (apy = 0.08 si lockMonths >= 12, sinon 0.05)
// — dupliqué ici uniquement pour l'aperçu affiché à l'utilisateur avant confirmation ; le
// serveur reste seul décideur du taux réellement appliqué.
const DURATIONS = [3, 6, 12, 24, 36];

export default function InvestCreateScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [amountStr, setAmountStr] = useState('');
    const [lockMonths, setLockMonths] = useState(12);
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    // Garde synchrone (même pattern que vault-create.tsx/tontine-create.tsx) : /stake n'est
    // pas idempotent (chaque appel verrouille un nouveau montant) ; le seul état `loading`
    // React ne suffit pas contre un double-tap avant que son changement ne soit commité.
    const creatingRef = useRef(false);

    const amount = Math.round(parseFloat(amountStr.replace(/\s/g, '').replace(',', '.')) || 0);
    const apy = lockMonths >= 12 ? 0.08 : 0.05;
    const projectedInterest = amount > 0 ? Math.round(amount * apy * (lockMonths / 12)) : 0;

    const handleCreate = async () => {
        if (creatingRef.current) return;
        if (!amount || amount < MIN_AMOUNT) {
            Alert.alert('Montant invalide', `Le montant minimum est de ${MIN_AMOUNT.toLocaleString('fr-FR')} FCFA.`);
            return;
        }
        if (pin.length !== 4) {
            Alert.alert('Code PIN requis', 'Saisissez votre code PIN Mongain à 4 chiffres.');
            return;
        }
        creatingRef.current = true;
        setLoading(true);
        try {
            const res = await apiStakeFunds(amount, lockMonths, pin);
            Alert.alert('Coffre ouvert', res.message);
            router.back();
        } catch (e: any) {
            Alert.alert('Échec', e.response?.data?.error || e.message || "Impossible d'ouvrir ce coffre.");
        } finally {
            creatingRef.current = false;
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={26} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Nouveau coffre</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Montant à bloquer (FCFA)</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        placeholder={`Min. ${MIN_AMOUNT.toLocaleString('fr-FR')}`}
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="number-pad"
                        value={amountStr}
                        onChangeText={setAmountStr}
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Durée de blocage</Text>
                    <View style={styles.durationRow}>
                        {DURATIONS.map((m) => (
                            <TouchableOpacity
                                key={m}
                                style={[
                                    styles.durationPill,
                                    { borderColor: COLORS.border },
                                    lockMonths === m && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                                ]}
                                onPress={() => setLockMonths(m)}
                            >
                                <Text style={[styles.durationText, { color: lockMonths === m ? '#fff' : COLORS.textPrimary }]}>
                                    {m} mois
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {amount > 0 && (
                        <View style={[styles.previewBox, { backgroundColor: COLORS.primary + '10' }]}>
                            <View style={styles.previewRow}>
                                <Text style={[styles.previewLabel, { color: COLORS.textSecondary }]}>Taux</Text>
                                <Text style={[styles.previewValue, { color: COLORS.textPrimary }]}>{(apy * 100).toFixed(0)}% / an</Text>
                            </View>
                            <View style={styles.previewRow}>
                                <Text style={[styles.previewLabel, { color: COLORS.textSecondary }]}>Intérêts estimés</Text>
                                <Text style={[styles.previewValue, { color: '#10B981' }]}>+{projectedInterest.toLocaleString('fr-FR')} FCFA</Text>
                            </View>
                            <View style={[styles.previewDivider, { backgroundColor: COLORS.border }]} />
                            <View style={styles.previewRow}>
                                <Text style={[styles.previewLabelBold, { color: COLORS.textPrimary }]}>Total à échéance</Text>
                                <Text style={[styles.previewValueBold, { color: COLORS.textPrimary }]}>
                                    {(amount + projectedInterest).toLocaleString('fr-FR')} FCFA
                                </Text>
                            </View>
                        </View>
                    )}

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN Mongain</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border, textAlign: 'center', letterSpacing: 10, fontSize: 22 }]}
                        placeholder="⬢⬢⬢⬢"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="number-pad"
                        secureTextEntry
                        maxLength={4}
                        value={pin}
                        onChangeText={setPin}
                    />

                    <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '10' }]}>
                        <Ionicons name="information-circle" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                        <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>
                            Vos fonds restent bloqués jusqu'à l'échéance choisie — aucun retrait anticipé n'est possible.
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: COLORS.primary }, (!amount || amount < MIN_AMOUNT || pin.length !== 4 || loading) && styles.submitBtnDisabled]}
                        onPress={handleCreate}
                        disabled={!amount || amount < MIN_AMOUNT || pin.length !== 4 || loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Ouvrir le coffre</Text>}
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: '#fff' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 24, paddingBottom: 60 },

    label: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginBottom: 8, marginTop: 18 },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 54, fontSize: 15 },

    durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    durationPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5 },
    durationText: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },

    previewBox: { borderRadius: 16, padding: 16, marginTop: 20 },
    previewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    previewLabel: { fontSize: 13 },
    previewValue: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    previewDivider: { height: 1, marginVertical: 8 },
    previewLabelBold: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    previewValueBold: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },

    infoBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 14, padding: 14, marginTop: 24 },
    infoText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

    submitBtn: { marginTop: 32, paddingVertical: 17, borderRadius: 16, alignItems: 'center' },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});
