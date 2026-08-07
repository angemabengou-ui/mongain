// @ts-nocheck
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { Transaction, apiGetBalance, apiGetTransactions } from '../../services/api';

const { width } = Dimensions.get('window');

// Removed hardcoded COLORS

function formatAmount(amount: number, currency: string) {
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DashboardScreen() {
  const COLORS = useAppTheme();
  const styles = getStyles(COLORS);

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState('FCFA');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [dailyRevenue, setDailyRevenue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const router = useRouter();
  const { user, logout } = useAuth();

  const loadData = useCallback(async () => {
    try {
      const [walletData, txData] = await Promise.all([
        apiGetBalance(),
        apiGetTransactions(),
      ]);
      setBalance(walletData.balance);
      setCurrency(walletData.currency);

      const todayStr = new Date().toISOString().split('T')[0];
      const todayRev = txData.filter(tx => tx.type === 'incoming' && tx.createdAt.startsWith(todayStr)).reduce((s, tx) => s + tx.amount, 0);
      setDailyRevenue(todayRev);

      setTransactions(txData.slice(0, 3)); // 3 dernières
    } catch (e) {
      // Si le token est invalide, logout
      console.error(e);
    } finally {
      setLoading(false);
      SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => {
    loadData();
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 800,
        useNativeDriver: true,
      }),
    ]).start();
  }, [loadData, fadeAnim, slideAnim]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {/* Header */}
          <View style={styles.headerBackground}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.welcomeText}>Bonjour 👋</Text>
                <Text style={styles.userName}>{user?.name ?? '...'}</Text>
              </View>
              <TouchableOpacity style={styles.headerIcon} onPress={logout}>
                <Ionicons name="log-out-outline" size={24} color={COLORS.textHeader} />
              </TouchableOpacity>
            </View>

            <View style={styles.balanceContainer}>
              <Text style={styles.balanceLabel}>Solde Principal</Text>
              <View style={styles.balanceRow}>
                {loading ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  <>
                    <Text style={styles.balanceAmount}>
                      {balanceVisible ? balance?.toLocaleString('fr-FR') : '••••••••'}
                    </Text>
                    <Text style={styles.currencyText}>{balanceVisible ? ` ${currency}` : ''}</Text>
                  </>
                )}
                <TouchableOpacity style={styles.eyeIcon} onPress={() => setBalanceVisible(!balanceVisible)}>
                  <Ionicons
                    name={balanceVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={24}
                    color={COLORS.textHeader}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Contenu */}
          <View style={styles.contentContainer}>
            {/* Actions */}
            <View style={styles.actionsCard}>
              {user?.role === 'MERCHANT' && (
                <ActionItem icon="qr-code" label="Mon QR Code" color="#F59E0B" onPress={() => router.push('/qr')} styles={styles} />
              )}


              <ActionItem icon="send" label="Transfert" color="#4F46E5" badge="Nouveau" onPress={() => router.push('/transfer')} styles={styles} />
              <ActionItem icon="card" label="Recharger" color="#10B981" onPress={() => router.push('/deposit')} styles={styles} />

              {user?.role === 'AGENT' ? (
                <ActionItem icon="scan" label="Retrait Client" color="#E11D48" onPress={() => router.push('/qr')} styles={styles} />
              ) : user?.role === 'MERCHANT' ? (
                <ActionItem icon="list" label="Transactions" color="#4F46E5" onPress={() => router.push('/history')} styles={styles} />
              ) : (
                <ActionItem icon="wallet" label="Retrait" color="#E11D48" onPress={() => router.push('/withdraw-type')} styles={styles} />
              )}

              {user?.role !== 'AGENT' && user?.role !== 'MERCHANT' && (
                <ActionItem icon="cart" label="Paiement" color="#F59E0B" onPress={() => router.push('/pay-code')} styles={styles} />
              )}
            </View>

            {/* Tableau de Bord Marchand */}
            {user?.role === 'MERCHANT' && (
              <View style={[styles.actionsCard, { marginTop: 16, padding: 20, backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Ionicons name="stats-chart" size={24} color="#D97706" style={{ marginRight: 8 }} />
                  <Text style={{ fontSize: 18, fontWeight: '800', color: '#92400E' }}>Caisse du Jour</Text>
                </View>
                <Text style={{ fontSize: 14, color: '#B45309', marginBottom: 4 }}>Chiffre d'affaires encaissé aujourd'hui</Text>
                <Text style={{ fontSize: 28, fontWeight: '900', color: '#D97706' }}>
                  {formatAmount(dailyRevenue, currency)}
                </Text>
              </View>
            )}

            {/* Scanner */}
            <TouchableOpacity style={styles.scanButton} onPress={() => router.push('/qr')}>
              <Ionicons name="qr-code-outline" size={32} color={COLORS.surface} />
              <Text style={styles.scanButtonText}>Scanner / QR Code</Text>
            </TouchableOpacity>

            {/* Services & Factures (Mini-Programmes) */}
            <View style={styles.serviceSection}>
              <Text style={styles.sectionTitle}>Services & Factures</Text>
              <View style={styles.serviceGrid}>
                <ServiceItem icon="flash" label="Électricité" color="#f59e0b" onPress={() => router.push('/services/electricity')} styles={styles} />
                <ServiceItem icon="phone-portrait" label="Crédit Air" color="#d946ef" onPress={() => Alert.alert('Crédit & Data', 'Rechargez votre crédit bientôt !')} styles={styles} />
                <ServiceItem icon="tv" label="Web TV" color="#3b82f6" onPress={() => Alert.alert('Abonnement TV', 'Le renouvellement Canal+ arrive !')} styles={styles} />
                <ServiceItem icon="lock-closed" label="Tontine" color="#10b981" onPress={() => router.push('/services/tontine')} styles={styles} />
              </View>
            </View>

            {/* Transactions récentes */}
            <View style={styles.transactionsHeader}>
              <Text style={styles.sectionTitle}>Transactions récentes</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/history')}>
                <Text style={styles.seeAllText}>Voir tout</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.transactionList}>
              {loading ? (
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <ActivityIndicator color={COLORS.primary} />
                </View>
              ) : transactions.length === 0 ? (
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <Text style={{ color: COLORS.textSecondary }}>Aucune transaction pour l'instant.</Text>
                </View>
              ) : (
                transactions.map(tx => (
                  <TransactionItem
                    key={tx.id}
                    tx={tx}
                    styles={styles}
                    colors={COLORS}
                    onPress={() => router.push({ pathname: '/receipt', params: { ...tx } })}
                  />
                ))
              )}
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const ActionItem = ({ icon, label, color, badge, onPress, styles }: any) => (
  <TouchableOpacity style={styles.actionItemContainer} activeOpacity={0.7} onPress={onPress}>
    <View style={[styles.actionIconContainer, { backgroundColor: color + '1A' }]}>
      <Ionicons name={icon} size={28} color={color} />
      {badge && (
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
    </View>
    <Text style={styles.actionLabel}>{label}</Text>
  </TouchableOpacity>
);

const ServiceItem = ({ icon, label, color, onPress, styles }: any) => (
  <TouchableOpacity style={styles.serviceItemContainer} activeOpacity={0.7} onPress={onPress}>
    <View style={[styles.serviceIconWrap, { backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={24} color={color} />
    </View>
    <Text style={styles.serviceLabel}>{label}</Text>
  </TouchableOpacity>
);

const TransactionItem = ({ tx, onPress, styles, colors }: any) => {
  const isIncoming = tx.type === 'incoming';
  const typeText = isIncoming ? 'Transfert reçu' : 'Transfert envoyé';

  return (
    <TouchableOpacity style={styles.txContainer} onPress={onPress}>
      <View style={styles.txIconContainer}>
        <View style={[styles.txIconWrapper, { backgroundColor: isIncoming ? '#D1FAE5' : '#FEE2E2' }]}>
          <Ionicons name={isIncoming ? 'arrow-down' : 'arrow-up'} size={20} color={isIncoming ? '#059669' : '#E11D48'} />
        </View>
      </View>
      <View style={styles.txDetails}>
        <Text style={styles.txTitle}>{typeText}</Text>
        <Text style={styles.txName}>{tx.counterpart}</Text>
      </View>
      <View style={styles.txAmountContainer}>
        <Text style={[styles.txAmount, { color: isIncoming ? '#059669' : colors.textPrimary }]}>
          {(isIncoming ? '+ ' : '- ') + formatAmount(tx.amount, tx.currency)}
        </Text>
        <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
};

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.primary },
  container: { flexGrow: 1, backgroundColor: COLORS.background },
  headerBackground: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 70,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
  },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  welcomeText: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  userName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  headerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  balanceContainer: { alignItems: 'center' },
  balanceLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '500', marginBottom: 8 },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  balanceAmount: { color: '#fff', fontSize: 42, fontWeight: '800', letterSpacing: -1 },
  currencyText: { color: '#fff', fontSize: 20, fontWeight: '600', marginLeft: 8 },
  eyeIcon: { marginLeft: 16, padding: 4 },
  contentContainer: { paddingHorizontal: 20, marginTop: -40 },
  actionsCard: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    flexDirection: 'row', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5,
  },
  actionItemContainer: { alignItems: 'center', flex: 1 },
  actionIconContainer: { width: 64, height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  badgeContainer: { position: 'absolute', top: -6, right: -10, backgroundColor: '#FF3B30', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  badgeText: { color: '#FFF', fontSize: 10, fontWeight: 'bold' },
  actionLabel: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  scanButton: {
    backgroundColor: COLORS.textPrimary, borderRadius: 24, marginTop: 24, paddingVertical: 18,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 8,
  },
  scanButtonText: { color: COLORS.surface, fontSize: 18, fontWeight: 'bold', marginLeft: 12 },

  serviceSection: { marginTop: 28 },
  serviceGrid: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3,
    marginTop: 16,
  },
  serviceItemContainer: { alignItems: 'center', width: '22%' },
  serviceIconWrap: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  serviceLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, textAlign: 'center' },

  transactionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary },
  seeAllText: { fontSize: 15, fontWeight: '600', color: COLORS.primary },
  transactionList: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 8, paddingBottom: 24, marginBottom: 32 },
  txContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: COLORS.remaining },
  txIconContainer: { marginRight: 16 },
  txIconWrapper: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  txDetails: { flex: 1 },
  txTitle: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4 },
  txName: { fontSize: 14, color: COLORS.textSecondary },
  txAmountContainer: { alignItems: 'flex-end' },
  txAmount: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  txDate: { fontSize: 12, color: COLORS.textSecondary },
});
