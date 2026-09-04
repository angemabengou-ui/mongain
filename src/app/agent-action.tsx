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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiTransfer } from '../services/api';
import { enableBiometricPin, isBiometricPinEnabled, verifyBiometricsOrPin } from '../services/biometrics';

export default function AgentActionDeskScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

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
                    // Toujours fabriquée ici (jamais la référence serveur) — même pattern que
                    // client-withdraw-desk.tsx. `/wallet/transfer` ne fixe jamais `reference`
                    // explicitement, donc Prisma y écrit un cuid aléatoire quelconque (colonne
                    // non nullable, @default(cuid())) : le `||` ci-dessous ne se déclenchait
                    // JAMAIS puisque cette valeur est toujours "vraie" — receipt.tsx, qui décide
                    // le titre "Dépôt sur compte" via `reference.startsWith('DEPOSIT')`,
                    // affichait donc systématiquement "Paiement envoyé" pour un dépôt agent.
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
        <SafeAreaView style={styles.safeArea} edges={['top']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={26} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Guichet Agent</Text>
                    <View style={{ width: 44 }} />
                </View>

                <View style={styles.headerSpacer}>
                    <View style={styles.topIconContainer}>
                        <Ionicons name={isDeposit ? 'arrow-down' : 'arrow-up'} size={40} color={COLORS.primary} />
                    </View>
                    <Text style={styles.headerSubtitle}>
                        {isDeposit ? 'Dépôt Espèces' : 'Retrait Espèces'}
                    </Text>
                    <Text style={styles.headerDesc}>
                        {isDeposit
                            ? 'Vous créditez le portefeuille numérique de ce client contre du cash.'
                            : 'Vous débitez le portefeuille numérique de ce client pour lui remettre du cash.'}
                    </Text>
                </View>

                <ScrollView contentContainerStyle={[styles.card, { paddingBottom: Math.max(insets.bottom, 20) + 40 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>

                    <View style={styles.userBox}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                                {(clientName as string || 'C').substring(0, 2).toUpperCase()}
                            </Text>
                        </View>
                        <View>
                            <Text style={styles.userName}>{clientName}</Text>
                            <Text style={styles.userPhone}>{clientPhone}</Text>
                        </View>
                    </View>

                    <Text style={styles.label}>Montant à {isDeposit ? 'déposer' : 'retirer'}</Text>
                    <View style={styles.inputContainer}>
                        <Text style={styles.currencyLabel}>FCFA</Text>
                        <TextInput
                            style={styles.amountInput}
                            placeholder="0"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            autoFocus
                        />
                    </View>

                    <Text style={styles.label}>Votre Code PIN Agent</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.pinInput}
                            placeholder="Code PIN à 4 chiffres"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            secureTextEntry
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                        />
                    </View>

                    <View style={styles.buttonRow}>
                        {bioEnabled && (
                            <TouchableOpacity
                                style={[styles.bioBtn, (!amount || numAmountPreview <= 0 || loading) && styles.disabledButton]}
                                onPress={handleBiometricAction}
                                disabled={!amount || numAmountPreview <= 0 || loading}
                            >
                                <Ionicons name="finger-print" size={26} color={COLORS.primary} />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity
                            style={[
                                styles.saveButton,
                                bioEnabled && { flex: 3 },
                                (!amount || numAmountPreview <= 0 || pin.length !== 4 || loading) && styles.disabledButton,
                            ]}
                            onPress={handleManualAction}
                            disabled={!amount || numAmountPreview <= 0 || pin.length !== 4 || loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle" size={22} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.saveButtonText}>Valider et Transférer</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    flex: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.primary,
    },
    backBtn: { padding: 8, marginLeft: -8 },
    headerTitle: { color: '#ffffff', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    headerSpacer: {
        alignItems: 'center', justifyContent: 'center',
        paddingVertical: 12, backgroundColor: COLORS.primary, marginBottom: 24, paddingHorizontal: 20
    },
    topIconContainer: {
        width: 72, height: 72, borderRadius: 36, backgroundColor: '#ffffff',
        justifyContent: 'center', alignItems: 'center', marginBottom: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8
    },
    headerSubtitle: { color: '#ffffff', fontSize: 22, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', marginBottom: 8 },
    headerDesc: { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center', lineHeight: 20 },

    card: {
        flexGrow: 1, backgroundColor: COLORS.background,
        borderTopLeftRadius: 36, borderTopRightRadius: 36,
        padding: 28, paddingTop: 32
    },
    userBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, padding: 16, borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
    avatarText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    userName: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    userPhone: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },

    label: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: COLORS.textSecondary, marginBottom: 8, marginTop: 4 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderWidth: 1, borderColor: COLORS.border,
        borderRadius: 16, paddingHorizontal: 16, height: 64, marginBottom: 20,
    },
    currencyLabel: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', marginRight: 15, color: COLORS.textPrimary },
    amountInput: { flex: 1, fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', textAlign: 'right', color: COLORS.textPrimary },
    pinInput: { flex: 1, fontSize: 18, letterSpacing: 4, color: COLORS.textPrimary, height: '100%' },

    buttonRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
    bioBtn: {
        flex: 1, backgroundColor: COLORS.surface, borderWidth: 1.5, borderColor: COLORS.primary,
        borderRadius: 16, justifyContent: 'center', alignItems: 'center', height: 60
    },
    saveButton: {
        flex: 1, flexDirection: 'row', backgroundColor: COLORS.primary, height: 60, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 6,
    },
    disabledButton: { opacity: 0.5, elevation: 0, shadowOpacity: 0 },
    saveButtonText: { color: '#fff', fontSize: 17, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' }
});

