import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { BASE_URL, getToken } from '../../services/api';

export default function SeegPaymentScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [account, setAccount] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [successData, setSuccessData] = useState<any>(null);

    const handlePayment = async () => {
        if (!account || account.length < 5) {
            Alert.alert("Erreur", "Veuillez entrer un numéro de compteur valide (minimum 5 caractères).");
            return;
        }

        const amt = parseFloat(amount.replace(/\s/g, ''));
        if (isNaN(amt) || amt <= 0) {
            Alert.alert("Erreur", "Veuillez entrer un montant valide.");
            return;
        }

        if (pin.length !== 4) {
            Alert.alert("Erreur", "Code PIN requis.");
            return;
        }

        // --- PRODUCTION GUARD ---
        Alert.alert(
            "Service Indisponible",
            "L'intégration avec les serveurs officiels de la SEEG est en cours de finalisation."
        );
        return;
        // ------------------------

        setLoading(true);
        try {
            const token = await getToken();
            const res = await fetch(`${BASE_URL}/api/services/pay-bill`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ service: 'SEEG', accountNumber: account, amount: amt, pin })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur lors du paiement');

            setSuccessData(data);
        } catch (e: any) {
            Alert.alert("Erreur de paiement", e.message);
        } finally {
            setLoading(false);
        }
    };

    if (successData) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.iconWrap, { backgroundColor: '#10b98115', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="checkmark-circle" size={80} color="#10b981" />
                </View>
                <Text style={[styles.title, { marginBottom: 16 }]}>Achat Réussi !</Text>

                <View style={styles.receiptCard}>
                    <Text style={styles.receiptLabel}>Code Jeton SEEG (Edan)</Text>
                    <Text style={styles.receiptCode}>{successData.seegCode}</Text>

                    <View style={styles.divider} />

                    <Text style={styles.receiptLabel}>Montant</Text>
                    <Text style={styles.receiptValue}>{parseFloat(amount).toLocaleString('fr-FR')} FCFA</Text>

                    <Text style={styles.receiptLabel}>Compteur</Text>
                    <Text style={styles.receiptValue}>{account}</Text>

                    <Text style={styles.receiptLabel}>Référence</Text>
                    <Text style={styles.receiptValue}>{successData.reference}</Text>
                </View>

                <TouchableOpacity style={[styles.btn, { width: '100%', marginTop: 32 }]} onPress={() => router.replace('/')}>
                    <Text style={styles.btnText}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Électricité (Edan)</Text>
                    </View>

                    <View style={styles.card}>
                        <View style={{ alignItems: 'center', marginBottom: 24 }}>
                            <View style={[styles.iconWrap, { backgroundColor: '#f59e0b15' }]}>
                                <Ionicons name="flash" size={40} color="#f59e0b" />
                            </View>
                            <Text style={styles.title}>Recharge SEEG</Text>
                            <Text style={styles.subtitle}>Solde disponible: <Text style={{ fontWeight: '700' }}>{(user?.wallet?.balance || 0).toLocaleString('fr-FR')} FCFA</Text></Text>
                        </View>

                        <Text style={styles.label}>N° de Compteur (Edan)</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="hardware-chip-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Numéro à 11 chiffres..."
                                keyboardType="number-pad"
                                value={account}
                                onChangeText={setAccount}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Montant de la recharge</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="cash-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="0 FCFA"
                                keyboardType="number-pad"
                                value={amount}
                                onChangeText={setAmount}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Code PIN Mongain</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••"
                                keyboardType="number-pad"
                                secureTextEntry={!showPin}
                                maxLength={4}
                                value={pin}
                                onChangeText={setPin}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                            <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#f59e0b' }]} onPress={handlePayment} disabled={loading}>
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Payer la facture</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    backButton: { marginRight: 16 },
    headerTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
    iconWrap: { backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
    subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, fontWeight: '600' },
    eyeBtn: { padding: 8 },
    btn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    receiptCard: { backgroundColor: '#1E293B', width: '100%', borderRadius: 20, padding: 24 },
    receiptLabel: { fontSize: 13, color: '#94A3B8', marginBottom: 4 },
    receiptCode: { fontSize: 28, fontWeight: '900', color: '#10B981', letterSpacing: 2, textAlign: 'center', marginVertical: 12 },
    receiptValue: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 16 },
    divider: { height: 1, backgroundColor: '#334155', marginVertical: 16 }
});
