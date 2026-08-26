import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useAppTheme } from '../constants/theme';
import { apiGetSystemSettings, apiGetTontineGroups, apiGetVaults } from '../services/api';

// Point d'entrée unique pour Caisse Commune + Tontine — avant, deux petites icônes
// noyées dans « Services & Factures » au même niveau qu'Électricité/Crédit Air,
// aucune des deux n'étant plus visible ou explicite que l'autre malgré leur importance
// (ce sont de vrais outils de gestion d'argent en groupe, pas de simples paiements de
// factures). Regroupées ici avec une phrase d'explication simple par carte, sans jargon.
export default function EpargneHubScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [vaultsCount, setVaultsCount] = useState<number | null>(null);
    const [tontinesCount, setTontinesCount] = useState<number | null>(null);
    const [tontineEnabled, setTontineEnabled] = useState(true);

    const load = useCallback(async () => {
        try {
            const [vaultsRes, tontinesRes, settings] = await Promise.all([
                apiGetVaults().catch(() => ({ data: [] })),
                apiGetTontineGroups().catch(() => ({ data: { myParticipations: [] } })),
                apiGetSystemSettings().catch(() => null),
            ]);
            setVaultsCount((vaultsRes.data || []).length);
            setTontinesCount((tontinesRes.data?.myParticipations || []).filter((p: any) => p.status !== 'LEFT').length);
            if (settings) setTontineEnabled(settings.tontineEnabled ?? true);
        } catch {
            // Les compteurs sont un simple indicatif — une caisse/tontine reste
            // accessible via sa carte même si le chargement du badge échoue.
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <ScreenHeader title="Mon Épargne" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <Text style={[styles.intro, { color: COLORS.textSecondary }]}>
                        Gérez votre argent en groupe, en toute simplicité.
                    </Text>

                    <TouchableOpacity
                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        activeOpacity={0.8}
                        onPress={() => router.push('/services/vaults' as any)}
                    >
                        <View style={[styles.cardIcon, { backgroundColor: '#F59E0B15' }]}>
                            <Ionicons name="shield-checkmark" size={30} color="#F59E0B" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <View style={styles.cardTitleRow}>
                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>Caisse Commune</Text>
                                {vaultsCount !== null && vaultsCount > 0 && (
                                    <View style={[styles.countBadge, { backgroundColor: '#F59E0B18' }]}>
                                        <Text style={[styles.countBadgeText, { color: '#F59E0B' }]}>{vaultsCount}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.cardDesc, { color: COLORS.textSecondary }]}>
                                Une cagnotte commune avec vos proches — personne ne retire seul.
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }, !tontineEnabled && styles.cardDisabled]}
                        activeOpacity={0.8}
                        onPress={() => tontineEnabled && router.push('/services/tontine' as any)}
                    >
                        <View style={[styles.cardIcon, { backgroundColor: '#10B98115' }]}>
                            <Ionicons name="sync" size={30} color="#10B981" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <View style={styles.cardTitleRow}>
                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>Tontine</Text>
                                {tontinesCount !== null && tontinesCount > 0 && (
                                    <View style={[styles.countBadge, { backgroundColor: '#10B98118' }]}>
                                        <Text style={[styles.countBadgeText, { color: '#10B981' }]}>{tontinesCount}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.cardDesc, { color: COLORS.textSecondary }]}>
                                {tontineEnabled
                                    ? "Cotisez à tour de rôle, chacun reçoit la cagnotte complète à son tour."
                                    : 'Temporairement indisponible.'}
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 20 },
    intro: { fontSize: 14, lineHeight: 20, marginBottom: 20 },

    card: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 16 },
    cardDisabled: { opacity: 0.5 },
    cardIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    cardTitle: { fontSize: 17, fontWeight: '800' },
    cardDesc: { fontSize: 13, lineHeight: 18 },
    countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    countBadgeText: { fontSize: 12, fontWeight: '800' },
});
