import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';
import { apiAgentWithdrawConfirm } from '../services/api';

export default function AgentWithdrawScreen() {
    const router = useRouter();
    const COLORS = useAppTheme();
    // In our new CICO architecture, the Scanner passes these params.
    const { payerPhone, payerName, amount, withdrawCode } = useLocalSearchParams<{
        payerPhone: string;
        payerName: string;
        amount: string;
        withdrawCode: string;
    }>();

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [commission, setCommission] = useState(0);

    const amountNum = parseFloat(amount || '0');

    const handleConfirm = async () => {
        setLoading(true);
        setError('');
        try {
            const result = await apiAgentWithdrawConfirm(payerPhone, amountNum, withdrawCode);
            setCommission(result.agentCommission ?? 0);
            setSuccess(true);
        } catch (e: any) {
            setError(e.message || 'Erreur lors du retrait');
        } finally {
            setLoading(false);
        }
    };

    // If navigated without scanning (fallback), we shouldn't allow it, or we tell them to use the scanner.
    if (!payerPhone) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="scan-outline" size={64} color={COLORS.primary} style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 18, color: '#334155', textAlign: 'center', paddingHorizontal: 40, lineHeight: 28 }}>
                    Pour sécuriser le retrait, retournez à l'écran d'accueil et utilisez le scanner pour lire le code du client.
                </Text>
                <TouchableOpacity style={[styles.doneBtn, { marginTop: 32, backgroundColor: COLORS.primary }]} onPress={() => router.back()}>
                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>Retour</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', backgroundColor: COLORS.primary }]}>
                <View style={[styles.card, { margin: 24, alignItems: 'center', paddingVertical: 40 }]}>
                    <View style={styles.successCircle}>
                        <Ionicons name="cash" size={48} color="#fff" />
                    </View>
                    <Text style={styles.successTitle}>Retrait Validé !</Text>
                    <Text style={styles.successDesc}>
                        Remettez exactement la somme de :
                    </Text>
                    <Text style={[styles.amountLabel, { color: COLORS.primary, marginTop: 12, marginBottom: 24, fontSize: 32 }]}>
                        {amountNum.toLocaleString('fr-FR')} FCFA
                    </Text>
                    <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 32 }}>
                        en espèces à {payerName}.
                    </Text>

                    <View style={styles.commissionBox}>
                        <Text style={{ color: '#059669', fontWeight: 'bold' }}>+ Commission gagnée : {commission} FCFA</Text>
                    </View>

                    <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/(tabs)' as any)}>
                        <Text style={styles.doneBtnText}>Terminer l'opération</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Validation Retrait</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={styles.content}>
                {error ? (
                    <View style={styles.errorBox}>
                        <Ionicons name="alert-circle" size={24} color="#E11D48" />
                        <Text style={styles.errorText}>{error}</Text>
                    </View>
                ) : null}

                <View style={styles.detailCard}>
                    <View style={{ alignItems: 'center', marginBottom: 24 }}>
                        <View style={styles.avatar}>
                            <Ionicons name="person" size={24} color={COLORS.primary} />
                        </View>
                        <Text style={styles.clientName}>{payerName}</Text>
                        <Text style={styles.clientPhone}>{payerPhone}</Text>
                    </View>

                    <View style={styles.amountBox}>
                        <Text style={styles.amountLabel}>Montant à remettre :</Text>
                        <Text style={styles.amountValue}>{amountNum.toLocaleString('fr-FR')} FCFA</Text>
                    </View>
                </View>
            </View>

            <View style={styles.footer}>
                <Text style={styles.warningText}>
                    En validant, la somme sera transférée du client vers votre compte Agent Mongain. Ne validez que si vous donnez les espèces.
                </Text>
                <TouchableOpacity
                    style={[styles.confirmBtn, { backgroundColor: COLORS.primary }]}
                    onPress={handleConfirm}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="checkmark-circle" size={24} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.confirmBtnText}>Valider et Décaisser</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#f8fafc' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
    backBtn: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1d2e' },
    content: { flex: 1, padding: 20 },
    card: { backgroundColor: '#fff', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, elevation: 4 },
    successCircle: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    successTitle: { fontSize: 24, fontWeight: '800', color: '#1a1d2e', marginBottom: 8 },
    successDesc: { fontSize: 16, color: '#64748b', textAlign: 'center' },
    commissionBox: { padding: 12, backgroundColor: '#D1FAE5', borderRadius: 12, marginBottom: 24 },
    doneBtn: { backgroundColor: '#f1f5f9', paddingVertical: 16, paddingHorizontal: 40, borderRadius: 16, alignItems: 'center' },
    doneBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
    errorBox: { flexDirection: 'row', backgroundColor: '#FEE2E2', padding: 16, borderRadius: 16, marginBottom: 20, alignItems: 'center' },
    errorText: { color: '#E11D48', marginLeft: 12, flex: 1, fontWeight: '500' },
    detailCard: { backgroundColor: '#fff', padding: 24, borderRadius: 24, alignItems: 'center' },
    avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e0f2fe', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    clientName: { fontSize: 20, fontWeight: '700', color: '#1a1d2e' },
    clientPhone: { fontSize: 15, color: '#64748b', marginTop: 4 },
    amountBox: { backgroundColor: '#f8fafc', width: '100%', padding: 20, borderRadius: 16, alignItems: 'center', marginTop: 24 },
    amountLabel: { fontSize: 14, color: '#64748b', fontWeight: '600', marginBottom: 8 },
    amountValue: { fontSize: 32, fontWeight: '800', color: '#1a1d2e' },
    footer: { padding: 24, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 10 },
    warningText: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 16, lineHeight: 20 },
    confirmBtn: { flexDirection: 'row', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    confirmBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' }
});
