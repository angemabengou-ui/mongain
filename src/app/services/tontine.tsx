import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { apiGetTontineGroups } from '../../services/api';

export default function TontineListScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [participations, setParticipations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetTontineGroups();
            setParticipations((res.data?.myParticipations || []).filter((p: any) => p.status !== 'LEFT'));
            setLoadError(null);
        } catch (e: any) {
            // Un échec silencieux (juste console.error) laissait `participations` à [], rendant
            // le même état vide que "vous ne participez vraiment à aucune tontine".
            setLoadError(e.response?.data?.error || e.message || 'Impossible de charger vos tontines.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Tontines</Text>
                <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/tontine-discover')}>
                        <Ionicons name="compass-outline" size={24} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/tontine-create')}>
                        <Ionicons name="add" size={26} color="#fff" />
                    </TouchableOpacity>
                </View>
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
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                    >
                        <Text style={styles.introText}>
                            Épargnez à plusieurs, chacun son tour reçoit la cagnotte complète.
                        </Text>

                        {loadError ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="cloud-offline-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>{loadError}</Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => load()}>
                                    <Text style={styles.primaryBtnText}>Réessayer</Text>
                                </TouchableOpacity>
                            </View>
                        ) : participations.length === 0 ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="sync-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>Aucune tontine pour l'instant</Text>
                                <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>
                                    Lancez un club pour épargner avec vos proches, chacun votre tour.
                                </Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => router.push('/tontine-create')}>
                                    <Text style={styles.primaryBtnText}>Lancer un club</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={{ marginTop: 14 }} onPress={() => router.push('/tontine-discover')}>
                                    <Text style={{ color: COLORS.primary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 14 }}>Ou découvrir des tontines publiques →</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            participations.map((p) => {
                                const isMyTurn = p.payoutOrder === p.group.currentCycle;
                                return (
                                    <TouchableOpacity
                                        key={p.id}
                                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: isMyTurn ? COLORS.primary : COLORS.border }]}
                                        activeOpacity={0.7}
                                        onPress={() => router.push({ pathname: '/tontine-detail', params: { id: p.group.id } })}
                                    >
                                        <View style={styles.cardRow}>
                                            <View style={[styles.cardIcon, { backgroundColor: COLORS.primary + '15' }]}>
                                                <Ionicons name="sync" size={20} color={COLORS.primary} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>{p.group.name}</Text>
                                                <Text style={[styles.cardMeta, { color: COLORS.textSecondary }]}>
                                                    {p.group.frequency === 'MONTHLY' ? 'Mensuel' : 'Hebdomadaire'} · #{p.payoutOrder} sur {p.group._count?.participants ?? '?'}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                                        </View>
                                        <View style={[styles.cardDivider, { backgroundColor: COLORS.border }]} />
                                        <View style={styles.cardRow}>
                                            <View>
                                                <Text style={[styles.cardLabel, { color: COLORS.textSecondary }]}>Cotisation</Text>
                                                <Text style={[styles.cardBalance, { color: COLORS.textPrimary }]}>{p.group.contribution.toLocaleString('fr-FR')} FCFA</Text>
                                            </View>
                                            {isMyTurn && (
                                                <View style={[styles.turnBadge, { backgroundColor: COLORS.primary }]}>
                                                    <Ionicons name="gift" size={13} color="#fff" />
                                                    <Text style={styles.turnBadgeText}>C'est votre tour</Text>
                                                </View>
                                            )}
                                        </View>
                                    </TouchableOpacity>
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
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

    card: { borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 14 },
    cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    cardTitle: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    cardMeta: { fontSize: 12, marginTop: 2 },
    cardDivider: { height: 1, marginVertical: 14 },
    cardLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    cardBalance: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    turnBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
    turnBadgeText: { color: '#fff', fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});

