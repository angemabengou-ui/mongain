import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { Transaction, apiGetTransactions } from '../../services/api';

// Removed hardcoded COLORS

function formatAmount(tx: Transaction) {
    const prefix = tx.type === 'outgoing' ? '- ' : '+ ';
    return `${prefix}${tx.amount.toLocaleString('fr-FR')} ${tx.currency}`;
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

export default function HistoryScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const [filter, setFilter] = useState<'all' | 'outgoing' | 'incoming'>('all');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadTransactions = useCallback(async () => {
        try {
            const data = await apiGetTransactions();
            setTransactions(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadTransactions(); }, [loadTransactions]);

    const onRefresh = async () => {
        setRefreshing(true);
        await loadTransactions();
        setRefreshing(false);
    };

    const filtered = transactions.filter(tx => filter === 'all' || tx.type === filter);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Historique</Text>
            </View>

            <View style={styles.filterContainer}>
                <FilterPill label="Tout" active={filter === 'all'} onPress={() => setFilter('all')} styles={styles} />
                <FilterPill label="Envoyé" active={filter === 'outgoing'} onPress={() => setFilter('outgoing')} styles={styles} />
                <FilterPill label="Reçu" active={filter === 'incoming'} onPress={() => setFilter('incoming')} styles={styles} />
            </View>

            <ScrollView
                contentContainerStyle={styles.listContainer}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
            >
                {loading ? (
                    <View style={{ padding: 50, alignItems: 'center' }}>
                        <ActivityIndicator color={COLORS.primary} size="large" />
                    </View>
                ) : (
                    <>
                        <Text style={styles.dateSeparator}>Ce mois-ci — {filtered.length} transaction(s)</Text>
                        <View style={styles.transactionList}>
                            {filtered.length === 0 ? (
                                <View style={styles.emptyContainer}>
                                    <Ionicons name="receipt-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 12 }} />
                                    <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
                                </View>
                            ) : (
                                filtered.map(tx => (
                                    <TransactionItem
                                        key={tx.id}
                                        tx={tx}
                                        styles={styles}
                                        colors={COLORS}
                                    />
                                ))
                            )}
                        </View>
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const FilterPill = ({ label, active, onPress, styles }: any) => (
    <TouchableOpacity style={[styles.filterPill, active && styles.filterPillActive]} onPress={onPress} activeOpacity={0.7}>
        <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
);

const TransactionItem = ({ tx, styles, colors }: any) => {
    const router = useRouter();
    const title = tx.type === 'outgoing' ? 'Transfert envoyé' : 'Transfert reçu';
    const amountStr = formatAmount(tx);
    const dateStr = formatDate(tx.createdAt);

    return (
        <TouchableOpacity
            style={styles.txContainer}
            onPress={() => router.push({ pathname: '/receipt', params: { ...tx } })}
        >
            <View style={styles.txIconContainer}>
                <View style={[styles.txIconWrapper, { backgroundColor: tx.type === 'incoming' ? '#D1FAE5' : '#FEE2E2' }]}>
                    <Ionicons name={tx.type === 'incoming' ? 'arrow-down' : 'arrow-up'} size={20} color={tx.type === 'incoming' ? '#059669' : '#E11D48'} />
                </View>
            </View>
            <View style={styles.txDetails}>
                <Text style={styles.txTitle}>{title}</Text>
                <Text style={styles.txName}>{tx.counterpart}</Text>
            </View>
            <View style={styles.txAmountContainer}>
                <Text style={[styles.txAmount, { color: tx.type === 'incoming' ? '#059669' : colors.textPrimary }]}>{amountStr}</Text>
                <Text style={styles.txDate}>{dateStr}</Text>
            </View>
        </TouchableOpacity>
    );
};

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        paddingHorizontal: 20, paddingVertical: 20,
        backgroundColor: COLORS.surface, elevation: 2,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4,
    },
    headerTitle: { color: COLORS.textHeader, fontSize: 24, fontWeight: '800' },
    filterContainer: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.background },
    filterPill: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: COLORS.surface, marginRight: 12, borderWidth: 1, borderColor: '#e2e8f0' },
    filterPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    filterText: { color: COLORS.textSecondary, fontWeight: '600' },
    filterTextActive: { color: '#ffffff' },
    listContainer: { paddingHorizontal: 20, paddingBottom: 40 },
    dateSeparator: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 12, marginTop: 8, marginLeft: 4 },
    transactionList: {
        backgroundColor: COLORS.surface, borderRadius: 24, padding: 8,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3,
    },
    txContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.remaining },
    txIconContainer: { marginRight: 16 },
    txIconWrapper: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    txDetails: { flex: 1 },
    txTitle: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4 },
    txName: { fontSize: 14, color: COLORS.textSecondary },
    txAmountContainer: { alignItems: 'flex-end' },
    txAmount: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    txDate: { fontSize: 12, color: COLORS.textSecondary },
    emptyContainer: { padding: 40, alignItems: 'center' },
    emptyText: { color: COLORS.textSecondary, fontSize: 16 },
});
