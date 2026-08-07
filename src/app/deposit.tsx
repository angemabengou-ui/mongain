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
};

type Method = 'CARD' | 'AIRTEL';

export default function DepositScreen() {
    const router = useRouter();

    // Sélection de méthode
    const [method, setMethod] = useState<Method>('CARD');

    // Carte bancaire
    const [amount, setAmount] = useState('');
    const [cardNumber, setCardNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [cvc, setCvc] = useState('');

    // Airtel Money
    const [airtelPhone, setAirtelPhone] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ balance: number } | null>(null);

    const handleFormatCard = (text: string) => {
        const cleaned = text.replace(/\D/g, '');
        let formatted = '';
        for (let i = 0; i < cleaned.length; i++) {
            if (i > 0 && i % 4 === 0) formatted += ' ';
            formatted += cleaned[i];
        }
        setCardNumber(formatted.slice(0, 19));
    };

    const handleFormatExpiry = (text: string) => {
        const cleaned = text.replace(/\D/g, '');
        if (cleaned.length >= 2) {
            setExpiry(`${cleaned.slice(0, 2)}/${cleaned.slice(2, 4)}`);
        } else {
            setExpiry(cleaned);
        }
    };

    const handleDeposit = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }

        if (method === 'CARD') {
            if (cardNumber.length < 19 || expiry.length < 5 || cvc.length < 3) {
                setError('Veuillez remplir correctement les informations de votre carte.');
                return;
            }
        }

        if (method === 'AIRTEL') {
            const phone = airtelPhone.replace(/\s/g, '');
            if (phone.length < 8) {
                setError('Veuillez entrer un numéro Airtel valide (ex: 074 000 000).');
                return;
            }
        }

        setLoading(true);
        try {
            const result = await apiTopUp(amountNum, method === 'CARD' ? 'tok_visa' : 'tok_airtel');
            setSuccess({ balance: result.balance });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        const iconName = method === 'AIRTEL' ? 'phone-portrait' : 'card';
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.successIconWrap, { backgroundColor: '#10b981' + '15', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name={iconName} size={80} color="#10b981" />
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
                    <View style={styles.methodRow}>
                        <TouchableOpacity
                            style={[styles.methodCard, method === 'CARD' && styles.methodCardActive]}
                            onPress={() => setMethod('CARD')}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="card" size={28} color={method === 'CARD' ? '#fff' : COLORS.textPrimary} />
                            <Text style={[styles.methodLabel, method === 'CARD' && { color: '#fff' }]}>Carte Bancaire</Text>
                            <Text style={[styles.methodSub, method === 'CARD' && { color: 'rgba(255,255,255,0.8)' }]}>Visa / Mastercard</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.methodCard, method === 'AIRTEL' && styles.methodCardAirtel]}
                            onPress={() => setMethod('AIRTEL')}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="phone-portrait" size={28} color={method === 'AIRTEL' ? '#fff' : COLORS.airtel} />
                            <Text style={[styles.methodLabel, method === 'AIRTEL' && { color: '#fff' }, { color: method === 'AIRTEL' ? '#fff' : COLORS.airtel }]}>Airtel Money</Text>
                            <Text style={[styles.methodSub, method === 'AIRTEL' && { color: 'rgba(255,255,255,0.8)' }]}>Mobile Money</Text>
                        </TouchableOpacity>
                    </View>

                    {/* ─────────────── CARTE BANCAIRE ─────────────── */}
                    {method === 'CARD' && (
                        <>
                            {/* Visual Card */}
                            <View style={styles.cardPreview}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                    <Ionicons name="hardware-chip" size={36} color="#d4d4d8" />
                                    <Ionicons name="logo-venmo" size={28} color="#fff" />
                                </View>
                                <Text style={{ color: '#fff', fontSize: 20, letterSpacing: 2, fontFamily: 'monospace', marginBottom: 15 }}>
                                    {cardNumber || '**** **** **** ****'}
                                </Text>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                    <View>
                                        <Text style={{ color: '#94a3b8', fontSize: 10 }}>TITULAIRE</Text>
                                        <Text style={{ color: '#fff', fontSize: 14 }}>Mongain Utilisateur</Text>
                                    </View>
                                    <View>
                                        <Text style={{ color: '#94a3b8', fontSize: 10 }}>EXPIRATION</Text>
                                        <Text style={{ color: '#fff', fontSize: 14 }}>{expiry || 'MM/AA'}</Text>
                                    </View>
                                </View>
                            </View>

                            {error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={COLORS.error} /><Text style={styles.errorText}>{error}</Text></View> : null}

                            <Text style={styles.label}>Montant à recharger (FCFA)</Text>
                            <View style={styles.inputContainer}>
                                <Text style={styles.currencyPrefix}>FCFA</Text>
                                <TextInput style={styles.input} placeholder="Ex: 5000" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholderTextColor={COLORS.textSecondary} />
                            </View>

                            <Text style={styles.label}>Numéro de carte</Text>
                            <View style={styles.inputContainer}>
                                <Ionicons name="card-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                                <TextInput style={styles.input} placeholder="0000 0000 0000 0000" keyboardType="numeric" value={cardNumber} onChangeText={handleFormatCard} placeholderTextColor={COLORS.textSecondary} maxLength={19} />
                            </View>

                            <View style={{ flexDirection: 'row', gap: 15 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>Date d'exp.</Text>
                                    <View style={styles.inputContainer}>
                                        <TextInput style={styles.input} placeholder="MM/AA" keyboardType="numeric" value={expiry} onChangeText={handleFormatExpiry} placeholderTextColor={COLORS.textSecondary} maxLength={5} />
                                    </View>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.label}>CVC</Text>
                                    <View style={styles.inputContainer}>
                                        <TextInput style={styles.input} placeholder="123" keyboardType="numeric" secureTextEntry value={cvc} onChangeText={(t) => setCvc(t.replace(/\D/g, '').slice(0, 3))} placeholderTextColor={COLORS.textSecondary} maxLength={3} />
                                    </View>
                                </View>
                            </View>

                            <View style={{ marginBottom: 20, flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="lock-closed" size={16} color="#10b981" />
                                <Text style={{ fontSize: 12, color: '#10b981', marginLeft: 6 }}>Paiement crypté et sécurisé</Text>
                            </View>
                        </>
                    )}

                    {/* ─────────────── AIRTEL MONEY ─────────────── */}
                    {method === 'AIRTEL' && (
                        <>
                            <View style={styles.airtelBanner}>
                                <Ionicons name="phone-portrait" size={50} color={COLORS.airtel} />
                                <View style={{ flex: 1, marginLeft: 16 }}>
                                    <Text style={{ fontWeight: '800', fontSize: 16, color: COLORS.airtel }}>Airtel Money</Text>
                                    <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 }}>Un SMS de confirmation sera envoyé à votre numéro Airtel pour autoriser le débit.</Text>
                                </View>
                            </View>

                            {error ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={COLORS.error} /><Text style={styles.errorText}>{error}</Text></View> : null}

                            <Text style={styles.label}>Montant à recharger (FCFA)</Text>
                            <View style={styles.inputContainer}>
                                <Text style={styles.currencyPrefix}>FCFA</Text>
                                <TextInput style={styles.input} placeholder="Ex: 5000" keyboardType="numeric" value={amount} onChangeText={setAmount} placeholderTextColor={COLORS.textSecondary} />
                            </View>

                            <Text style={styles.label}>Numéro Airtel Money</Text>
                            <View style={[styles.inputContainer, { borderColor: COLORS.airtel + '80' }]}>
                                <Ionicons name="call-outline" size={20} color={COLORS.airtel} style={{ marginRight: 10 }} />
                                <TextInput
                                    style={styles.input}
                                    placeholder="074 000 000"
                                    keyboardType="phone-pad"
                                    value={airtelPhone}
                                    onChangeText={setAirtelPhone}
                                    placeholderTextColor={COLORS.textSecondary}
                                />
                            </View>

                            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                                <Ionicons name="information-circle-outline" size={18} color="#D97706" />
                                <Text style={{ fontSize: 12, color: '#92400E', flex: 1, lineHeight: 18 }}>
                                    Assurez-vous que votre numéro Airtel est actif et dispose d'un solde suffisant. Des frais d'opérateur peuvent s'appliquer.
                                </Text>
                            </View>
                        </>
                    )}

                    <TouchableOpacity
                        style={[styles.actionBtn, method === 'AIRTEL' && { backgroundColor: COLORS.airtel }]}
                        onPress={handleDeposit}
                        disabled={loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : (
                            <Text style={styles.actionBtnText}>
                                {method === 'AIRTEL' ? '📲 ' : '💳 '}
                                Recharger {amount ? parseFloat(amount.replace(/\s/g, '').replace(',', '.')).toLocaleString('fr-FR') : '0'} FCFA
                            </Text>
                        )}
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

    // Method selector
    methodRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
    methodCard: {
        flex: 1, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16,
        alignItems: 'center', borderWidth: 2, borderColor: '#e2e8f0',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
    },
    methodCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    methodCardAirtel: { backgroundColor: COLORS.airtel, borderColor: COLORS.airtel },
    methodLabel: { fontWeight: '700', fontSize: 14, color: COLORS.textPrimary, marginTop: 8 },
    methodSub: { fontSize: 11, color: COLORS.textSecondary, marginTop: 3 },

    // Card preview
    cardPreview: {
        backgroundColor: COLORS.primary,
        padding: 24, borderRadius: 20, marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 8
    },

    // Airtel banner
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

    actionBtn: { backgroundColor: '#10b981', height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#10b981', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
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
