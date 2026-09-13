import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiGetStakingVaults, apiWithdrawStakingVault, StakingVault } from '../../services/api';

// Liste des coffres de staking (backend/src/routes/invest.ts) — même schéma que
// services/vaults.tsx (Caisse Commune), le plus proche équivalent déjà existant pour un
// produit "verrouiller de l'argent, le récupérer plus tard". Ce backend existait déjà,
// entièrement fonctionnel (PIN, plafonds AML/KYC, intérêts calculés à l'échéance), mais
// aucun écran mobile n'y menait jamais.
export default function InvestScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    // Filet de sécurité UX (pas la barrière de sécurité — le backend refuse déjà ces routes
    // pour un CHILD) : couvre un lien profond périmé, une notification, ou tout autre chemin
    // qui contournerait les boutons/onglet masqués côté navigation ((tabs)/index.tsx et
    // (tabs)/_layout.tsx).
    const isChild = user?.role === 'CHILD';
    // Marchand Géant — palier consultation-seule sur mobile (voir User.merchantTier,
    // (tabs)/index.tsx) : ouvrir/débloquer un coffre déplace de l'argent, même filet de
    // sécurité UX ci-dessous que pour un Compte Enfant.
    const isGiantMerchant = user?.merchantTier === 'GIANT';

    const [vaults, setVaults] = useState<StakingVault[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

    const loadVaults = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetStakingVaults();
            setVaults(res.vaults || []);
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e.response?.data?.error || e.message || 'Impossible de charger vos coffres.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Un simple montage ne rejoue jamais au retour d'un écran poussé par-dessus (création) —
    // sans ça, un coffre tout juste ouvert n'apparaissait dans la liste qu'après avoir quitté
    // puis rouvert cet onglet (même correctif que services/vaults.tsx).
    useFocusEffect(useCallback(() => { if (!isChild && !isGiantMerchant) loadVaults(); }, [loadVaults, isChild, isGiantMerchant]));

    const handleWithdraw = (vault: StakingVault) => {
        Alert.alert(
            'Débloquer ce coffre',
            `Récupérer ${vault.amount.toLocaleString('fr-FR')} FCFA + les intérêts sur votre portefeuille ?`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Débloquer', onPress: async () => {
                        setWithdrawingId(vault.id);
                        try {
                            const res = await apiWithdrawStakingVault(vault.id);
                            Alert.alert('Coffre débloqué', res.message);
                            await loadVaults();
                        } catch (e: any) {
                            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Le déblocage a échoué.');
                        } finally {
                            setWithdrawingId(null);
                        }
                    }
                },
            ]
        );
    };

    if (isChild || isGiantMerchant) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <Ionicons name="lock-closed-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 24 }}>
                    {isGiantMerchant ? "Cette fonctionnalité est réservée au portail web pour un compte marchand géant." : "Cette fonctionnalité n'est pas disponible pour les comptes enfant."}
                </Text>
                <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={{ backgroundColor: COLORS.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 }}>
                    <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Coffres de Staking</Text>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/invest-create')}>
                    <Ionicons name="add" size={26} color="#fff" />
                </TouchableOpacity>
            </View>

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                {loading ? (
                    <View style={styles.centerFill}>
                        <ActivityIndicator color={COLORS.primary} size="large" />
                    </View>
                ) : (
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadVaults(true)} tintColor={COLORS.primary} />}
                    >
                        <Text style={styles.introText}>
                            Bloquez une partie de votre argent pour une durée choisie et récupérez-le avec des intérêts à l'échéance.
                        </Text>

                        {loadError ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="cloud-offline-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>{loadError}</Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => loadVaults()}>
                                    <Text style={styles.primaryBtnText}>Réessayer</Text>
                                </TouchableOpacity>
                            </View>
                        ) : vaults.length === 0 ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="trending-up-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>Aucun coffre pour l'instant</Text>
                                <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>
                                    Ouvrez un coffre pour faire fructifier une partie de votre épargne.
                                </Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => router.push('/invest-create')}>
                                    <Text style={styles.primaryBtnText}>Ouvrir un coffre</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            vaults.map((v) => {
                                const unlocked = v.status === 'ACTIVE' && new Date(v.lockedUntil) <= new Date();
                                return (
                                    <View key={v.id} style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                                        <View style={styles.cardRow}>
                                            <View style={[styles.cardIcon, { backgroundColor: COLORS.primary + '15' }]}>
                                                <Ionicons name="lock-closed" size={20} color={COLORS.primary} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>
                                                    {v.amount.toLocaleString('fr-FR')} FCFA
                                                </Text>
                                                <Text style={[styles.cardMeta, { color: COLORS.textSecondary }]}>
                                                    {(v.apy * 100).toFixed(0)}% d'intérêt annuel
                                                </Text>
                                            </View>
                                            {v.status === 'WITHDRAWN' ? (
                                                <View style={[styles.statusBadge, { backgroundColor: COLORS.textSecondary + '18' }]}>
                                                    <Text style={[styles.statusText, { color: COLORS.textSecondary }]}>Débloqué</Text>
                                                </View>
                                            ) : unlocked ? (
                                                <View style={[styles.statusBadge, { backgroundColor: '#10B98118' }]}>
                                                    <Text style={[styles.statusText, { color: '#10B981' }]}>Prêt</Text>
                                                </View>
                                            ) : (
                                                <View style={[styles.statusBadge, { backgroundColor: '#F59E0B18' }]}>
                                                    <Text style={[styles.statusText, { color: '#F59E0B' }]}>Bloqué</Text>
                                                </View>
                                            )}
                                        </View>
                                        <View style={[styles.cardDivider, { backgroundColor: COLORS.border }]} />
                                        <View style={styles.cardRow}>
                                            <Text style={[styles.cardLabel, { color: COLORS.textSecondary }]}>
                                                {unlocked || v.status === 'WITHDRAWN'
                                                    ? `Débloqué le ${new Date(v.lockedUntil).toLocaleDateString('fr-FR')}`
                                                    : `Débloque le ${new Date(v.lockedUntil).toLocaleDateString('fr-FR')}`}
                                            </Text>
                                            {unlocked && (
                                                <TouchableOpacity
                                                    style={[styles.withdrawBtn, { backgroundColor: COLORS.primary }, withdrawingId === v.id && { opacity: 0.6 }]}
                                                    onPress={() => handleWithdraw(v)}
                                                    disabled={withdrawingId === v.id}
                                                >
                                                    {withdrawingId === v.id
                                                        ? <ActivityIndicator color="#fff" size="small" />
                                                        : <Text style={styles.withdrawBtnText}>Débloquer</Text>}
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                );
                            })
                        )}
                    </ScrollView>
                )}
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 12,
    },
    headerBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: '#fff' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scrollContent: { padding: 20, paddingBottom: 60 },
    introText: { fontSize: 14, lineHeight: 20, color: COLORS.textSecondary, marginBottom: 20 },

    emptyState: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 12 },
    emptyIconCircle: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    emptyTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 8 },
    emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
    primaryBtn: { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 },
    primaryBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },

    card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 14 },
    cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    cardTitle: { fontSize: 17, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    cardMeta: { fontSize: 12, marginTop: 2 },
    cardDivider: { height: 1, marginVertical: 14 },
    cardLabel: { fontSize: 12, flex: 1 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    statusText: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    withdrawBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, minWidth: 90, alignItems: 'center' },
    withdrawBtnText: { color: '#fff', fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});
