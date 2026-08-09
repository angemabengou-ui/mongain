import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { apiTopUp } from '../services/api';

const COLORS = {
    primary: '#0f172a',
    surface: '#ffffff',
    background: '#f8f9fe',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    error: '#E11D48',
    airtel: '#E30613', // Rouge Airtel
    moov: '#005CB9',   // Bleu Moov
};

type Method = 'CARD' | 'AIRTEL' | 'MOOV';

export default function DepositScreen() {
    const router = useRouter();

    // Sélection de méthode
    const [method, setMethod] = useState<Method>('AIRTEL');

    // Airtel/Moov Mobile Money
    const [phoneMobile, setPhoneMobile] = useState('');
    const [amount, setAmount] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ balance: number } | null>(null);

    const handleComingSoon = () => {
        Alert.alert(
            "⏳ Fonctionnalité en développement",
            "Cette opération ne peut pas encore être effectuée. Nous travaillons activement pour la rendre disponible très bientôt !"
        );
    };

    const handleDeposit = async () => {
        if (method === 'CARD') {
            handleComingSoon();
            return;
        }

        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }

        const phone = phoneMobile.replace(/\s/g, '');
        if (phone.length < 8) {
            setError('Veuillez entrer un numéro de téléphone valide (ex: 074 000 000 ou 066 000 000).');
            return;
        }

        setLoading(true);
        try {
            // Note: En mode prototype, apiTopUp s'attend juste à un montant et un token
            const token = method === 'AIRTEL' ? 'tok_airtel' : 'tok_moov';
            const result = await apiTopUp(amountNum, token);
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
                <View style={[styles.successIconWrap, { backgroundColor: '#10b981' + '15', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="phone-portrait" size={80} color="#10b981" />
                </View>
                <Text style={styles.successTitle}>Paiement Confirmé !</Text>
                <Text style={styles.successSubtitle}>
                    Votre compte Mongain a été crédité de{'\n'}
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>
                        {parseFloat(amount).toLocaleString('fr-FR')} FCFA
                    </Text>
                </Text>
                <View style={styles.remainingCard}>
                    <Text style={styles.remainingLabel}>Nouveau solde</Text>
                    <Text style={styles.remainingAmount}>{success.balance.toLocaleString('fr-FR')} FCFA</Text>
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
                    <Text style={styles.headerTitle}>Recharger mon compte</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    {/* Sélecteur de méthode */}
                    <Text style={[styles.label, { fontSize: 15, marginBottom: 12 }]}>Choisir une méthode</Text>

                    {/* Method Row 1: Airtel & Moov */}
                    <View style={styles.methodRow}>
                        <TouchableOpacity
                            style={[styles.methodCard, method === 'AIRTEL' && styles.methodCardAirtel]}
                            onPress={() => setMethod('AIRTEL')}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="phone-portrait" size={28} color={method === 'AIRTEL' ? '#fff' : COLORS.airtel} />
                            <Text style={[styles.methodLabel, method === 'AIRTEL' && { color: '#fff' }, { color: method === 'AIRTEL' ? '#fff' : COLORS.airtel }]}>Airtel</Text>
                            <Text style={[styles.methodSub, method === 'AIRTEL' && { color: 'rgba(255,255,255,0.8)' }]}>Money</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.methodCard, method === 'MOOV' && styles.methodCardMoov]}
                            onPress={() => setMethod('MOOV')}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="phone-portrait" size={28} color={method === 'MOOV' ? '#fff' : COLORS.moov} />
                            <Text style={[styles.methodLabel, method === 'MOOV' && { color: '#fff' }, { color: method === 'MOOV' ? '#fff' : COLORS.moov }]}>Moov</Text>
                            <Text style={[styles.methodSub, method === 'MOOV' && { color: 'rgba(255,255,255,0.8)' }]}>Africa</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Method Row 2: Carte Bancaire (Désactivée) */}
                    <TouchableOpacity
                        style={[styles.methodCard, { flexDirection: 'row', alignItems: 'center', marginBottom: 28, padding: 12, opacity: 0.7 }]}
                        onPress={() => setMethod('CARD')}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="card" size={28} color={COLORS.textPrimary} style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.methodLabel}>Carte Bancaire (Bientôt)</Text>
                            <Text style={styles.methodSub}>Visa / Mastercard</Text>
                        </View>
                        {method === 'CARD' && <Ionicons name="checkmark-circle" size={24} color={COLORS.primary} />}
                    </TouchableOpacity>

                    {/* ─────────────── CARTE BANCAIRE (EN DEV) ─────────────── */}
                    {method === 'CARD' && (
                        <View style={{ alignItems: 'center', padding: 20 }}>
                            <Ionicons name="construct-outline" size={60} color="#f59e0b" />
                            <Text style={{ fontSize: 18, fontWeight: '700', marginTop: 12, color: COLORS.textPrimary }}>Bientôt disponible !</Text>
                            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                                Les paiements par carte bancaire sont en cours d'intégration. L'opération ne peut pas encore être effectuée.
                            </Text>
                            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#f1f5f9', marginTop: 24, width: '100%' }]} onPress={handleComingSoon}>
                                <Text style={[styles.actionBtnText, { color: COLORS.textSecondary }]}>Option Indisponible</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* ─────────────── AIRTEL/MOOV MONEY ─────────────── */}
                    {(method === 'AIRTEL' || method === 'MOOV') && (
                        <>
                            <View style={[styles.airtelBanner, method === 'MOOV' && { borderColor: COLORS.moov + '40', shadowColor: COLORS.moov }]}>
                                <Ionicons name="phone-portrait" size={50} color={method === 'AIRTEL' ? COLORS.airtel : COLORS.moov} />
                                <View style={{ flex: 1, marginLeft: 16 }}>
                                    <Text style={{ fontWeight: '800', fontSize: 16, color: method === 'AIRTEL' ? COLORS.airtel : COLORS.moov }}>
                                        {method === 'AIRTEL' ? 'Airtel Money' : 'Moov Africa Money'}
                                    </Text>
                                    <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 }}>
                                        Un SMS de confirmation (USSD) sera envoyé à votre numéro pour autoriser le débit.
                                    </Text>
                                </View>
                            </View>

                            {error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={COLORS.error} /><Text style={styles.errorText}>{error}</Text></View> : null}

                            <Text style={styles.label}>Montant à recharger (FCFA)</Text>
                            <View style={styles.inputContainer}>
                                <Text style={styles.currencyPrefix}>FCFA</Text>
                                <TextInput style={styles.input} placeholder="Ex: 5000" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholderTextColor={COLORS.textSecondary} />
                            </View>

                            <Text style={styles.label}>Numéro de Téléphone ({method === 'AIRTEL' ? 'Airtel' : 'Moov'})</Text>
                            <View style={[styles.inputContainer, { borderColor: (method === 'AIRTEL' ? COLORS.airtel : COLORS.moov) + '80' }]}>
                                <Ionicons name="call-outline" size={20} color={method === 'AIRTEL' ? COLORS.airtel : COLORS.moov} style={{ marginRight: 10 }} />
                                <TextInput
                                    style={styles.input}
                                    placeholder={method === 'AIRTEL' ? '074 000 000' : '066 000 000'}
                                    keyboardType="phone-pad"
                                    value={phoneMobile}
                                    onChangeText={setPhoneMobile}
                                    placeholderTextColor={COLORS.textSecondary}
                                />
                            </View>

                            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                                <Ionicons name="information-circle-outline" size={18} color="#D97706" />
                                <Text style={{ fontSize: 12, color: '#92400E', flex: 1, lineHeight: 18 }}>
                                    Assurez-vous que votre compte Mobile Money {method} est actif et dispose d'un solde suffisant.
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.actionBtn, { backgroundColor: method === 'AIRTEL' ? COLORS.airtel : COLORS.moov }]}
                                onPress={handleDeposit}
                                disabled={loading}
                            >
                                {loading ? <ActivityIndicator color="#fff" /> : (
                                    <Text style={styles.actionBtnText}>
                                        📲 Recharger {amount ? parseFloat(amount.replace(/\s/g, '').replace(',', '.')).toLocaleString('fr-FR') : '0'} FCFA
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </>
                    )}
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

    // Method selector
    methodRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    methodCard: {
        flex: 1, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
        alignItems: 'center', borderWidth: 2, borderColor: '#e2e8f0',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
    },
    methodCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    methodCardAirtel: { backgroundColor: COLORS.airtel, borderColor: COLORS.airtel },
    methodCardMoov: { backgroundColor: COLORS.moov, borderColor: COLORS.moov },
    methodLabel: { fontWeight: '700', fontSize: 14, color: COLORS.textPrimary, marginTop: 8 },
    methodSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 3 },

    airtelBanner: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
        borderRadius: 16, padding: 20, marginBottom: 24,
        borderWidth: 2, borderColor: COLORS.airtel + '40',
        shadowColor: COLORS.airtel, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 3,
    },

    errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
    errorText: { color: COLORS.error, fontSize: 14, flex: 1 },
    label: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 6, marginLeft: 4 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, paddingHorizontal: 16, height: 56, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
    currencyPrefix: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1', paddingRight: 12 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, fontWeight: '600', height: '100%' },

    actionBtn: { height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#10b981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    actionBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },

    successIconWrap: { marginBottom: 24 },
    successTitle: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8, textAlign: 'center' },
    successSubtitle: { fontSize: 16, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 24, marginBottom: 32 },
    remainingCard: { backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 32, paddingVertical: 20, alignItems: 'center', marginBottom: 40, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, borderWidth: 1, borderColor: '#f1f5f9' },
    remainingLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6, fontWeight: '600' },
    remainingAmount: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary },
    doneBtn: { backgroundColor: COLORS.primary, width: '100%', height: 60, justifyContent: 'center', alignItems: 'center', borderRadius: 16 },
    doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});

