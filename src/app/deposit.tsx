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
import { apiTopUp } from '../services/api';

const COLORS = {
    primary: '#0f172a', // Dark theme for Card
    surface: '#ffffff',
    background: '#f8f9fe',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    error: '#E11D48',
    cardLight: '#e2e8f0'
};

export default function DepositScreen() {
    const router = useRouter();
    const [amount, setAmount] = useState('');
    const [cardNumber, setCardNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [cvc, setCvc] = useState('');

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

        if (cardNumber.length < 19 || expiry.length < 5 || cvc.length < 3) {
            setError('Veuillez remplir correctement les informations de votre carte.');
            return;
        }

        setLoading(true);
        try {
            // "tok_visa" is a standard Stripe test token to simulate a card.
            const result = await apiTopUp(amountNum, 'tok_visa');
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
                    <Ionicons name="card" size={80} color="#10b981" />
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
                    <Text style={styles.headerTitle}>Recharger par Carte</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    {/* Visual Card representation */}
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

                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={styles.label}>Montant à recharger (FCFA)</Text>
                    <View style={styles.inputContainer}>
                        <Text style={styles.currencyPrefix}>FCFA</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ex: 5000"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={styles.label}>Numéro de carte</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="card-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                        <TextInput
                            style={styles.input}
                            placeholder="0000 0000 0000 0000"
                            keyboardType="numeric"
                            value={cardNumber}
                            onChangeText={handleFormatCard}
                            placeholderTextColor={COLORS.textSecondary}
                            maxLength={19}
                        />
                    </View>

                    <View style={{ flexDirection: 'row', gap: 15 }}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>Date d'exp.</Text>
                            <View style={styles.inputContainer}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="MM/AA"
                                    keyboardType="numeric"
                                    value={expiry}
                                    onChangeText={handleFormatExpiry}
                                    placeholderTextColor={COLORS.textSecondary}
                                    maxLength={5}
                                />
                            </View>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.label}>CVC</Text>
                            <View style={styles.inputContainer}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="123"
                                    keyboardType="numeric"
                                    secureTextEntry
                                    value={cvc}
                                    onChangeText={(t) => setCvc(t.replace(/\D/g, '').slice(0, 3))}
                                    placeholderTextColor={COLORS.textSecondary}
                                    maxLength={3}
                                />
                            </View>
                        </View>
                    </View>

                    <View style={{ marginBottom: 30, marginTop: 10, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="lock-closed" size={16} color="#10b981" />
                        <Text style={{ fontSize: 12, color: '#10b981', marginLeft: 6 }}>Paiement crypté et sécurisé par Stripe (Test)</Text>
                    </View>

                    <TouchableOpacity style={styles.actionBtn} onPress={handleDeposit} disabled={loading}>
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

    cardPreview: {
        backgroundColor: COLORS.primary,
        padding: 24, borderRadius: 20, marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 8
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
