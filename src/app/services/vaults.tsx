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
import { apiGetVaults } from '../../services/api';

export default function VaultsListScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadVaults = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetVaults();
            setVaults(res.data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Un simple montage ne rejoue jamais au retour d'un écran poussé par-dessus
    // (création, détails) — sans ça, une caisse tout juste créée n'apparaissait
    // dans la liste qu'après avoir quitté puis rouvert l'onglet Services.
    useFocusEffect(useCallback(() => { loadVaults(); }, [loadVaults]));

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Caisses Communes</Text>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/vault-create')}>
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
                            Un coffre partagé pour un projet, un événement ou une caisse de solidarité — géré collectivement par le groupe.
                        </Text>

                        {vaults.length === 0 ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="shield-checkmark-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>Aucune caisse pour l'instant</Text>
                                <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>
                                    Créez une caisse commune pour gérer un fonds partagé avec vos proches.
                                </Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => router.push('/vault-create')}>
                                    <Text style={styles.primaryBtnText}>Créer une caisse</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            vaults.map((v) => {
                                const pendingCount = v.vault._count?.transactions || 0;
                                return (
                                    <TouchableOpacity
                                        key={v.id}
                                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                        activeOpacity={0.7}
                                        onPress={() => router.push({ pathname: '/vault-detail', params: { id: v.vault.id } })}
                                    >
                                        <View style={styles.cardRow}>
                                            <View style={[styles.cardIcon, { backgroundColor: COLORS.primary + '15' }]}>
                                                <Ionicons name="shield-checkmark" size={22} color={COLORS.primary} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>{v.vault.name}</Text>
                                                <Text style={[styles.cardMeta, { color: COLORS.textSecondary }]}>
                                                    {v.vault._count.members} membre{v.vault._count.members > 1 ? 's' : ''}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                                        </View>
                                        <View style={[styles.cardDivider, { backgroundColor: COLORS.border }]} />
                                        <View style={styles.cardRow}>
                                            <View>
                                                <Text style={[styles.cardLabel, { color: COLORS.textSecondary }]}>Solde</Text>
                                                <Text style={[styles.cardBalance, { color: COLORS.textPrimary }]}>{v.vault.balance.toLocaleString('fr-FR')} FCFA</Text>
                                            </View>
                                            {pendingCount > 0 && (
                                                <View style={[styles.pendingBadge, { backgroundColor: COLORS.error + '18' }]}>
                                                    <Text style={[styles.pendingText, { color: COLORS.error }]}>{pendingCount} en attente</Text>
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
    cardTitle: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    cardMeta: { fontSize: 12, marginTop: 2 },
    cardDivider: { height: 1, marginVertical: 14 },
    cardLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    cardBalance: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    pendingBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    pendingText: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});

