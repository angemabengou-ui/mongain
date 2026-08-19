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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiPullDeposit } from '../services/api';

export default function RechargeFormScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();
    const { user } = useAuth();
    const { method } = useLocalSearchParams<{ method: string }>();

    const isAirtel = method === 'AIRTEL';
    const isMoov = method === 'MOOV';
    const providerName = isAirtel ? 'Airtel Money' : isMoov ? 'Moov Africa' : 'Compte Mobile';
    const providerColor = isAirtel ? '#EF4444' : isMoov ? '#3B82F6' : COLORS.primary;

    // Le champ n'affiche que la partie locale (le préfixe "+241" est déjà affiché à
    // côté) — pré-remplir avec user.phone en entier (format +241XXXXXXXX) dupliquait
    // visuellement le préfixe et pouvait faire envoyer un numéro incomplet si
    // l'utilisateur "corrigeait" en effaçant ce qui ressemblait à un doublon.
    const [phoneToDebit, setPhoneToDebit] = useState((user?.phone || '').replace(/^\+241/, ''));
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [confirmedPhone, setConfirmedPhone] = useState('');
    // Ref synchrone anti double-tap : voir transfer-confirm.tsx pour le détail du problème.
    const submittingRef = useRef(false);

    const handleRecharge = async () => {
        if (submittingRef.current) return;
        if (!phoneToDebit || phoneToDebit.length < 5) {
            Alert.alert("Erreur", `Veuillez vérifier le numéro ${providerName} à débiter.`);
            return;
        }

        const amt = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));
        if (isNaN(amt) || amt < 500) {
            Alert.alert("Erreur", "Le montant minimum de dépôt est de 500 FCFA.");
            return;
        }

        submittingRef.current = true;
        setLoading(true);

        const cleaned = phoneToDebit.trim().replace(/\s/g, '');
        const fullPhone = cleaned.startsWith('+') ? cleaned : `+241${cleaned}`;

        try {
            await apiPullDeposit(fullPhone, amt, isAirtel ? 'AIRTEL' : 'MOOV');
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
                <Text style={[styles.title, { color: COLORS.textPrimary, textAlign: 'center' }]}>Demande Envoyée !</Text>
                <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 16, fontSize: 15, lineHeight: 24, color: COLORS.textSecondary }]}>
                    Une demande de prélèvement a été poussée vers le numéro <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>{confirmedPhone}</Text>.
                </Text>

                <View style={[styles.warningBox, { marginTop: 24, backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                    <Ionicons name="warning" size={24} color="#D97706" style={{ marginRight: 12 }} />
                    <Text style={{ flex: 1, fontSize: 13, color: '#D97706', fontWeight: '600' }}>
                        Consultez ce téléphone et tapez votre Code Secret {providerName} pour valider la transaction (USSD).
                    </Text>
                </View>

                <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.primary, width: '100%', marginTop: 40 }]} onPress={() => router.replace('/')}>
                    <Text style={styles.btnText}>Retour au Portefeuille</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>

                {/* Header Clean */}
                <View style={[styles.header, { backgroundColor: COLORS.background }]}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Dépôt par {providerName}</Text>
                    <View style={{ width: 44 }} />
                </View>

                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                    {/* Alerte Explicative du Moteur PULL */}
                    <View style={[styles.infoPullBox, { backgroundColor: providerColor + '15', borderColor: providerColor + '30' }]}>
                        <Ionicons name="phone-portrait-outline" size={28} color={providerColor} style={{ marginRight: 16 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.infoPullTitle, { color: providerColor }]}>Autorisation {providerName}</Text>
                            <Text style={[styles.infoPullText, { color: COLORS.textPrimary }]}>
                                Les fonds seront prélevés de votre solde Mobile Money. Une pop-up s'affichera sur ce numéro pour validation.
                            </Text>
                        </View>
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Numéro {providerName} (À DEBITER)</Text>
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.prefix, { color: COLORS.textPrimary }]}>+241</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="Ex: 077... ou 066..."
                            keyboardType="phone-pad"
                            value={phoneToDebit}
                            onChangeText={setPhoneToDebit}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={[styles.label, { color: COLORS.textSecondary, marginTop: 16 }]}>Montant à Transférer vers Mongain</Text>
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

                    <TouchableOpacity style={[styles.btn, { backgroundColor: COLORS.primary }]} onPress={handleRecharge} disabled={loading}>
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.btnText}>Initier le Dépôt</Text>
                        )}
                    </TouchableOpacity>

                    <View style={styles.securityBadge}>
                        <Ionicons name="lock-closed" size={16} color="#10b981" />
                        <Text style={styles.securityText}>Transaction chiffrée. Seul {providerName} traitera votre code pin.</Text>
                    </View>

                </ScrollView>
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

    securityBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, padding: 12 },
    securityText: { fontSize: 12, color: '#10b981', marginLeft: 8, fontWeight: '600' },

    iconWrap: { justifyContent: 'center', alignItems: 'center' },
    title: { fontSize: 22, fontWeight: '800' },
    subtitle: { fontSize: 15 },
    warningBox: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1 }
});
