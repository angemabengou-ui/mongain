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
import { useAppTheme } from '../constants/theme';
import { getChildAccent } from '../constants/childAccent';
import { apiGetChildren, ChildAccount } from '../services/api';

// Liste des comptes enfant du parent connecté — même schéma que services/invest.tsx (le
// backend family.ts existait après cette session, mais n'avait jusque-là aucun écran mobile).
export default function FamilyHubScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [children, setChildren] = useState<ChildAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadChildren = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetChildren();
            setChildren(res || []);
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e.response?.data?.error || e.message || 'Impossible de charger vos comptes enfant.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Un enfant tout juste créé doit apparaître au retour de family-create sans quitter puis
    // rouvrir cet onglet (même correctif que services/invest.tsx).
    useFocusEffect(useCallback(() => { loadChildren(); }, [loadChildren]));

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Comptes Enfant</Text>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/family-create')}>
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
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadChildren(true)} tintColor={COLORS.primary} />}
                    >
                        <Text style={styles.introText}>
                            Créez un compte pour votre enfant, définissez son plafond de dépenses et rechargez son solde depuis le vôtre.
                        </Text>

                        {loadError ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="cloud-offline-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>{loadError}</Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => loadChildren()}>
                                    <Text style={styles.primaryBtnText}>Réessayer</Text>
                                </TouchableOpacity>
                            </View>
                        ) : children.length === 0 ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.emptyIconCircle, { backgroundColor: COLORS.primary + '15' }]}>
                                    <Ionicons name="people-outline" size={40} color={COLORS.primary} />
                                </View>
                                <Text style={[styles.emptyTitle, { color: COLORS.textPrimary }]}>Aucun compte enfant</Text>
                                <Text style={[styles.emptySubtitle, { color: COLORS.textSecondary }]}>
                                    Créez le premier compte de votre enfant : il aura son propre numéro et son propre code PIN.
                                </Text>
                                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: COLORS.primary }]} onPress={() => router.push('/family-create')}>
                                    <Text style={styles.primaryBtnText}>Créer un compte enfant</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            children.map((child) => {
                                const accent = getChildAccent(child.gender);
                                const initials = child.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                                return (
                                    <TouchableOpacity
                                        key={child.id}
                                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                        onPress={() => router.push({ pathname: '/family-detail', params: { id: child.id } })}
                                        activeOpacity={0.8}
                                    >
                                        <View style={styles.cardRow}>
                                            <View style={[styles.avatar, { backgroundColor: accent.tint }]}>
                                                <Text style={[styles.avatarText, { color: accent.color }]}>{initials}</Text>
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>{child.name}</Text>
                                                <Text style={[styles.cardMeta, { color: COLORS.textSecondary }]}>
                                                    {(child.wallet?.balance ?? 0).toLocaleString('fr-FR')} {child.wallet?.currency || 'FCFA'}
                                                </Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                                        </View>
                                        {child.childSpendLimitAmount ? (
                                            <View style={[styles.limitTag, { backgroundColor: accent.tint }]}>
                                                <Ionicons name="speedometer-outline" size={13} color={accent.color} />
                                                <Text style={[styles.limitTagText, { color: accent.color }]}>
                                                    Plafond {child.childSpendLimitPeriod === 'WEEKLY' ? 'hebdo' : 'quotidien'} : {child.childSpendLimitAmount.toLocaleString('fr-FR')} FCFA
                                                </Text>
                                            </View>
                                        ) : null}
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
    cardRow: { flexDirection: 'row', alignItems: 'center' },
    avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    avatarText: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    cardTitle: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    cardMeta: { fontSize: 13, marginTop: 2 },
    limitTag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
    limitTagText: { fontSize: 11.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginLeft: 5 },
});
