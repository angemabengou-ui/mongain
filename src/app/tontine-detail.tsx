import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
    apiGetTontineDetails,
    apiInviteToTontine,
    apiLeaveTontine,
    apiReorderTontine,
} from '../services/api';

export default function TontineDetailScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [group, setGroup] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [showInviteForm, setShowInviteForm] = useState(false);
    const [invitePhone, setInvitePhone] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const res = await apiGetTontineDetails(id);
            if (res.success) setGroup(res.data);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger le club.');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleInvite = async () => {
        if (!invitePhone.trim()) return;
        setInviteLoading(true);
        try {
            let formatted = invitePhone.trim();
            if (!formatted.startsWith('+')) {
                if (formatted.startsWith('0')) formatted = formatted.substring(1);
                formatted = '+241' + formatted;
            }
            await apiInviteToTontine(id, formatted);
            setInvitePhone('');
            setShowInviteForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de l\'invitation', e.message || 'Une erreur est survenue.');
        } finally {
            setInviteLoading(false);
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

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>{group.name}</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

                    <View style={[styles.balanceCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.balanceLabel, { color: COLORS.textSecondary }]}>Cagnotte par cycle</Text>
                        <Text style={[styles.balanceAmount, { color: COLORS.textPrimary }]}>{cagnotte.toLocaleString('fr-FR')} FCFA</Text>
                        <Text style={[styles.description, { color: COLORS.textSecondary }]}>
                            {group.contribution.toLocaleString('fr-FR')} FCFA par personne · {group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'} · cycle {group.currentCycle}
                        </Text>
                    </View>

                    <View style={styles.sectionRow}>
                        <Text style={[styles.sectionTitle, { color: COLORS.textPrimary, marginBottom: 0 }]}>Ordre de passage ({activeParticipants.length})</Text>
                        {isCreator && (
                            <TouchableOpacity onPress={() => setShowInviteForm(!showInviteForm)}>
                                <Ionicons name={showInviteForm ? 'chevron-up' : 'person-add-outline'} size={20} color={COLORS.primary} />
                            </TouchableOpacity>
                        )}
                    </View>

                    {showInviteForm && (
                        <View style={[styles.inlineForm, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                            <TextInput
                                style={[styles.inlineInput, { color: COLORS.textPrimary }]}
                                placeholder="Téléphone (ex : 074...)"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="phone-pad"
                                value={invitePhone}
                                onChangeText={setInvitePhone}
                            />
                            <TouchableOpacity
                                style={[styles.inlineBtn, { backgroundColor: COLORS.primary }, (!invitePhone || inviteLoading) && styles.disabled]}
                                onPress={handleInvite}
                                disabled={!invitePhone || inviteLoading}
                            >
                                {inviteLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
                            </TouchableOpacity>
                        </View>
                    )}

                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                        {activeParticipants.map((p: any, idx: number) => {
                            const isMe = p.userId === user?.id;
                            const isCurrentTurn = p.payoutOrder === group.currentCycle;
                            const isPast = p.payoutOrder < group.currentCycle;
                            return (
                                <View key={p.id} style={[styles.memberRow, { borderColor: COLORS.border }, isMe && { backgroundColor: COLORS.primary + '08' }]}>
                                    <View style={[styles.orderCircle, { backgroundColor: isCurrentTurn ? COLORS.primary : COLORS.border }, isPast && { opacity: 0.5 }]}>
                                        {isPast ? <Ionicons name="checkmark" size={14} color={COLORS.textPrimary} /> : <Text style={{ color: isCurrentTurn ? '#fff' : COLORS.textPrimary, fontSize: 12, fontWeight: '800' }}>{p.payoutOrder}</Text>}
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{p.user.name}{isMe ? ' (Vous)' : ''}</Text>
                                        <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{p.user.phone}</Text>
                                    </View>
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
    headerBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center', marginHorizontal: 8 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    balanceCard: { borderRadius: 18, borderWidth: 1, padding: 20, marginBottom: 24 },
    balanceLabel: { fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 },
    balanceAmount: { fontSize: 28, fontWeight: '900', marginTop: 6 },
    description: { fontSize: 13.5, marginTop: 10, lineHeight: 19 },

    sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10, marginTop: 4 },
    sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },

    inlineForm: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center', marginTop: 12 },
    inlineInput: { flex: 1, height: 42, paddingHorizontal: 12, fontSize: 15 },
    inlineBtn: { paddingHorizontal: 18, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    disabled: { opacity: 0.5 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },

    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderRadius: 10 },
    orderCircle: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    sortBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },

    leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 14 },
    leaveBtnText: { fontSize: 14, fontWeight: '700' },
});
