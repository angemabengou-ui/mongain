import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { apiTransfer } from '../services/api';
import { enableBiometricPin, isBiometricPinEnabled, verifyBiometricsOrPin } from '../services/biometrics';

export default function AgentActionDeskScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const COLORS = useAppTheme();

    const { clientPhone, clientName, action } = useLocalSearchParams();
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [bioEnabled, setBioEnabled] = useState(false);
    // Ref synchrone anti double-tap : voir transfer-confirm.tsx pour le détail du problème
    // (deux appuis rapides peuvent tous deux lire `loading` avant le premier re-render).
    const submittingRef = useRef(false);

    useEffect(() => { isBiometricPinEnabled().then(setBioEnabled); }, []);

    // Right now, this screen is specialized for the Agent depositing digital cash into a Client's wallet after receiving physical cash.
    const isDeposit = action === 'DEPOSIT';
    const cleanAmount = (v: string) => parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    const numAmountPreview = cleanAmount(amount) || 0;

    const submitAction = async (usedPin: string) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        const numAmount = cleanAmount(amount);
        setLoading(true);
        try {
            // Utilisation du endpoint natif de transfert (gratuit d'un Agent vers Client dans le backend)
            const data = await apiTransfer(clientPhone as string, numAmount, usedPin);

            // Propose l'activation du déverrouillage biométrique (même parcours de
            // consentement que transfer-confirm.tsx — jamais activé silencieusement).
            if (!bioEnabled) {
                Alert.alert(
                    'Activer Face ID / Empreinte ?',
                    'Confirmez vos prochaines opérations de guichet sans ressaisir votre code PIN.',
                    [
                        { text: 'Plus tard', style: 'cancel' },
                        {
                            text: 'Activer', onPress: async () => {
                                const ok = await enableBiometricPin(usedPin);
                                if (ok) setBioEnabled(true);
                                else Alert.alert('Échec', 'Impossible d\'activer le déverrouillage biométrique sur cet appareil.');
                            }
                        },
                    ]
                );
            }

            // Redirection to receipt ticket
            // Préfixe 'DEPOSIT' obligatoire : c'est ce que receipt.tsx utilise pour
            // afficher "Dépôt sur compte" plutôt que "Paiement envoyé".
            router.replace({
                pathname: '/receipt',
                params: {
                    id: data.data?.transaction?.id || Date.now().toString(),
                    type: 'outgoing', // Agent is depositing (losing digital, gaining physical)
                    amount: numAmount,
                    currency: 'FCFA',
                    status: 'COMPLETED',
                    reference: 'DEPOSIT-AGENCY-' + Date.now().toString().substring(8),
                    counterpart: clientName as string,
                    counterpartPhone: clientPhone as string,
                    createdAt: data.data?.transaction?.createdAt || new Date().toISOString(),
                }
            });
        } catch (error: any) {
            Alert.alert('Échec', error.message || 'La transaction a échoué.');
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const handleManualAction = () => {
        const numAmount = cleanAmount(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            Alert.alert("Montant invalide", "Veuillez entrer un montant valide supérieur à 0.");
            return;
        }
        if (pin.length !== 4) {
            Alert.alert('Code PIN requis', 'Veuillez entrer votre code PIN à 4 chiffres.');
            return;
        }
        submitAction(pin);
    };

    const handleBiometricAction = async () => {
        const numAmount = cleanAmount(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            Alert.alert("Montant invalide", "Veuillez entrer un montant valide supérieur à 0.");
            return;
        }
        const authResult = await verifyBiometricsOrPin();
        if (!authResult.success || !authResult.pin) {
            Alert.alert('Échec de l\'authentification', authResult.error || 'Impossible de vérifier votre identité.');
            return;
        }
        submitAction(authResult.pin);
    };

    if (!user) return null;

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Guichet Agent</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#f8f9fa', borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                        <View style={[styles.iconContainer, { backgroundColor: isDeposit ? '#e0f2fe' : '#fee2e2' }]}>
                            <Ionicons name={isDeposit ? 'arrow-down-circle' : 'arrow-up-circle'} size={48} color={isDeposit ? '#0284c7' : '#e11d48'} />
                        </View>

                        <Text style={styles.title}>{isDeposit ? 'Dépôt Espèces' : 'Retrait Espèces'}</Text>
                        <Text style={styles.subtitle}>
                            {isDeposit ? `Vous créditez le portefeuille numérique de ce client contre du cash.` : `Vous débitez le portefeuille numérique de ce client pour lui remettre du cash.`}
                        </Text>

                        <View style={styles.userBox}>
                            <View style={[styles.avatar, { backgroundColor: isDeposit ? '#0284c7' : '#e11d48' }]}>
                                <Text style={styles.avatarText}>
                                    {(clientName as string || 'C').substring(0, 2).toUpperCase()}
                                </Text>
                            </View>
                            <View>
                                <Text style={styles.userName}>{clientName}</Text>
                                <Text style={styles.userPhone}>{clientPhone}</Text>
                            </View>
                        </View>

                        <View style={[styles.inputBox, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                            <Text style={[styles.currencyLabel, { color: COLORS.text }]}>FCFA</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.text }]}
                                placeholder="0"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="numeric"
                                value={amount}
                                onChangeText={setAmount}
                                autoFocus
                            />
                        </View>

                        <View style={[styles.inputBox, { borderColor: COLORS.border, backgroundColor: COLORS.surface, height: 56, marginBottom: 0 }]}>
                            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
                            <TextInput
                                style={[styles.input, { fontSize: 20, textAlign: 'left', color: COLORS.text }]}
                                placeholder="Code PIN"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="number-pad"
                                secureTextEntry
                                maxLength={4}
                                value={pin}
                                onChangeText={setPin}
                            />
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                        {bioEnabled && (
                            <TouchableOpacity
                                style={[styles.confirmBtn, { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary }]}
                                onPress={handleBiometricAction}
                                disabled={!amount || numAmountPreview <= 0 || loading}
                            >
                                <Ionicons name="finger-print" size={22} color={COLORS.primary} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[
                                styles.confirmBtn,
                                { flex: bioEnabled ? 3 : 1, backgroundColor: COLORS.primary },
                                (!amount || numAmountPreview <= 0 || pin.length !== 4 || loading) && styles.confirmBtnDisabled,
                            ]}
                            onPress={handleManualAction}
                            disabled={!amount || numAmountPreview <= 0 || pin.length !== 4 || loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle" size={24} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.confirmBtnText}>Valider et Transférer</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
    content: { flexGrow: 1, backgroundColor: '#f8f9fa', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 20, paddingBottom: 150 },
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 25, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 5, marginBottom: 30, marginTop: 10 },
    iconContainer: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    title: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 10, textAlign: 'center' },
    subtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginBottom: 25, lineHeight: 20, paddingHorizontal: 10 },
    userBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', padding: 15, borderRadius: 15, width: '100%', marginBottom: 25 },
    avatar: { width: 45, height: 45, borderRadius: 22.5, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
    avatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    userName: { fontSize: 16, fontWeight: 'bold', color: '#111827' },
    userPhone: { fontSize: 14, color: '#6B7280', marginTop: 2 },
    inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 15, paddingHorizontal: 20, height: 70, width: '100%', marginBottom: 15 },
    currencyLabel: { fontSize: 20, fontWeight: 'bold', marginRight: 15 },
    input: { flex: 1, fontSize: 32, fontWeight: 'bold', textAlign: 'right', color: '#111827' },
    confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 16, shadowColor: '#10B981', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8 },
    confirmBtnDisabled: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
    confirmBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});
