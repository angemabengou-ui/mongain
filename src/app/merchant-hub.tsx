import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import BalanceCard from '../components/ui/BalanceCard';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import {
    apiCreateMerchantPayout,
    apiGetMerchantPayouts,
    apiGetMerchantStats,
    apiGetMerchantTransactions,
} from '../services/api';

// Hub de pilotage marchand — jusqu'ici, la seule vue marchand était la carte "Caisse du
// Jour" sur l'accueil (ventes + commission du jour, lecture seule). Cet écran ajoute les
// deux soldes réellement séparés (Ventes/Paiements et Commission — voir wallet.ts
// /client-initiated-withdraw et merchantService.ts), un historique catégorisé, et un vrai
// flux de retrait avec suivi de statut (MerchantPayoutRequest, traité côté staff via
// admin.merchants.ts).
const PAYOUT_STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', EXECUTED: 'Exécuté', REJECTED: 'Rejeté' };

function StatusPill({ status, colors }: { status: string; colors: ReturnType<typeof useAppTheme> }) {
    const map: Record<string, string> = { PENDING: colors.warning, EXECUTED: colors.success, REJECTED: colors.error };
    const color = map[status] || colors.textSecondary;
    return (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: color + '18' }}>
            <Text style={{ color, fontSize: 10.5, fontWeight: '700' }}>{PAYOUT_STATUS_LABELS[status] || status}</Text>
        </View>
    );
}

