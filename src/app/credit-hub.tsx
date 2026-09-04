import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useAppTheme } from '../constants/theme';
import { apiGetActiveLoans } from '../services/api';

// Point d'entrée unique pour Crédit + BNPL + Crypto — les trois écrans existaient déjà
// (backend fonctionnel, PIN sécurisé) mais aucun n'était atteignable depuis l'app : Crédit et
// Crypto étaient déclarés comme onglets cachés (href: null) sans jamais être poussés depuis
// nulle part, et BNPL n'avait aucun lien du tout. Regroupés ici comme Caisse Commune + Tontine
// le sont déjà dans epargne-hub.tsx (même schéma), mais sous l'angle "produits individuels"
// plutôt que "argent en groupe" — Crédit/BNPL empruntent, Crypto investit, aucun des trois
// n'implique d'autres membres.
export default function CreditHubScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [activeLoansCount, setActiveLoansCount] = useState<number | null>(null);

    const load = useCallback(async () => {
        try {
            const loans = await apiGetActiveLoans();
            setActiveLoansCount((loans || []).length);
        } catch {
            // Le compteur est un simple indicatif — la carte reste accessible même si le
            // chargement du badge échoue.
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Crédit & Investissements" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <Text style={[styles.intro, { color: COLORS.textSecondary }]}>
                        Empruntez ou faites fructifier votre argent, individuellement.
                    </Text>

                    <TouchableOpacity
                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        activeOpacity={0.8}
                        onPress={() => router.push('/credit')}
                    >
                        <View style={[styles.cardIcon, { backgroundColor: '#1E3A8A15' }]}>
                            <Ionicons name="cash" size={30} color="#1E3A8A" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <View style={styles.cardTitleRow}>
                                <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>Crédit Mongain</Text>
                                {activeLoansCount !== null && activeLoansCount > 0 && (
                                    <View style={[styles.countBadge, { backgroundColor: '#1E3A8A18' }]}>
                                        <Text style={[styles.countBadgeText, { color: '#1E3A8A' }]}>{activeLoansCount}</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.cardDesc, { color: COLORS.textSecondary }]}>
                                Un micro-crédit instantané selon votre score de confiance.
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        activeOpacity={0.8}
                        onPress={() => router.push('/bnpl')}
                    >
                        <View style={[styles.cardIcon, { backgroundColor: '#F59E0B15' }]}>
                            <Ionicons name="card" size={30} color="#F59E0B" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>Achat en plusieurs fois</Text>
                            <Text style={[styles.cardDesc, { color: COLORS.textSecondary }]}>
                                Payez un achat en plusieurs échéances (BNPL).
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        activeOpacity={0.8}
                        onPress={() => router.push('/crypto')}
                    >
                        <View style={[styles.cardIcon, { backgroundColor: '#10B98115' }]}>
                            <Ionicons name="trending-up" size={30} color="#10B981" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.cardTitle, { color: COLORS.textPrimary }]}>Crypto</Text>
                            <Text style={[styles.cardDesc, { color: COLORS.textSecondary }]}>
                                Achetez et vendez du BTC, ETH ou USDT depuis votre solde.
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
    intro: { fontSize: 14, lineHeight: 20, marginBottom: 20, fontFamily: 'Satoshi-Regular' },

    card: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 16 },
    cardIcon: { width: 56, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    cardTitle: { fontSize: 17, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    cardDesc: { fontSize: 13, lineHeight: 18, fontFamily: 'Satoshi-Regular' },
    countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    countBadgeText: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});
