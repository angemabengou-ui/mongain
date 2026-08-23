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
import { apiClientInitiatedWithdraw } from '../services/api';
import { enableBiometricPin, isBiometricPinEnabled, verifyBiometricsOrPin } from '../services/biometrics';

export default function ClientWithdrawDeskScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user, settings } = useAuth();
    const COLORS = useAppTheme();

    const { agentPhone, agentName, agentRole } = useLocalSearchParams();
    const isMerchant = agentRole === 'MERCHANT';
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [bioEnabled, setBioEnabled] = useState(false);
    // Ref synchrone anti double-tap : voir transfer-confirm.tsx pour le détail du problème
    // (deux appuis rapides peuvent tous deux lire `loading` avant le premier re-render).
    const submittingRef = useRef(false);

    useEffect(() => { isBiometricPinEnabled().then(setBioEnabled); }, []);

    // Ce guichet gère les retraits chez un Agent ET chez un Marchand (qr.tsx route les deux
    // ici avec les mêmes noms de params) — le backend (wallet.ts client-initiated-withdraw)
    // applique une formule de frais DIFFÉRENTE selon le rôle réel de la contrepartie : un
    // Marchand n'a ni seuil gratuit ni palier, le taux plein s'applique dès le premier franc.
    // Utiliser toujours la formule Agent ici annonçait "GRATUIT" pour un retrait Marchand
    // alors que le serveur facturait réellement des frais.
    const threshold = settings?.agencyWithdrawThreshold ?? 500000;
    const taxRate = isMerchant ? (settings?.taxWithdraw ?? 0.013) : (settings?.agencyTaxWithdraw ?? 0.01);
    // keyboardType="numeric" n'empêche pas un espace ou une virgule de finir dans la
    // valeur (collage, certains claviers IME) — sans ce nettoyage, parseFloat("50 000")
    // vaut 50 et le retrait envoyé au serveur pouvait être 1000x plus petit que prévu.
    const cleanAmount = (v: string) => parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    const numAmountPreview = cleanAmount(amount) || 0;
    const fee = isMerchant
        ? Math.ceil(numAmountPreview * taxRate)
        : (numAmountPreview > threshold ? Math.ceil((numAmountPreview - threshold) * taxRate) : 0);

    const submitWithdraw = async (usedPin: string) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        const numAmount = cleanAmount(amount);
        setLoading(true);
        try {
            const data = await apiClientInitiatedWithdraw(agentPhone as string, numAmount, usedPin);

            // Propose l'activation du déverrouillage biométrique (même parcours de
            // consentement que transfer-confirm.tsx — jamais activé silencieusement).
            if (!bioEnabled) {
                Alert.alert(
                    'Activer Face ID / Empreinte ?',
                    'Confirmez vos prochains retraits sans ressaisir votre code PIN.',
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
            router.replace({
                pathname: '/receipt',
                params: {
                    id: data.data.transaction.id,
                    type: 'outgoing', // Client is withdrawing (losing digital, gaining physical)
                    amount: numAmount,
                    currency: 'FCFA',
                    status: 'COMPLETED',
                    reference: 'WITHDRAW-' + data.data.transaction.id.substring(0, 8),
                    counterpart: agentName as string,
                    counterpartPhone: agentPhone as string,
                    createdAt: data.data.transaction.createdAt,
                }
            });
        } catch (error: any) {
            Alert.alert('Échec', error.message || 'Le retrait a échoué. Solde insuffisant ?');
        } finally {
            submittingRef.current = false;
            setLoading(false);
        }
    };

    const handleManualWithdraw = () => {
        const numAmount = cleanAmount(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            Alert.alert("Montant invalide", "Veuillez entrer un montant valide supérieur à 0.");
            return;
        }
        if (pin.length !== 4) {
            Alert.alert('Code PIN requis', 'Veuillez entrer votre code PIN à 4 chiffres.');
            return;
        }
        submitWithdraw(pin);
    };

    const handleBiometricWithdraw = async () => {
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
        submitWithdraw(authResult.pin);
    };

    if (!user) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <ActivityIndicator color={COLORS.surface} size="large" />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Retrait en Agence</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#f8f9fa', borderTopLeftRadius: 30, borderTopRightRadius: 30 }}>
                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                        <View style={styles.iconContainer}>
                            <Ionicons name="cash" size={48} color={COLORS.primary} />
                        </View>

                        <Text style={styles.title}>Demande de retrait</Text>
                        <Text style={styles.subtitle}>
                            Saisissez le montant exact à retirer auprès de l'agent :
                        </Text>

                        <View style={styles.userBox}>
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>
                                    {(agentName as string || 'A').substring(0, 2).toUpperCase()}
                                </Text>
                            </View>
                            <View>
                                <Text style={styles.userName}>{agentName}</Text>
                                <Text style={styles.userPhone}>{agentPhone}</Text>
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

                        <Text style={[styles.feeText, { color: fee > 0 ? '#F59E0B' : COLORS.textSecondary }]}>
                            {isMerchant
                                ? `Frais de retrait : ${fee.toLocaleString('fr-FR')} FCFA (${(taxRate * 100).toLocaleString('fr-FR')}%)`
                                : fee > 0
                                    ? `Frais de retrait : ${fee.toLocaleString('fr-FR')} FCFA (au-delà de ${threshold.toLocaleString('fr-FR')} FCFA)`
                                    : 'Frais de retrait : GRATUIT'}
                        </Text>

                        <View style={[styles.inputBox, { borderColor: COLORS.border, backgroundColor: COLORS.surface, height: 56, marginTop: 10, marginBottom: 0 }]}>
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
                                onPress={handleBiometricWithdraw}
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
                            onPress={handleManualWithdraw}
                            disabled={!amount || numAmountPreview <= 0 || pin.length !== 4 || loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark-circle" size={24} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.confirmBtnText}>Autoriser le retrait</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>

                    <Text style={{ textAlign: 'center', color: '#6B7280', opacity: 0.8, marginTop: 15, fontSize: 13 }}>
                        Montrez le reçu de succès à l'agent après validation.
                    </Text>
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 10,
        paddingBottom: 20,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#fff',
    },
    content: {
        flexGrow: 1,
        backgroundColor: '#f8f9fa',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        padding: 20,
        paddingBottom: 150,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 25,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 5,
        marginBottom: 30,
        marginTop: 10,
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#111827',
        marginBottom: 10,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: '#6B7280',
        textAlign: 'center',
        marginBottom: 25,
        lineHeight: 22,
    },
    userBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
        padding: 15,
        borderRadius: 15,
        width: '100%',
        marginBottom: 25,
    },
    avatar: {
        width: 45,
        height: 45,
        borderRadius: 22.5,
        backgroundColor: '#10B981',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 15,
    },
    avatarText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    userName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#111827',
    },
    userPhone: {
        fontSize: 14,
        color: '#6B7280',
        marginTop: 2,
    },
    inputBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 2,
        borderRadius: 15,
        paddingHorizontal: 20,
        height: 70,
        width: '100%',
        marginBottom: 15,
    },
    currencyLabel: {
        fontSize: 20,
        fontWeight: 'bold',
        marginRight: 15,
    },
    input: {
        flex: 1,
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'right',
        color: '#111827',
    },
    feeText: {
        fontSize: 14,
        fontWeight: '600',
    },
    confirmBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        borderRadius: 16,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 8,
    },
    confirmBtnDisabled: {
        backgroundColor: '#A7F3D0',
        shadowOpacity: 0,
        elevation: 0,
    },
    confirmBtnText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    }
});
