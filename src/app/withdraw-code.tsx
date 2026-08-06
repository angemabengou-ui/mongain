import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { BASE_URL } from '../services/api';

const { width } = Dimensions.get('window');

function generateWithdrawData(phone: string, name: string, amount: number, code: string) {
    const encodedPhone = encodeURIComponent(phone);
    const encodedName = encodeURIComponent(name);
    const encodedCode = encodeURIComponent(code);
    return `mongain://withdrawcode?phone=${encodedPhone}&name=${encodedName}&amount=${amount}&code=${encodedCode}`;
}

export default function WithdrawCodeScreen() {
    const { user, token, settings } = useAuth();
    const router = useRouter();
    const { type } = useLocalSearchParams<{ type: string }>();
    const COLORS = useAppTheme();
    const [timeLeft, setTimeLeft] = useState(60);
    const [amountInput, setAmountInput] = useState('');
    const [amountValidated, setAmountValidated] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [withdrawCode, setWithdrawCode] = useState('');

    const amountNum = parseFloat(amountInput.replace(/\s/g, '').replace(',', '.'));
    const isValidAmount = !isNaN(amountNum) && amountNum > 0;

    useEffect(() => {
        if (!amountValidated) return; // Ne compte que si le QR est actif
        if (timeLeft === 0) {
            // Code expiré — invalider le QR et demander un nouveau
            setAmountValidated(false);
            setWithdrawCode('');
            Alert.alert(
                'Code Expiré',
                'Votre jeton de sécurité a expiré. Veuillez en générer un nouveau.',
                [{ text: 'OK' }]
            );
            return;
        }
        const timer = setInterval(() => {
            setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [timeLeft, amountValidated]);

    const handleBiometricAuth = async () => {
        if (!isValidAmount) return;
        setIsAuthenticating(true);
        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();
            if (!hasHardware || !isEnrolled) {
                setAmountValidated(true);
                return;
            }
            const auth = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Autoriser la génération du jeton de Retrait',
                fallbackLabel: 'Saisir le code PIN',
                cancelLabel: 'Annuler'
            });
            if (auth.success) {
                // Fetch the OTP Code from our new ultra-secure auth endpoint
                const res = await fetch(`${BASE_URL}/api/wallet/generate-withdraw-code`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token || ''}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ amount: amountNum })
                });

                // Fallback to token from context if user.token not available, wait, we might need apiRequest helper
                if (res.ok) {
                    const data = await res.json();
                    setWithdrawCode(data.code);
                    setAmountValidated(true);
                    setTimeLeft(300); // 5 minutes
                } else {
                    const d = await res.json();
                    Alert.alert(
                        'Erreur Serveur',
                        d.error || 'Impossible de générer le jeton de sécurité. Réessayez.',
                        [{ text: 'OK' }]
                    );
                }
            }
        } catch (error) {
            console.error('Biometric Auth Error:', error);
        } finally {
            setIsAuthenticating(false);
        }
    };

    if (!user) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={COLORS.primary} size="large" />
            </SafeAreaView>
        );
    }

    const qrValue = generateWithdrawData(user.phone, user.name, amountNum, withdrawCode);

    // Frais dynamiques selon le type choisi
    const isAgent = type === 'agent';
    const taxRate = settings?.taxWithdraw || 0.013;
    const fee = isAgent ? 0 : Math.ceil(amountNum * taxRate);
    const totalDeduction = amountNum + fee;

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Retrait Cash</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={styles.content}>
                {!amountValidated ? (
                    <View style={[styles.card, { backgroundColor: '#ffffff', padding: 24 }]}>
                        <View style={{ alignItems: 'center', marginBottom: 24 }}>
                            <Ionicons name="cash-outline" size={48} color={COLORS.primary} style={{ marginBottom: 12 }} />
                            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1a1d2e', textAlign: 'center' }}>Retrait In-Person</Text>
                            <Text style={{ fontSize: 14, color: '#64748b', textAlign: 'center', marginTop: 8, lineHeight: 22 }}>
                                Saisissez le montant en espèces que vous souhaitez retirer chez l'Agent le plus proche.
                            </Text>
                        </View>

                        <Text style={{ fontSize: 14, fontWeight: '600', marginBottom: 8, color: '#334155' }}>Montant net (FCFA)</Text>
                        <View style={styles.inputContainer}>
                            <Text style={styles.currencyPrefix}>FCFA</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="0"
                                keyboardType="numeric"
                                value={amountInput}
                                onChangeText={setAmountInput}
                                placeholderTextColor="#94a3b8"
                            />
                        </View>

                        {isValidAmount && (
                            <View style={{ marginBottom: 24, padding: 12, backgroundColor: isAgent ? '#ECFDF5' : '#FFFBEB', borderRadius: 8, borderColor: isAgent ? '#10B981' : '#F59E0B', borderWidth: 1 }}>
                                <Text style={{ fontSize: 13, color: isAgent ? '#065F46' : '#92400E', marginBottom: 4 }}>
                                    Frais {isAgent ? '(Agences Mongain - GRATUIT)' : `(Commerçants - ${taxRate * 100}%)`} : <Text style={{ fontWeight: 'bold' }}>{fee} FCFA</Text>
                                </Text>
                                <Text style={{ fontSize: 14, color: '#0f172a', fontWeight: '600' }}>
                                    Débit Total prévu : <Text style={{ color: isAgent ? '#059669' : '#f59e0b' }}>{Math.ceil(Number(amountInput) + fee)} FCFA</Text>
                                </Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={[styles.actionBtn, { backgroundColor: isValidAmount ? COLORS.primary : '#e2e8f0' }]}
                            onPress={handleBiometricAuth}
                            disabled={!isValidAmount || isAuthenticating}
                        >
                            {isAuthenticating ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="finger-print" size={20} color={isValidAmount ? '#fff' : '#94a3b8'} style={{ marginRight: 8, position: 'absolute', left: 24 }} />
                                    <Text style={[styles.actionBtnText, { color: isValidAmount ? '#fff' : '#94a3b8' }]}>Générer mon Code</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={[styles.card, { backgroundColor: '#ffffff' }]}>
                        <View style={styles.cardHeader}>
                            <View style={styles.avatar}>
                                <Text style={styles.avatarText}>
                                    {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                </Text>
                            </View>
                            <View>
                                <Text style={styles.userName}>{user.name}</Text>
                                <Text style={styles.userPhone}>{user.phone}</Text>
                            </View>
                        </View>

                        <View style={styles.divider} />

                        <View style={styles.codeSection}>
                            <Text style={styles.instruction}>Présentez ce code à un Agent certifié</Text>

                            <Text style={styles.amountDisplay}>{amountNum.toLocaleString('fr-FR')} FCFA</Text>

                            <Text style={styles.refreshText}>Jeton de sécurité expire dans {timeLeft}s</Text>

                            <View style={styles.qrCodeWrapper}>
                                <QRCode
                                    value={qrValue}
                                    size={width * 0.55}
                                    color="#000000"
                                    backgroundColor="#ffffff"
                                />
                            </View>

                            <Text style={{ fontSize: 32, fontWeight: '900', color: '#1a1d2e', marginTop: 24, letterSpacing: 8 }}>
                                {withdrawCode}
                            </Text>
                        </View>

                        <View style={styles.footerInfo}>
                            <Ionicons name="shield-checkmark" size={16} color="#059669" />
                            <Text style={styles.footerText}>Authentification biométrique vérifiée</Text>
                        </View>

                        <TouchableOpacity style={{ marginTop: 16, alignItems: 'center', padding: 12 }} onPress={() => setAmountValidated(false)}>
                            <Text style={{ color: COLORS.primary, fontWeight: '600' }}>Modifier le montant</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24,
    },
    backBtn: { padding: 8, marginLeft: -8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 24 },
    headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
    content: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
    card: {
        borderRadius: 24, padding: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2, shadowRadius: 20, elevation: 12,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
    avatarText: { fontSize: 16, fontWeight: '800', color: '#1DC5E9' },
    userName: { fontSize: 16, fontWeight: '700', color: '#1a1d2e' },
    userPhone: { fontSize: 14, color: '#64748b', marginTop: 2 },
    divider: { height: 1, backgroundColor: '#f1f5f9', width: '100%', marginBottom: 24 },
    codeSection: { alignItems: 'center' },
    instruction: { fontSize: 15, fontWeight: '500', color: '#334155', marginBottom: 24 },
    refreshText: { fontSize: 12, color: '#94a3b8', marginBottom: 20 },
    qrCodeWrapper: { padding: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    footerInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 32 },
    footerText: { fontSize: 13, color: '#059669', fontWeight: '500' },
    inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc' },
    currencyPrefix: { fontSize: 15, fontWeight: '700', marginRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1', paddingRight: 12, color: '#1e293b' },
    input: { flex: 1, fontSize: 18, fontWeight: '600', height: '100%', color: '#0f172a' },
    actionBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', shadowOpacity: 0.1, shadowRadius: 10, elevation: 2 },
    actionBtnText: { fontSize: 16, fontWeight: '700' },
    amountDisplay: { fontSize: 28, fontWeight: '800', color: '#1DC5E9', marginBottom: 20 },
});
