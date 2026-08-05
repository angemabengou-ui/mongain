import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
    View,
} from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { BASE_URL } from '../services/api';
import { verifyBiometricsOrPin } from '../services/biometrics';

export default function ClientWithdrawDeskScreen() {
    const router = useRouter();
    const { user, token } = useAuth();
    const COLORS = useAppTheme();

    const { agentPhone, agentName } = useLocalSearchParams();
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const handleWithdraw = async () => {
        if (!user) return;
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            Alert.alert("Montant invalide", "Veuillez entrer un montant valide supérieur à 0.");
            return;
        }

        // Biometric / PIN Verification
        const authResult = await verifyBiometricsOrPin();
        if (!authResult.success) {
            Alert.alert('Échec de l\'authentification', authResult.error || 'Impossible de vérifier votre identité.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${BASE_URL}/api/wallet/client-initiated-withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    receiverPhone: agentPhone,
                    amount: numAmount,
                    pin: authResult.pin,
                    useBiometrics: authResult.useBiometrics
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

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
            setLoading(false);
        }
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

                        <Text style={[styles.feeText, { color: COLORS.textSecondary }]}>
                            Frais de retrait : GRATUIT
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[
                            styles.confirmBtn,
                            (!amount || parseFloat(amount) <= 0 || loading) && styles.confirmBtnDisabled,
                            { backgroundColor: COLORS.primary }
                        ]}
                        onPress={handleWithdraw}
                        disabled={!amount || parseFloat(amount) <= 0 || loading}
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

                    <Text style={{ textAlign: 'center', color: '#6B7280', opacity: 0.8, marginTop: 15, fontSize: 13 }}>
                        Montrez le reçu de succès à l'agent après validation.
                    </Text>
                </ScrollView>
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
