import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { Transaction, apiGetTransactions } from '../../services/api';
import { getTransactionTitle } from '../../utils/transactionLabels';

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
    const tabBarHeight = useTabBarHeight();
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

    // L'écran (tabs) reste monté quand on pousse un écran par-dessus : un useEffect de
    // montage ne rejouait jamais au retour, laissant l'historique figé après une nouvelle
    // opération tant que l'utilisateur ne faisait pas un pull-to-refresh manuel.
    useFocusEffect(
        useCallback(() => {
            loadTransactions();
        }, [loadTransactions])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await loadTransactions();
        setRefreshing(false);
    };

    const filtered = transactions.filter(tx => filter === 'all' || tx.type === filter);

    const handleDownloadPDF = async () => {
        try {
            const tableRows = filtered.map(tx => `
                <tr style="border-bottom:1px solid #e5e7eb;">
                    <td style="padding:10px;text-align:left;">${formatDate(tx.createdAt)}</td>
                    <td style="padding:10px;text-align:left;color:${tx.type === 'incoming' ? '#059669' : '#E11D48'};font-weight:bold;">${tx.type === 'incoming' ? 'Entrant' : 'Sortant'}</td>
                    <td style="padding:10px;text-align:left;">${tx.counterpart}</td>
                    <td style="padding:10px;text-align:left;">${tx.reference || 'Aucune'}</td>
                    <td style="padding:10px;text-align:right;font-weight:bold;">${formatAmount(tx)}</td>
                </tr>
            `).join('');

            const html = `
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 30px; color: #1E293B; }
                      h1 { color: #4F46E5; font-size: 28px; }
                      .header { padding-bottom: 20px; border-bottom: 2px solid #E2E8F0; margin-bottom: 20px; }
                      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                      th { background-color: #F8FAFC; padding: 12px; text-align: left; font-size: 13px; color: #64748B; border-bottom: 2px solid #E2E8F0; }
                    </style>
                  </head>
                  <body>
                      <div class="header">
                          <h1>Mongain.</h1>
                          <p style="font-size: 14px; color: #64748B;text-transform:uppercase;">Relevé Bancaire Mensuel</p>
                          <p style="font-size: 12px;">Édité le ${new Date().toLocaleDateString('fr-FR')}</p>
                      </div>
                      <p><b>Période:</b> Les ${filtered.length} dernières transactions</p>
                      <table>
                          <thead>
                              <tr>
                                  <th>DATE</th>
                                  <th>TYPE</th>
                                  <th>TIERS</th>
                                  <th>RÉFÉRENCE</th>
                                  <th style="text-align:right;">MONTANT</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${tableRows}
                          </tbody>
                      </table>
                  </body>
                </html>
            `;
            const { uri } = await Print.printToFileAsync({ html });
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri);
            }
        } catch (e) {
            console.error('Erreur génération PDF', e);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Historique</Text>
                <TouchableOpacity onPress={handleDownloadPDF} style={{ width: 40, height: 40, backgroundColor: COLORS.primary + '15', borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="download" size={20} color={COLORS.primary} />
                </TouchableOpacity>
            </View>

            <View style={styles.filterContainer}>
                <FilterPill label="Tout" active={filter === 'all'} onPress={() => setFilter('all')} styles={styles} />
                <FilterPill label="Envoyé" active={filter === 'outgoing'} onPress={() => setFilter('outgoing')} styles={styles} />
                <FilterPill label="Reçu" active={filter === 'incoming'} onPress={() => setFilter('incoming')} styles={styles} />
            </View>

            <FlatList
                data={filtered}
                keyExtractor={item => item.id}
                contentContainerStyle={[styles.listContainer, { paddingBottom: tabBarHeight + 20 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
                ListHeaderComponent={() => {
                    if (loading) {
                        return (
                            <View style={{ padding: 50, alignItems: 'center' }}>
                                <ActivityIndicator color={COLORS.primary} size="large" />
                            </View>
                        );
                    }
                    return <Text style={styles.dateSeparator}>Ce mois-ci — {filtered.length} transaction(s)</Text>;
                }}
                ListEmptyComponent={() => {
                    if (!loading && filtered.length === 0) {
                        return (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="receipt-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 12 }} />
                                <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
                            </View>
                        );
                    }
                    return null;
                }}
                renderItem={({ item }) => (
                    <View style={styles.transactionList}>
                        <TransactionItem tx={item} styles={styles} colors={COLORS} />
                    </View>
                )}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
            />
        </SafeAreaView>
    );
}

const FilterPill = ({ label, active, onPress, styles }: any) => (
    <TouchableOpacity style={[styles.filterPill, active && styles.filterPillActive]} onPress={onPress} activeOpacity={0.7}>
        <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </TouchableOpacity>
);

// Le dépôt Mobile Money (PVit) reste 'PENDING' tant que le webhook opérateur n'a pas
// confirmé, et peut finir 'FAILED' (backend/src/routes/webhooks.ts) — sans cet indicateur,
// une demande encore en attente (ou rejetée) apparaissait ici identique à une transaction
// déjà créditée, laissant croire à tort que l'argent était disponible.
function StatusPill({ status, styles }: { status: string; styles: any }) {
    if (status === 'PENDING') {
        return (
            <View style={[styles.statusPill, { backgroundColor: '#F59E0B15' }]}>
                <Text style={[styles.statusPillText, { color: '#F59E0B' }]}>En attente</Text>
            </View>
        );
    }
    if (status === 'FAILED') {
        return (
            <View style={[styles.statusPill, { backgroundColor: '#E11D4815' }]}>
                <Text style={[styles.statusPillText, { color: '#E11D48' }]}>Échoué</Text>
            </View>
        );
    }
    return null;
}

const TransactionItem = ({ tx, styles, colors }: any) => {
    const router = useRouter();
    const title = getTransactionTitle(tx);
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
                <StatusPill status={tx.status} styles={styles} />
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
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
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
        marginBottom: 12
    },
    txContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.remaining },
    txIconContainer: { marginRight: 16 },
    txIconWrapper: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    txDetails: { flex: 1 },
    txTitle: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4 },
    txName: { fontSize: 14, color: COLORS.textSecondary },
    statusPill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
    statusPillText: { fontSize: 11, fontWeight: '700' },
    txAmountContainer: { alignItems: 'flex-end' },
    txAmount: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    txDate: { fontSize: 12, color: COLORS.textSecondary },
    emptyContainer: { padding: 40, alignItems: 'center' },
    emptyText: { color: COLORS.textSecondary, fontSize: 16 },
});
