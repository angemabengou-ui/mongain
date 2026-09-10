import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import PinPromptModal from '../components/ui/PinPromptModal';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { getChildAccent } from '../constants/childAccent';
import { useAppTheme } from '../constants/theme';
import { apiGetChildDetail, apiGetChildTransactions, apiSetChildLimit, apiTransfer, ChildAccount, Transaction } from '../services/api';

// Détail d'un compte enfant — même schéma que vault-detail.tsx (BalanceCard + sections +
// ScreenHeader). Deux actions protégées par le PIN du PARENT (pas celui de l'enfant, qui n'a
// aucune autorité sur son propre plafond) : ajuster le plafond de dépense, et recharger le
// solde (réutilise directement apiTransfer — le serveur exempte de frais ce virement
// parent→enfant, voir wallet.ts).
export default function FamilyDetailScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { id } = useLocalSearchParams<{ id: string }>();

    const [child, setChild] = useState<ChildAccount | null>(null);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [limitPeriod, setLimitPeriod] = useState<'DAILY' | 'WEEKLY'>('DAILY');
    const [limitAmount, setLimitAmount] = useState('');
    const [fundAmount, setFundAmount] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    // Remplace Alert.prompt (no-op sur Android — voir PinPromptModal) pour les deux actions
    // débitrices/sensibles de cet écran.
    const [pinPrompt, setPinPrompt] = useState<{ type: 'limit' } | { type: 'fund' } | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (!id) return;
        if (isRefresh) setRefreshing(true);
        try {
            const [res, txRes] = await Promise.all([
                apiGetChildDetail(id),
                apiGetChildTransactions(id).catch(() => []),
            ]);
            setChild(res);
            setLimitPeriod((res.childSpendLimitPeriod as 'DAILY' | 'WEEKLY') || 'DAILY');
            setLimitAmount(res.childSpendLimitAmount ? String(res.childSpendLimitAmount) : '');
            setTransactions(txRes || []);
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Impossible de charger ce compte enfant.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleSaveLimit = () => {
        const amt = Math.round(Number(limitAmount.replace(/\s/g, '').replace(',', '.')) || 0);
        if (amt <= 0) return;
        setPinPrompt({ type: 'limit' });
    };

    const handleFund = () => {
        const amt = Math.round(Number(fundAmount.replace(/\s/g, '').replace(',', '.')) || 0);
        if (amt <= 0) return;
        setPinPrompt({ type: 'fund' });
    };

    const handlePinConfirm = async (pin: string) => {
        const prompt = pinPrompt;
        if (!prompt || !child) return;
        setActionLoading(true);
        try {
            if (prompt.type === 'limit') {
                const amt = Math.round(Number(limitAmount.replace(/\s/g, '').replace(',', '.')) || 0);
                await apiSetChildLimit(child.id, limitPeriod, amt, pin);
                Alert.alert('Plafond mis à jour', `${child.name} est désormais limité(e) à ${amt.toLocaleString('fr-FR')} FCFA par ${limitPeriod === 'WEEKLY' ? 'semaine' : 'jour'}.`);
            } else {
                const amt = Math.round(Number(fundAmount.replace(/\s/g, '').replace(',', '.')) || 0);
                await apiTransfer(child.phone, amt, pin);
                setFundAmount('');
                Alert.alert('Recharge effectuée', `${amt.toLocaleString('fr-FR')} FCFA envoyés à ${child.name}, sans frais.`);
            }
            setPinPrompt(null);
            await load();
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'L\'opération a échoué.');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading || !child) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    const accent = getChildAccent(child.gender);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title={child.name} onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                >
                    <View style={[styles.identityRow, { backgroundColor: accent.tint }]}>
                        <View style={[styles.avatar, { backgroundColor: accent.color }]}>
                            <Text style={styles.avatarText}>{child.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</Text>
                        </View>
                        <View>
                            <Text style={[styles.identityName, { color: COLORS.textPrimary }]}>{child.name}</Text>
                            <Text style={[styles.identityPhone, { color: COLORS.textSecondary }]}>{child.phone}</Text>
                        </View>
                    </View>

                    <BalanceCard
                        colors={COLORS}
                        label="Solde de l'enfant"
                        amount={`${(child.wallet?.balance ?? 0).toLocaleString('fr-FR')} ${child.wallet?.currency || 'FCFA'}`}
                    />

                    {/* Recharge */}
                    <SectionHeading colors={COLORS} title="Recharger le solde" />
                    <View style={[styles.inlineForm, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <TextInput
                            style={[styles.inlineInput, { color: COLORS.textPrimary }]}
                            placeholder="Montant en FCFA"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            value={fundAmount}
                            onChangeText={setFundAmount}
                        />
                        <TouchableOpacity
                            style={[styles.inlineBtn, { backgroundColor: accent.color }, !fundAmount && styles.disabled]}
                            onPress={handleFund}
                            disabled={!fundAmount}
                        >
                            <Text style={styles.inlineBtnText}>Recharger</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>Aucun frais n'est prélevé sur une recharge vers votre propre enfant.</Text>

                    {/* Plafond */}
                    <SectionHeading colors={COLORS} title="Plafond de dépense" marginTop={24} />
                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <View style={styles.toggleRow}>
                            <TouchableOpacity
                                style={[styles.toggleBtn, { borderColor: COLORS.border }, limitPeriod === 'DAILY' && { backgroundColor: accent.tint, borderColor: accent.color }]}
                                onPress={() => setLimitPeriod('DAILY')}
                            >
                                <Text style={[styles.toggleText, { color: limitPeriod === 'DAILY' ? accent.color : COLORS.textSecondary }]}>Par jour</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.toggleBtn, { borderColor: COLORS.border }, limitPeriod === 'WEEKLY' && { backgroundColor: accent.tint, borderColor: accent.color }]}
                                onPress={() => setLimitPeriod('WEEKLY')}
                            >
                                <Text style={[styles.toggleText, { color: limitPeriod === 'WEEKLY' ? accent.color : COLORS.textSecondary }]}>Par semaine</Text>
                            </TouchableOpacity>
                        </View>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                            placeholder="Montant maximum en FCFA"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            value={limitAmount}
                            onChangeText={setLimitAmount}
                        />
                        <TouchableOpacity
                            style={[styles.inlineBtnFull, { backgroundColor: accent.color }, !limitAmount && styles.disabled]}
                            onPress={handleSaveLimit}
                            disabled={!limitAmount}
                        >
                            <Text style={styles.inlineBtnText}>Enregistrer le plafond</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                        Ce plafond s'applique en plus des vérifications de sécurité habituelles — le plus restrictif des deux gagne.
                    </Text>

                    {/* Historique — supervision parentale : voir ce que dépense l'enfant, en plus de
                        la notification en temps réel (voir routes/wallet.ts, notifyParentOfChildSpend). */}
                    <SectionHeading colors={COLORS} title="Historique des transactions" marginTop={24} />
                    {transactions.length === 0 ? (
                        <Text style={[styles.helper, { color: COLORS.textSecondary }]}>Aucune transaction pour l'instant.</Text>
                    ) : (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                            {transactions.map((tx) => (
                                <View key={tx.id} style={[styles.txRow, { borderColor: COLORS.border }]}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.txCounterpart, { color: COLORS.textPrimary }]}>{tx.counterpart}</Text>
                                        <Text style={[styles.txDate, { color: COLORS.textSecondary }]}>
                                            {new Date(tx.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </Text>
                                    </View>
                                    <Text style={[styles.txAmount, { color: tx.type === 'incoming' ? COLORS.success : COLORS.textPrimary }]}>
                                        {tx.type === 'incoming' ? '+' : '-'}{tx.amount.toLocaleString('fr-FR')} F
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>

            <PinPromptModal
                visible={!!pinPrompt}
                title={pinPrompt?.type === 'fund' ? 'Recharger le solde' : 'Ajuster le plafond'}
                message="Saisissez VOTRE code PIN (parent) pour confirmer."
                loading={actionLoading}
                onConfirm={handlePinConfirm}
                onCancel={() => setPinPrompt(null)}
                colors={COLORS}
            />
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    identityRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 16, marginBottom: 20 },
    avatar: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    avatarText: { color: '#fff', fontSize: 17, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    identityName: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    identityPhone: { fontSize: 13, marginTop: 2 },

    inlineForm: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center' },
    inlineInput: { flex: 1, height: 42, paddingHorizontal: 12, fontSize: 15 },
    inlineBtn: { paddingHorizontal: 18, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    inlineBtnFull: { marginTop: 6, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    inlineBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 14 },
    disabled: { opacity: 0.5 },
    helper: { fontSize: 12.5, lineHeight: 18, marginTop: 8 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16 },
    toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
    toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    toggleText: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 12 },

    txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },
    txCounterpart: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    txDate: { fontSize: 12, marginTop: 2 },
    txAmount: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});
