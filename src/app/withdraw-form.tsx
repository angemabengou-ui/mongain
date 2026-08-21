import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
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
import { useAuth } from '../context/AuthContext';
import { apiPushWithdrawal } from '../services/api';

export default function WithdrawFormScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const router = useRouter();
    const { user } = useAuth();
    const { method } = useLocalSearchParams<{ method: string }>();

    const isAirtel = method === 'AIRTEL';
    const isMoov = method === 'MOOV';
    const providerName = isAirtel ? 'Airtel Money' : isMoov ? 'Moov Africa' : 'Compte Mobile';
    const providerColor = isAirtel ? '#EF4444' : isMoov ? '#3B82F6' : COLORS.primary;

    const [phoneToCredit, setPhoneToCredit] = useState((user?.phone || '').replace(/^\+241/, ''));
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [confirmedPhone, setConfirmedPhone] = useState('');

    const submittingRef = useRef(false);

    const handleWithdraw = async () => {
        if (submittingRef.current) return;
        if (!phoneToCredit || phoneToCredit.length < 5) {
            Alert.alert("Erreur", `Veuillez vérifier le numéro ${providerName} à créditer.`);
            return;
        }

        const amt = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));
        if (isNaN(amt) || amt < 500) {
            Alert.alert("Erreur", "Le montant minimum de retrait est de 500 FCFA.");
            return;
        }

        if (pin.length !== 4) {
            Alert.alert("Erreur", "Veuillez entrer votre code PIN Mongain à 4 chiffres.");
            return;
        }

        submittingRef.current = true;
        setLoading(true);

        const cleaned = phoneToCredit.trim().replace(/\s/g, '');
        const fullPhone = cleaned.startsWith('+') ? cleaned : `+241${cleaned}`;

        try {
            await apiPushWithdrawal(fullPhone, amt, isAirtel ? 'AIRTEL' : 'MOOV', pin);
            setConfirmedPhone(fullPhone);
            setSuccess(true);
        } catch (e: any) {
            Alert.alert("Erreur de transaction", e.message || "Impossible de contacter l'opérateur.");
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.iconWrap, { backgroundColor: '#10b98115', padding: 24, borderRadius: 50, marginBottom: 24 }]}>
                    <Ionicons name="paper-plane" size={64} color="#10b981" />
                </View>
                <Text style={[styles.title, { color: COLORS.textPrimary, textAlign: 'center' }]}>Retrait Effectué !</Text>
                <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 16, fontSize: 15, lineHeight: 24, color: COLORS.textSecondary }]}>
                    Votre demande est en cours de traitement.
                    Vous allez recevoir un SMS de confirmation de {providerName} au <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>{confirmedPhone}</Text>.
                </Text>

                <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.primary, width: '100%', marginTop: 40 }]} onPress={() => router.replace('/')}>
                    <Text style={styles.btnText}>Retour au Portefeuille</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>

                <View style={[styles.header, { backgroundColor: COLORS.background }]}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Envoyer à {providerName}</Text>
                    <View style={{ width: 44 }} />
                </View>

                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                    <View style={[styles.infoPullBox, { backgroundColor: providerColor + '15', borderColor: providerColor + '30' }]}>
                        <Ionicons name="cash-outline" size={28} color={providerColor} style={{ marginRight: 16 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.infoPullTitle, { color: providerColor }]}>Opération Immédiate</Text>
                            <Text style={[styles.infoPullText, { color: COLORS.textPrimary }]}>
                                Votre solde Mongain sera débité immédiatement et l'argent transféré sur le numéro Mobile Money spécifié.
                            </Text>
                        </View>
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Numéro {providerName} (DESTINATAIRE)</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.prefix, { color: COLORS.textPrimary }]}>+241</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="Ex: 077... ou 066..."
                            keyboardType="phone-pad"
                            value={phoneToCredit}
                            onChangeText={setPhoneToCredit}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary, marginTop: 16 }]}>Montant à Retirer</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.prefix, { color: COLORS.textPrimary, borderRightWidth: 0, paddingRight: 0 }]}>FCFA</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary, fontSize: 32, fontWeight: '800', textAlign: 'right' }]}
                            placeholder="0"
                            keyboardType="number-pad"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary, marginTop: 16 }]}>Code PIN Mongain</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary, textAlign: 'center', fontSize: 24, letterSpacing: 8 }]}
                            placeholder="••••"
                            keyboardType="number-pad"
                            maxLength={4}
                            secureTextEntry={true}
                            value={pin}
                            onChangeText={setPin}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.primary }]} onPress={handleWithdraw} disabled={loading}>
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.btnText}>Valider le Retrait</Text>
                        )}
                    </TouchableOpacity>

                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, padding: 24, paddingTop: 8 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    backButton: { padding: 8, marginLeft: -12 },
    headerTitle: { fontSize: 18, fontWeight: '800' },

    infoPullBox: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 20, borderWidth: 1, marginBottom: 32 },
    infoPullTitle: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
    infoPullText: { fontSize: 13, lineHeight: 20, fontWeight: '500' },

    label: { fontSize: 14, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, height: 64, marginBottom: 16, borderWidth: 1.5 },
    prefix: { fontSize: 17, fontWeight: '800', marginRight: 12, paddingRight: 12, borderRightWidth: 1, borderRightColor: '#e2e8f0' },
    input: { flex: 1, fontSize: 18, fontWeight: '700', height: '100%', letterSpacing: 1 },

    btn: { height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#1DC5E9', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8, marginTop: 16 },
    btnText: { color: '#ffffff', fontSize: 17, fontWeight: '800' },

    iconWrap: { justifyContent: 'center', alignItems: 'center' },
    title: { fontSize: 22, fontWeight: '800' },
    subtitle: { fontSize: 15 }
});
