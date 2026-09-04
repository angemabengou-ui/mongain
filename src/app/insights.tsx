import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { Transaction, apiGetTransactions } from '../services/api';
import { CATEGORY_INFO, TransactionCategory, getTransactionCategory } from '../utils/transactionLabels';

// Plafond de /api/wallet/transactions (voir wallet.ts, limit max = 100) — cet aperçu porte donc
// sur les transactions les plus RÉCENTES, pas nécessairement sur tout le mois calendaire pour un
// compte très actif qui dépasserait ce volume avant la fin du mois. Assumé et signalé à l'écran
// (sous-titre) plutôt que de prétendre à une exhaustivité que l'API ne garantit pas aujourd'hui —
// un vrai calcul exhaustif nécessiterait un endpoint d'agrégation serveur dédié, hors périmètre
// de cette fonctionnalité.
const HISTORY_FETCH_LIMIT = 100;

interface CategoryTotal {
    category: TransactionCategory;
    total: number;
    count: number;
}

function isSameMonth(iso: string, ref: Date) {
    const d = new Date(iso);
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

export default function InsightsScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await apiGetTransactions(HISTORY_FETCH_LIMIT);
            setTransactions(data);
            setLoadError(null);
        } catch (e: any) {
            // Un échec silencieux (juste console.error) laissait `transactions` à [], donc
            // totalSpent/totalReceived à 0 et la section catégories vide — indiscernable
            // d'un mois réellement sans aucune dépense/recette pour l'utilisateur.
            setLoadError(e.response?.data?.error || e.message || "Impossible de charger l'aperçu des dépenses.");
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const { totalSpent, totalReceived, categories, currency } = useMemo(() => {
        const now = new Date();
        // COMPLETED uniquement : un dépôt Mobile Money encore PENDING (voir wallet.ts) ne
        // représente pas une dépense réellement survenue tant que l'opérateur ne l'a pas
        // confirmé — le compter ici gonflerait le total affiché avant même que l'argent ait
        // effectivement bougé.
        const monthTx = transactions.filter(tx => isSameMonth(tx.createdAt, now) && tx.status === 'COMPLETED');
        const spent = monthTx.filter(tx => tx.type === 'outgoing' && getTransactionCategory(tx) !== 'FEE');
        const received = monthTx.filter(tx => tx.type === 'incoming');

        const byCategory = new Map<TransactionCategory, CategoryTotal>();
        for (const tx of spent) {
            const cat = getTransactionCategory(tx);
            const existing = byCategory.get(cat) || { category: cat, total: 0, count: 0 };
            existing.total += tx.amount;
            existing.count += 1;
            byCategory.set(cat, existing);
        }

        return {
            totalSpent: spent.reduce((s, tx) => s + tx.amount, 0),
            totalReceived: received.reduce((s, tx) => s + tx.amount, 0),
            categories: [...byCategory.values()].sort((a, b) => b.total - a.total),
            currency: transactions[0]?.currency || 'FCFA',
        };
    }, [transactions]);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Aperçu des dépenses</Text>
                <View style={{ width: 32 }} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                </View>
            ) : loadError ? (
                <View style={styles.center}>
                    <Ionicons name="cloud-offline-outline" size={48} color={COLORS.border} />
                    <Text style={[styles.emptyText, { marginTop: 12 }]}>{loadError}</Text>
                    <TouchableOpacity onPress={load} style={{ marginTop: 16 }}>
                        <Text style={{ color: COLORS.primary, fontWeight: '700' }}>Réessayer</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.container}>
                    <View style={styles.summaryRow}>
                        <View style={[styles.summaryCard, { backgroundColor: '#FEE2E2' }]}>
                            <Text style={[styles.summaryLabel, { color: '#B91C1C' }]}>Dépensé ce mois-ci</Text>
                            <Text testID="total-spent-value" style={[styles.summaryValue, { color: '#B91C1C' }]}>{totalSpent.toLocaleString('fr-FR')} {currency}</Text>
                        </View>
                        <View style={[styles.summaryCard, { backgroundColor: '#D1FAE5' }]}>
                            <Text style={[styles.summaryLabel, { color: '#047857' }]}>Reçu ce mois-ci</Text>
                            <Text testID="total-received-value" style={[styles.summaryValue, { color: '#047857' }]}>{totalReceived.toLocaleString('fr-FR')} {currency}</Text>
                        </View>
                    </View>

                    <Text style={styles.sectionTitle}>Répartition des dépenses</Text>
                    <Text style={styles.sectionSubtitle}>
                        Basé sur vos {HISTORY_FETCH_LIMIT} transactions les plus récentes — peut ne pas couvrir tout le mois si vous êtes très actif.
                    </Text>

                    {categories.length === 0 ? (
                        <View style={styles.emptyWrap}>
                            <Ionicons name="pie-chart-outline" size={48} color={COLORS.border} />
                            <Text style={styles.emptyText}>Aucune dépense ce mois-ci pour l'instant.</Text>
                        </View>
                    ) : (
                        categories.map(c => {
                            const info = CATEGORY_INFO[c.category];
                            const pct = totalSpent > 0 ? Math.round((c.total / totalSpent) * 100) : 0;
                            return (
                                <View key={c.category} style={styles.categoryCard}>
                                    <View style={styles.categoryHeaderRow}>
                                        <View style={styles.categoryLabelRow}>
                                            <View style={[styles.categoryIconWrap, { backgroundColor: info.color + '18' }]}>
                                                <Ionicons name={info.icon as any} size={18} color={info.color} />
                                            </View>
                                            <Text style={styles.categoryLabel}>{info.label}</Text>
                                        </View>
                                        <Text style={styles.categoryAmount}>{c.total.toLocaleString('fr-FR')} {currency}</Text>
                                    </View>
                                    <View style={styles.barTrack}>
                                        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: info.color }]} />
                                    </View>
                                    <Text style={styles.categoryMeta}>{pct}% · {c.count} transaction(s)</Text>
                                </View>
                            );
                        })
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
        backgroundColor: COLORS.surface,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', color: COLORS.textPrimary },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    container: { padding: 20, paddingBottom: 40 },
    summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    summaryCard: { flex: 1, borderRadius: 16, padding: 16 },
    summaryLabel: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 6 },
    summaryValue: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    sectionTitle: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', color: COLORS.textPrimary, marginBottom: 4 },
    sectionSubtitle: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 16 },
    emptyWrap: { alignItems: 'center', marginTop: 60 },
    emptyText: { marginTop: 12, fontSize: 14, color: COLORS.textSecondary, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    categoryCard: {
        backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 12,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    },
    categoryHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    categoryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    categoryIconWrap: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    categoryLabel: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: COLORS.textPrimary },
    categoryAmount: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', color: COLORS.textPrimary },
    barTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.border, overflow: 'hidden' },
    barFill: { height: '100%', borderRadius: 4 },
    categoryMeta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 6 },
});

