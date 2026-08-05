import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiMerchantCharge } from '../services/api';

export default function MerchantChargeScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const COLORS = useAppTheme();

    const { payerPhone, payerName, amount, code } = useLocalSearchParams();
    const [loading, setLoading] = useState(false);

    const chargeAmount = parseFloat(amount as string) || 0;
    const withdrawCode = decodeURIComponent(code as string || '');

    const handleCharge = async () => {
        if (!user) return;

        setLoading(true);
        try {
            const res = await apiMerchantCharge(payerPhone as string, chargeAmount, withdrawCode);

            // Redirection vers le ticket de reçu avec les données
            router.replace({
                pathname: '/receipt',
                params: {
                    id: res.transaction.id,
                    type: 'incoming',
                    amount: chargeAmount,
                    currency: 'FCFA',
                    status: 'COMPLETED',
                    reference: 'PAYCODE-' + res.transaction.id,
                    counterpart: payerName as string,
                    counterpartPhone: payerPhone as string,
                    createdAt: res.transaction.createdAt,
                }
            });
        } catch (error: any) {
            Alert.alert('Échec', error.message || 'Le prélèvement a échoué. Le code est peut-être expiré ou le solde est insuffisant.');
        } finally {
            setLoading(false);
        }
    };

    if (!user) return null;

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{user.role === 'MERCHANT' ? 'Encaissement Marchand' : 'Paiement Express (QR)'}</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={styles.content}>
                <View style={styles.card}>
                    <View style={styles.iconContainer}>
                        <Ionicons name={user.role === 'MERCHANT' ? "storefront" : "flash"} size={48} color={COLORS.primary} />
                    </View>

                    <Text style={styles.title}>{user.role === 'MERCHANT' ? "Demande d'encaissement" : "Validation du paiement"}</Text>

                    <View style={styles.amountBox}>
                        <Text style={styles.amountText}>{chargeAmount.toLocaleString('fr-FR')} FCFA</Text>
                    </View>

                    <Text style={styles.subtitle}>À prélever depuis le portefeuille de :</Text>

                    <View style={styles.userBox}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>
                                {(payerName as string || 'U').substring(0, 2).toUpperCase()}
                            </Text>
                        </View>
                        <View>
                            <Text style={styles.userName}>{payerName}</Text>
                            <Text style={styles.userPhone}>{payerPhone}</Text>
                        </View>
                    </View>

                    {user.role !== 'MERCHANT' ? (
                        <View style={styles.warningBox}>
                            <Ionicons name="warning" size={20} color="#E11D48" />
                            <Text style={styles.warningText}>
                                Vous n'avez pas un compte Marchand. L'encaissement sera bloqué par le serveur.
                            </Text>
                        </View>
                    ) : null}

                    {(!withdrawCode) ? (
                        <View style={[styles.warningBox, { backgroundColor: '#FEF3C7', marginTop: 10 }]}>
                            <Ionicons name="warning-outline" size={20} color="#D97706" />
                            <Text style={[styles.warningText, { color: '#D97706' }]}>Code QR obsolète. Le jeton sécurisé est manquant.</Text>
                        </View>
                    ) : null}

                </View>
            </View>

            <View style={[styles.footer, { backgroundColor: COLORS.background }]}>
                <TouchableOpacity
                    style={[styles.btn, { backgroundColor: COLORS.primary }]}
                    onPress={handleCharge}
                    disabled={loading || user.role !== 'MERCHANT' || !withdrawCode}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.btnText}>Confirmer l'encaissement</Text>
                    )}
                </TouchableOpacity>
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
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1, shadowRadius: 20, elevation: 10,
    },
    iconContainer: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: '#f1f5f9',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 16
    },
    title: { fontSize: 20, fontWeight: 'bold', color: '#1a1d2e', marginBottom: 24 },
    amountBox: {
        backgroundColor: '#f8fafc',
        width: '100%',
        paddingVertical: 20,
        borderRadius: 16,
        alignItems: 'center',
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    amountText: { fontSize: 32, fontWeight: '900', color: '#1DC5E9' },

    subtitle: { fontSize: 14, color: '#64748b', marginBottom: 12, fontWeight: '500', alignSelf: 'flex-start' },
    userBox: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        gap: 12, width: '100%', padding: 16, borderRadius: 16, backgroundColor: '#f1f5f9'
    },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center' },
    avatarText: { fontSize: 16, fontWeight: 'bold', color: '#334155' },
    userName: { fontSize: 16, fontWeight: 'bold', color: '#1e293b' },
    userPhone: { fontSize: 14, color: '#64748b', marginTop: 2 },

    warningBox: {
        flexDirection: 'row', backgroundColor: '#ffe4e6', padding: 16, borderRadius: 12, alignItems: 'center', gap: 10, marginTop: 24
    },
    warningText: { color: '#E11D48', flex: 1, fontSize: 13, fontWeight: '500' },

    footer: { padding: 24, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: -10 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 20 },
    btn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    btnText: { color: '#fff', fontSize: 17, fontWeight: 'bold' }
});
