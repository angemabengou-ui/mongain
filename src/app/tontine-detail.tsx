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
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import BalanceCard from '../components/ui/BalanceCard';
import InlineInviteForm from '../components/ui/InlineInviteForm';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
    apiGetTontineDetails,
    apiInviteToTontine,
    apiLeaveTontine,
    apiReorderTontine,
} from '../services/api';

// Statut de cotisation pour le cycle en cours, dérivé du grand livre structuré
// (TontineCycle/TontineContribution) — absent pour un groupe créé avant sa mise en
// place, ou tant que le CRON n'a pas encore exécuté ce cycle.
const CONTRIBUTION_BADGE: Record<string, { label: string; color: keyof ReturnType<typeof useAppTheme> }> = {
    PAID: { label: 'Payé', color: 'success' },
    FAILED: { label: 'Échoué', color: 'error' },
};

export default function TontineDetailScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [group, setGroup] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [showInviteForm, setShowInviteForm] = useState(false);

    const load = useCallback(async (isRefresh = false) => {
        if (!id) return;
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetTontineDetails(id);
            if (res.success) setGroup(res.data);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger le club.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleInvite = async (formattedPhone: string) => {
        try {
            await apiInviteToTontine(id, formattedPhone);
            setShowInviteForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de l\'invitation', e.message || 'Une erreur est survenue.');
        }
    };

    const handleReorder = async (participantId: string, direction: 'UP' | 'DOWN') => {
        const activeList = group.participants.filter((p: any) => p.status === 'ACTIVE');
        const index = activeList.findIndex((p: any) => p.id === participantId);
        if (index < 0) return;
        const swapWith = direction === 'UP' ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= activeList.length) return;

        const orderMap = [
            { participantId: activeList[index].id, newOrder: activeList[swapWith].payoutOrder },
            { participantId: activeList[swapWith].id, newOrder: activeList[index].payoutOrder },
        ];
        try {
            await apiReorderTontine(id, orderMap);
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de réorganiser.');
        }
    };

    const handleLeave = () => {
        Alert.alert(
            'Quitter le club',
            `Voulez-vous vraiment quitter « ${group.name} » ? Vous ne serez plus prélevé aux prochains cycles.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Quitter', style: 'destructive', onPress: async () => {
                        try {
                            await apiLeaveTontine(id);
                            router.back();
                        } catch (e: any) {
                            Alert.alert('Impossible de quitter', e.message || 'Une erreur est survenue.');
                        }
                    }
                },
            ]
        );
    };

    if (loading || !group) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    const activeParticipants = group.participants.filter((p: any) => p.status === 'ACTIVE').sort((a: any, b: any) => a.payoutOrder - b.payoutOrder);
    const isCreator = group.creatorId === user?.id;
    const cagnotte = group.contribution * activeParticipants.length;
    const cycles = group.cycles || [];
    const currentCycleLedger = cycles.find((c: any) => c.cycleNumber === group.currentCycle);
    const contributionByParticipant: Record<string, string> = {};
    (currentCycleLedger?.contributions || []).forEach((c: any) => { contributionByParticipant[c.participantId] = c.status; });

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <ScreenHeader title={group.name} onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                >

                    <BalanceCard
                        colors={COLORS}
                        label="Cagnotte par cycle"
                        amount={`${cagnotte.toLocaleString('fr-FR')} FCFA`}
                        description={`${group.contribution.toLocaleString('fr-FR')} FCFA par personne · ${group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'} · cycle ${group.currentCycle}`}
                    />

                    <SectionHeading
                        colors={COLORS}
                        title={`Ordre de passage (${activeParticipants.length})`}
                        marginBottom={0}
                        actionIcon={isCreator ? (showInviteForm ? 'chevron-up' : 'person-add-outline') : undefined}
                        onAction={isCreator ? () => setShowInviteForm(!showInviteForm) : undefined}
                    />

                    {showInviteForm && <InlineInviteForm colors={COLORS} onInvite={handleInvite} style={{ marginTop: 12 }} />}

                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                        {activeParticipants.map((p: any, idx: number) => {
                            const isMe = p.userId === user?.id;
                            const isCurrentTurn = p.payoutOrder === group.currentCycle;
                            const isPast = p.payoutOrder < group.currentCycle;
                            const contributionStatus = contributionByParticipant[p.id];
                            const badge = contributionStatus ? CONTRIBUTION_BADGE[contributionStatus] : null;
                            return (
                                <View key={p.id} style={[styles.memberRow, { borderColor: COLORS.border }, isMe && { backgroundColor: COLORS.primary + '08' }]}>
                                    <View style={[styles.orderCircle, { backgroundColor: isCurrentTurn ? COLORS.primary : COLORS.border }, isPast && { opacity: 0.5 }]}>
                                        {isPast ? <Ionicons name="checkmark" size={14} color={COLORS.textPrimary} /> : <Text style={{ color: isCurrentTurn ? '#fff' : COLORS.textPrimary, fontSize: 12, fontWeight: '800' }}>{p.payoutOrder}</Text>}
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{p.user.name}{isMe ? ' (Vous)' : ''}</Text>
                                        <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{p.user.phone}</Text>
                                    </View>
                                    {badge && (
                                        <View style={[styles.contributionBadge, { backgroundColor: COLORS[badge.color] + '18' }]}>
                                            <Text style={{ color: COLORS[badge.color], fontSize: 10.5, fontWeight: '700' }}>{badge.label}</Text>
                                        </View>
                                    )}
                                    {isCreator && (
                                        <View style={{ flexDirection: 'row', gap: 6 }}>
                                            {idx > 0 && (
                                                <TouchableOpacity style={[styles.sortBtn, { backgroundColor: COLORS.background }]} onPress={() => handleReorder(p.id, 'UP')}>
                                                    <Ionicons name="chevron-up" size={16} color={COLORS.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                            {idx < activeParticipants.length - 1 && (
                                                <TouchableOpacity style={[styles.sortBtn, { backgroundColor: COLORS.background }]} onPress={() => handleReorder(p.id, 'DOWN')}>
                                                    <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>

                    <SectionHeading colors={COLORS} title={`Historique des cycles (${cycles.length})`} marginTop={22} />
                    {cycles.length === 0 ? (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                            <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 }}>Aucun cycle exécuté pour l'instant.</Text>
                        </View>
                    ) : (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                            {cycles.map((c: any) => {
                                const beneficiary = group.participants.find((p: any) => p.id === c.beneficiaryParticipantId);
                                return (
                                    <View key={c.id} style={[styles.memberRow, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>Cycle #{c.cycleNumber}{beneficiary ? ` — ${beneficiary.user.name}` : ''}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                                                {new Date(c.executedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} · {c.totalCollected.toLocaleString('fr-FR')} FCFA collectés
                                            </Text>
                                        </View>
                                        {c.status === 'PARTIAL' && (
                                            <View style={[styles.contributionBadge, { backgroundColor: COLORS.warning + '18' }]}>
                                                <Text style={{ color: COLORS.warning, fontSize: 10.5, fontWeight: '700' }}>Échecs</Text>
                                            </View>
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                    )}

                    <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
                        <Ionicons name="exit-outline" size={18} color={COLORS.error} />
                        <Text style={[styles.leaveBtnText, { color: COLORS.error }]}>Quitter ce club</Text>
                    </TouchableOpacity>
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
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

    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderRadius: 10 },
    orderCircle: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    sortBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    contributionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 6 },

    leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 14 },
    leaveBtnText: { fontSize: 14, fontWeight: '700' },
});
