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
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiDiscoverTontines, apiJoinTontine } from '../services/api';

// Découverte de tontines publiques (isPublic=true) — jusqu'ici, apiJoinTontine existait
// côté client mais n'était jamais appelé : aucun parcours ne menait à un groupId à
// rejoindre hors invitation directe par le créateur.
export default function TontineDiscoverScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [query, setQuery] = useState('');
    const [groups, setGroups] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [joiningId, setJoiningId] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiDiscoverTontines(query.trim() || undefined);
            setGroups(res.data || []);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger les tontines publiques.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [query]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleJoin = (group: any) => {
        Alert.alert(
            group.name,
            `Rejoindre ce club vous engage à cotiser ${group.contribution.toLocaleString('fr-FR')} FCFA par cycle (${group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'}), prélevés automatiquement.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Rejoindre', onPress: async () => {
                        setJoiningId(group.id);
                        try {
                            await apiJoinTontine(group.id);
                            router.replace({ pathname: '/tontine-detail' as any, params: { id: group.id } });
                        } catch (e: any) {
                            Alert.alert('Échec', e.message || "Impossible de rejoindre ce club.");
                        } finally {
                            setJoiningId(null);
                        }
                    }
                },
            ]
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Découvrir des tontines</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <View style={[styles.searchBox, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                    <Ionicons name="search" size={16} color={COLORS.textSecondary} />
                    <TextInput
                        style={{ flex: 1, marginLeft: 8, color: COLORS.textPrimary, fontSize: 14 }}
                        placeholder="Rechercher un club public…"
                        placeholderTextColor={COLORS.textSecondary}
                        value={query}
                        onChangeText={setQuery}
                        onSubmitEditing={() => load()}
                        returnKeyType="search"
                    />
                </View>

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
                        {groups.length === 0 ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="compass-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>Aucune tontine publique trouvée</Text>
                                <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>
                                    Les clubs privés ne sont rejoignables que sur invitation de leur créateur.
                                </Text>
                            </View>
                        ) : groups.map((g: any) => (
                            <View key={g.id} style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                                <View style={styles.cardRow}>
                                    <View style={[styles.cardIcon, { backgroundColor: COLORS.primary + '15' }]}>
                                        <Ionicons name="sync" size={20} color={COLORS.primary} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>{g.name}</Text>
                                        <Text style={[styles.cardMeta, { color: COLORS.textSecondary }]}>
                                            Par {g.creator?.name} · {g._count?.participants ?? 0} membre(s)
                                        </Text>
                                    </View>
                                </View>
                                <View style={[styles.cardDivider, { backgroundColor: COLORS.border }]} />
                                <View style={styles.cardRow}>
                                    <View>
                                        <Text style={[styles.cardLabel, { color: COLORS.textSecondary }]}>Cotisation</Text>
                                        <Text style={[styles.cardBalance, { color: COLORS.textPrimary }]}>
                                            {g.contribution.toLocaleString('fr-FR')} FCFA <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>/ {g.frequency === 'MONTHLY' ? 'mois' : 'semaine'}</Text>
                                        </Text>
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.joinBtn, { backgroundColor: COLORS.primary }, joiningId === g.id && { opacity: 0.6 }]}
                                        onPress={() => handleJoin(g)}
                                        disabled={joiningId === g.id}
                                    >
                                        {joiningId === g.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.joinBtnText}>Rejoindre</Text>}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))}
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
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scrollContent: { padding: 20, paddingTop: 4, paddingBottom: 60 },

    searchBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginBottom: 12, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 44 },

    emptyState: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 12 },
    emptyIconCircle: { width: 88, height: 88, borderRadius: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
    emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

    card: { borderRadius: 18, borderWidth: 1.5, padding: 16, marginBottom: 14 },
    cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    cardTitle: { fontSize: 15, fontWeight: '700' },
    cardMeta: { fontSize: 12, marginTop: 2 },
    cardDivider: { height: 1, marginVertical: 14 },
    cardLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    cardBalance: { fontSize: 17, fontWeight: '800' },
    joinBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, minWidth: 96, alignItems: 'center' },
    joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
