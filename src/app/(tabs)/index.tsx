import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { Transaction, apiGetBalance, apiGetTransactions, apiGetUnreadCount } from '../../services/api';

const { width } = Dimensions.get('window');

function formatAmount(amount: number, currency: string) {
  return `${amount.toLocaleString('fr-FR')} ${currency}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const diffDays = Math.floor((new Date().getTime() - d.getTime()) / (1000 * 3600 * 24));
  if (diffDays === 0) {
    return `Aujourd'hui, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return `Hier, ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DashboardScreen() {
  const COLORS = useAppTheme();
  // Check if we're technically in "dark mode" for slight style differences
  const isDark = COLORS.background === '#0A0F1C';
  const styles = getStyles(COLORS, isDark);
  const tabBarHeight = useTabBarHeight();

  const [balanceVisible, setBalanceVisible] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState('FCFA');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const router = useRouter();
  const { user, logout, settings } = useAuth();
  const appConfig = { seegEnabled: settings?.seegEnabled ?? true };

  const loadData = useCallback(async () => {
    try {
      const [walletData, txData, unreadData] = await Promise.all([
        apiGetBalance(),
        apiGetTransactions(),
        apiGetUnreadCount()
      ]);
      setBalance(walletData.balance);
      setCurrency(walletData.currency);
      setUnreadCount(unreadData?.count || 0);

      setTransactions(txData.slice(0, 3));
      setLoadError(false);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
      SplashScreen.hideAsync();
    }
  }, []);

  useEffect(() => {
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
  }, [fadeAnim, slideAnim]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'top']}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {/* Header */}
          <View style={styles.headerTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={20} color="#fff" />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.welcomeText}>Bonjour</Text>
                <Text style={styles.userName}>{user?.name ?? 'Ange'}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <TouchableOpacity onPress={() => router.push('/notifications')}>
                <Ionicons name="notifications-outline" size={26} color={COLORS.textPrimary} />
                {unreadCount > 0 && (
                  <View style={styles.notificationBadge}>
                    <Text style={{ color: '#fff', fontSize: 10, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/support')}>
                <Ionicons name="headset-outline" size={26} color={COLORS.textPrimary} />
              </TouchableOpacity>
              {/* Assistant Montia — écran déjà construit et fonctionnel, mais déclaré
                  href:null dans (tabs)/_layout.tsx sans jamais être poussé nulle part :
                  totalement inatteignable avant ce lien. */}
              <TouchableOpacity onPress={() => router.push('/assistant')}>
                <Ionicons name="chatbubble-ellipses-outline" size={26} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.contentContainer, { paddingBottom: tabBarHeight + 40 }]}>
            {/* Balance Card */}
            <View style={styles.balanceCard}>
              <View style={styles.balanceHeader}>
                <Text style={styles.balanceLabel}>Solde principal <Ionicons name="chevron-down" size={12} color="#fff" /></Text>
                <TouchableOpacity onPress={() => setBalanceVisible(!balanceVisible)}>
                  <Ionicons name={balanceVisible ? 'eye-outline' : 'eye-off-outline'} size={20} color="#fff" />
                </TouchableOpacity>
              </View>
              <View style={styles.balanceRow}>
                {loading ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : (
                  <>
                    <Text style={styles.balanceAmount}>
                      {balanceVisible ? balance?.toLocaleString('fr-FR') : '⬢⬢⬢⬢⬢⬢⬢⬢'}
                    </Text>
                    <Text style={styles.currencyText}>{balanceVisible ? ` ${currency}` : ''}</Text>
                  </>
                )}
                <TouchableOpacity onPress={() => loadData()}>
                  <Ionicons name="refresh-outline" size={20} color="#fff" style={{ marginLeft: 16 }} />
                </TouchableOpacity>
              </View>

              <View style={styles.balanceDivider} />
              <TouchableOpacity style={[styles.qrRow, { justifyContent: 'center' }]} onPress={() => router.push('/receive-qr')}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="qr-code-outline" size={18} color="#fff" />
                  <Text style={[styles.qrText, { marginRight: 8 }]}>Mon QR Code (Recevoir)</Text>
                  <Ionicons name="chevron-forward" size={16} color="#fff" />
                </View>
              </TouchableOpacity>
            </View>

            {/* Quick Actions (Actions rapides) */}
            <Text style={styles.sectionTitle}>Actions rapides</Text>
            <View style={styles.actionsCard}>
              <ActionItem icon="paper-plane" label="Envoyer" bgColor="#2563FF15" color="#2563FF" onPress={() => router.push('/transfer')} styles={styles} />
              <ActionItem icon="wallet" label="Recharger" bgColor="#00C27A15" color="#00C27A" onPress={() => router.push('/recharge')} styles={styles} />
              <ActionItem icon="lock-closed" label="Retirer" bgColor="#FFB02015" color="#FFB020" onPress={() => router.push('/withdraw')} styles={styles} />
              <ActionItem icon="card" label="Cartes" bgColor="#7E3AF215" color="#7E3AF2" onPress={() => router.push('/cards')} styles={styles} />
            </View>

            {/* Mon Épargne */}
            <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/epargne-hub')} style={styles.epargneCard}>
              <View style={styles.epargneIconFrame}>
                <Ionicons name="wallet-outline" size={24} color="#7E3AF2" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.epargneTitle}>Mon épargne</Text>
                <Text style={styles.epargneSub}>Caisse commune et tontine, en un seul endroit</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={COLORS.textSecondary} />
            </TouchableOpacity>

            <View style={styles.servicesHeader}>
              <Text style={styles.sectionTitle}>Services & factures</Text>
              <TouchableOpacity><Text style={styles.seeAllText}>Voir tout</Text></TouchableOpacity>
            </View>
            <View style={styles.servicesGridSquares}>
              <ServiceSquareItem icon="flash" label="Factures" bgColor="#FFB02015" color="#FFB020" disabled={!appConfig.seegEnabled} onPress={() => router.push('/billers')} styles={styles} />
              <ServiceSquareItem icon="phone-portrait" label="Recharge" bgColor="#2563FF15" color="#2563FF" onPress={() => router.push('/services/airtime')} styles={styles} />
              <ServiceSquareItem icon="water" label="Eau" bgColor="#EF444415" color="#EF4444" onPress={() => Alert.alert('Bientôt disponible', "Le paiement des factures d'eau sera bientôt activé.")} styles={styles} />
              <ServiceSquareItem icon="earth" label="Internat." bgColor="#00C27A15" color="#00C27A" onPress={() => router.push('/remit')} styles={styles} />
            </View>

            {/* Transactions récentes */}
            <View style={styles.transactionsHeader}>
              <Text style={styles.sectionTitle}>Dernières transactions</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/history')}><Text style={styles.seeAllText}>Voir tout</Text></TouchableOpacity>
            </View>

            <View style={styles.transactionList}>
              {loading ? (
                <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 30 }} />
              ) : transactions.length === 0 ? (
                <Text style={{ color: COLORS.textSecondary, alignSelf: 'center', marginVertical: 30 }}>Aucune transaction.</Text>
              ) : (
                transactions.map(tx => (
                  <TransactionItem key={tx.id} tx={tx} styles={styles} colors={COLORS} onPress={() => router.push({ pathname: '/receipt', params: { ...tx } })} />
                ))
              )}
              {/* Dummy data for preview if user hasn't made transactions */}
              {transactions.length === 0 && !loading && (
                <>
                  <TransactionItem dummy={true} tx={{ id: '1', type: 'outgoing', amount: 25000, currency: 'FCFA', counterpart: 'Transfert à Paul', createdAt: new Date().toISOString(), status: 'SUCCESS' }} styles={styles} colors={COLORS} onPress={() => { }} />
                  <TransactionItem dummy={true} tx={{ id: '2', type: 'incoming', amount: 10000, currency: 'FCFA', counterpart: 'Rechargement', createdAt: new Date(Date.now() - 86400000).toISOString(), status: 'SUCCESS' }} styles={styles} colors={COLORS} onPress={() => { }} />
                  <TransactionItem dummy={true} tx={{ id: '3', type: 'outgoing', amount: 8500, currency: 'FCFA', counterpart: 'Paiement marchand', createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), status: 'SUCCESS' }} styles={styles} colors={COLORS} onPress={() => { }} />
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const ActionItem = ({ icon, label, color, bgColor, onPress, styles }: any) => (
  <TouchableOpacity style={styles.actionItemContainer} activeOpacity={0.7} onPress={onPress}>
    <View style={[styles.actionIconContainer, { backgroundColor: bgColor }]}>
      <Ionicons name={icon} size={24} color={color} />
    </View>
    <Text style={styles.actionLabel}>{label}</Text>
  </TouchableOpacity>
);

const ServiceSquareItem = ({ icon, label, color, bgColor, onPress, styles, disabled }: any) => (
  <TouchableOpacity style={[styles.serviceSquareItem, disabled && { opacity: 0.4 }]} activeOpacity={0.7} onPress={disabled ? undefined : onPress}>
    <View style={[styles.actionIconContainer, { backgroundColor: bgColor }]}>
      <Ionicons name={icon} size={24} color={color} />
    </View>
    <Text style={styles.actionLabel}>{label}</Text>
  </TouchableOpacity>
);

function getTransactionTypeText(tx: any): string {
  const ref: string = tx.reference || '';
  if (ref.startsWith('VAULT_DEP_')) return 'Dépôt Caisse Commune';
  if (ref.startsWith('VAULT_OUT_')) return 'Retrait Caisse Commune';
  if (ref.startsWith('VAULT_VOUCHER_')) return 'Bon Caisse Commune dépensé';
  if (ref.startsWith('TONT_DBT_')) return 'Cotisation Tontine';
  if (ref.startsWith('TONT_PAY_')) return 'Cagnotte Tontine reçue';
  if (ref.startsWith('TONT_EXIT_')) return 'Règlement dette Tontine';
  if (ref.startsWith('MPAYOUT-')) return 'Reversement marchand';
  return tx.counterpart || (tx.type === 'incoming' ? 'Transfert reçu' : 'Transfert envoyé');
}

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

const TransactionItem = ({ tx, dummy, onPress, styles, colors }: any) => {
  const isIncoming = tx.type === 'incoming';
  const typeText = dummy ? tx.counterpart : getTransactionTypeText(tx);

  // Use distinct icons (arrow for transfer, store for merchant, etc)
  let iconName = isIncoming ? 'arrow-down' : 'arrow-up-outline';
  let iconColor = isIncoming ? '#00C27A' : '#2563FF';
  let iconBg = isIncoming ? '#00C27A15' : '#2563FF15';

  if (typeText.toLowerCase().includes('marchand')) {
    iconName = 'storefront';
    iconColor = '#7E3AF2';
    iconBg = '#7E3AF215';
  } else if (typeText.toLowerCase().includes('rechargement')) {
    iconName = 'arrow-down';
    iconColor = '#FFB020';
    iconBg = '#FFB02015';
  }

  return (
    <TouchableOpacity style={styles.txContainer} onPress={onPress}>
      <View style={styles.txIconContainer}>
        <View style={[styles.txIconWrapper, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName as any} size={18} color={iconColor} />
        </View>
      </View>
      <View style={styles.txDetails}>
        <Text style={styles.txTitle}>{typeText}</Text>
        <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
        {/* Perdu lors de la refonte de cet écran : sans lui, un transfert PENDING ou FAILED
            s'affichait identique à un transfert réussi, sans aucun moyen de le distinguer
            depuis l'accueil. */}
        <StatusPill status={tx.status} styles={styles} />
      </View>
      <View style={styles.txAmountContainer}>
        <Text style={[styles.txAmount, { color: isIncoming ? '#00C27A' : colors.textPrimary }]}>
          {(isIncoming ? '+ ' : '- ') + formatAmount(tx.amount, tx.currency)}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const getStyles = (COLORS: ReturnType<typeof useAppTheme>, isDark: boolean) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flexGrow: 1, backgroundColor: COLORS.background },

  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 24,
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#9ca3b5',
    justifyContent: 'center', alignItems: 'center',
  },
  welcomeText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Satoshi-Regular', marginBottom: 2 },
  userName: { color: COLORS.textPrimary, fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
  notificationBadge: {
    position: 'absolute', top: -2, right: -4,
    backgroundColor: '#2563FF', width: 16, height: 16, borderRadius: 8,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: COLORS.background
  },

  contentContainer: { paddingHorizontal: 20 },

  // Balance Card
  balanceCard: {
    backgroundColor: '#2563FF',
    borderRadius: 24,
    padding: 24,
    marginBottom: 32,
    shadowColor: '#2563FF', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  balanceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  balanceLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontFamily: 'Satoshi-Regular' },
  balanceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  balanceAmount: { color: '#fff', fontSize: 36, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
  currencyText: { color: '#fff', fontSize: 18, fontFamily: 'Satoshi-Regular', marginLeft: 8 },
  balanceDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginBottom: 16 },
  qrRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qrText: { color: '#fff', fontSize: 13, fontFamily: 'Satoshi-SemiBold', marginLeft: 8 },

  sectionTitle: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 16 },

  actionsCard: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: isDark ? COLORS.surface : 'transparent',
    borderRadius: 20, padding: isDark ? 20 : 0,
    marginBottom: 24
  },
  actionItemContainer: { alignItems: 'center', width: '22%' },
  actionIconContainer: { width: 56, height: 56, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  actionLabel: { color: COLORS.textPrimary, fontSize: 12, fontFamily: 'Satoshi-Regular', textAlign: 'center' },

  epargneCard: {
    backgroundColor: isDark ? COLORS.surface : '#ffffff',
    borderRadius: 20, padding: 20, flexDirection: 'row', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2,
    marginBottom: 28,
  },
  epargneIconFrame: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#7E3AF215', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  epargneTitle: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 2 },
  epargneSub: { fontSize: 12, fontFamily: 'Satoshi-Regular', color: COLORS.textSecondary },

  servicesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  servicesGridSquares: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start',
    backgroundColor: isDark ? COLORS.surface : 'transparent',
    borderRadius: 20, padding: isDark ? 20 : 0,
    paddingBottom: isDark ? 4 : 0,
    marginBottom: 24,
  },
  serviceSquareItem: { alignItems: 'center', width: '25%', marginBottom: 16 },

  transactionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  seeAllText: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', color: '#2563FF' },

  transactionList: { flex: 1, paddingBottom: 24 },
  txContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  txIconContainer: { marginRight: 14 },
  txIconWrapper: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  txDetails: { flex: 1 },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  txTitle: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', color: COLORS.textPrimary, marginBottom: 2 },
  txDate: { fontSize: 12, fontFamily: 'Satoshi-Regular', color: COLORS.textSecondary },
  txAmountContainer: { alignItems: 'flex-end' },
  txAmount: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});