export default function MerchantHubScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [stats, setStats] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [txFilter, setTxFilter] = useState<'ALL' | 'SALES' | 'COMMISSION'>('ALL');
    const [payouts, setPayouts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [showPayoutForm, setShowPayoutForm] = useState(false);
    const [payoutAmount, setPayoutAmount] = useState('');
    const [payoutSource, setPayoutSource] = useState<'SALES' | 'COMMISSION'>('SALES');
    const [payoutNote, setPayoutNote] = useState('');
    const [payoutLoading, setPayoutLoading] = useState(false);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const [statsRes, txRes, payoutsRes] = await Promise.all([
                apiGetMerchantStats(),
                apiGetMerchantTransactions(txFilter === 'ALL' ? undefined : txFilter),
                apiGetMerchantPayouts(),
            ]);
            setStats(statsRes);
            setTransactions(txRes || []);
            setPayouts(payoutsRes || []);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger votre compte marchand.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [txFilter]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleCreatePayout = async () => {
        const amt = payoutAmount.replace(/\s/g, '').replace(',', '.');
        if (!amt || Number(amt) <= 0) return;
        setPayoutLoading(true);
        try {
            await apiCreateMerchantPayout(payoutSource, Number(amt), payoutNote.trim() || undefined);
            setPayoutAmount('');
            setPayoutNote('');
            setShowPayoutForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de la demande', e.message || 'Une erreur est survenue.');
        } finally {
            setPayoutLoading(false);
        }
    };

    if (loading || !stats) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    const pendingPayouts = payouts.filter(p => p.status === 'PENDING');
    const historyPayouts = payouts.filter(p => p.status !== 'PENDING');
    const availableBalance = payoutSource === 'SALES' ? stats.balance : stats.commissionBalance;

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <ScreenHeader title="Mon Commerce" onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                >
                    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                        <View style={{ flex: 1 }}>
                            <BalanceCard colors={COLORS} label="Ventes / Paiements" amount={`${stats.balance.toLocaleString('fr-FR')} FCFA`} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <BalanceCard colors={COLORS} label="Commission" amount={`${stats.commissionBalance.toLocaleString('fr-FR')} FCFA`} />
                        </View>
                    </View>
                    <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 20 }]}>
                        Aujourd'hui : {stats.todaySalesAmount.toLocaleString('fr-FR')} FCFA de ventes ({stats.todaySalesCount}) · {stats.todayCommission.toLocaleString('fr-FR')} FCFA de commission
                    </Text>

                    <SectionHeading
                        colors={COLORS}
                        title="Demander un retrait"
                        marginTop={4}
                        marginBottom={0}
                        actionIcon={showPayoutForm ? 'chevron-up' : 'chevron-down'}
                        onAction={() => setShowPayoutForm(!showPayoutForm)}
                    />

                    {showPayoutForm && (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, marginTop: 12 }]}>
                            <Text style={[styles.label, { color: COLORS.textSecondary }]}>Compte source</Text>
                            <View style={styles.toggleRow}>
                                <TouchableOpacity
                                    style={[styles.toggleBtn, { borderColor: COLORS.border }, payoutSource === 'SALES' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                    onPress={() => setPayoutSource('SALES')}
                                >
                                    <Text style={[styles.toggleText, { color: payoutSource === 'SALES' ? COLORS.primary : COLORS.textSecondary }]}>Ventes / Paiements</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.toggleBtn, { borderColor: COLORS.border }, payoutSource === 'COMMISSION' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                    onPress={() => setPayoutSource('COMMISSION')}
                                >
                                    <Text style={[styles.toggleText, { color: payoutSource === 'COMMISSION' ? COLORS.primary : COLORS.textSecondary }]}>Commission</Text>
                                </TouchableOpacity>
                            </View>
                            <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 10 }]}>Disponible : {availableBalance.toLocaleString('fr-FR')} FCFA</Text>

                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                placeholder="Montant en FCFA"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="numeric"
                                value={payoutAmount}
                                onChangeText={setPayoutAmount}
                            />
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, marginBottom: 4 }]}
                                placeholder="Note (optionnel)"
                                placeholderTextColor={COLORS.textSecondary}
                                value={payoutNote}
                                onChangeText={setPayoutNote}
                            />

                            <TouchableOpacity
                                style={[styles.inlineBtnFull, { backgroundColor: COLORS.primary }, (!payoutAmount || payoutLoading) && styles.disabled]}
                                onPress={handleCreatePayout}
                                disabled={!payoutAmount || payoutLoading}
                            >
                                {payoutLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineBtnText}>Envoyer la demande</Text>}
                            </TouchableOpacity>
                        </View>
                    )}

                    {pendingPayouts.length > 0 && (
                        <>
                            <SectionHeading colors={COLORS} title="Demandes en attente" marginTop={22} />
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {pendingPayouts.map((p: any) => (
                                    <View key={p.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{p.amount.toLocaleString('fr-FR')} FCFA</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{p.sourceAccount === 'SALES' ? 'Ventes / Paiements' : 'Commission'}</Text>
                                        </View>
                                        <StatusPill status={p.status} colors={COLORS} />
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    {historyPayouts.length > 0 && (
                        <>
                            <SectionHeading colors={COLORS} title="Historique des retraits" marginTop={22} />
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {historyPayouts.map((p: any) => (
                                    <View key={p.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{p.amount.toLocaleString('fr-FR')} FCFA</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{p.sourceAccount === 'SALES' ? 'Ventes / Paiements' : 'Commission'}</Text>
                                        </View>
                                        <StatusPill status={p.status} colors={COLORS} />
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    <SectionHeading colors={COLORS} title={`Transactions (${transactions.length})`} marginTop={22} />
                    <View style={styles.toggleRow}>
                        {(['ALL', 'SALES', 'COMMISSION'] as const).map(f => (
                            <TouchableOpacity
                                key={f}
                                style={[styles.toggleBtn, { borderColor: COLORS.border }, txFilter === f && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                onPress={() => setTxFilter(f)}
                            >
                                <Text style={[styles.toggleText, { color: txFilter === f ? COLORS.primary : COLORS.textSecondary }]}>{f === 'ALL' ? 'Toutes' : f === 'SALES' ? 'Ventes' : 'Commission'}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                        {transactions.length === 0 ? (
                            <Text style={{ color: COLORS.textSecondary, fontSize: 13, padding: 12, textAlign: 'center' }}>Aucune transaction.</Text>
                        ) : transactions.map((tx: any) => (
                            <View key={tx.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{tx.reference?.startsWith('REWARD-') ? 'Commission' : tx.reference?.startsWith('MPAYOUT-') ? 'Retrait' : 'Vente'}</Text>
                                    <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{new Date(tx.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                                </View>
                                <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{tx.amount.toLocaleString('fr-FR')} FCFA</Text>
                            </View>
                        ))}
                    </View>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },

    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 14 },
    label: { fontSize: 12.5, fontWeight: '600', marginBottom: 8 },
    helper: { fontSize: 12.5, lineHeight: 18 },
    toggleRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 10 },
    toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    toggleText: { fontSize: 13, fontWeight: '700' },

    inlineBtnFull: { marginTop: 6, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    inlineBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    disabled: { opacity: 0.5 },
});
