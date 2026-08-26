import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { Transaction, apiGetBalance, apiGetMerchantStats, apiGetTransactions } from '../../services/api';

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
  const [merchantStats, setMerchantStats] = useState<{ todaySalesAmount: number; todayCommission: number; allTimeCommission: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  const router = useRouter();
  // `settings` (taux, seuils, activation SEEG/Tontine) est déjà chargé une fois par
  // AuthContext au démarrage et à chaque connexion — le refaire ici à chaque focus de
  // cet onglet (l'écran le plus visité de l'app) doublait un appel réseau identique à
  // chaque retour sur l'accueil, sans jamais changer entre deux ouvertures de session.
  const { user, logout, settings } = useAuth();
  const appConfig = { seegEnabled: settings?.seegEnabled ?? true, tontineEnabled: settings?.tontineEnabled ?? true };

  const loadData = useCallback(async () => {
    try {
      const [walletData, txData] = await Promise.all([
        apiGetBalance(),
        apiGetTransactions(),
      ]);
      setBalance(walletData.balance);
      setCurrency(walletData.currency);

      setTransactions(txData.slice(0, 3)); // 3 dernières
      setLoadError(false);

      // Ventes ET commissions réelles via l'agrégat serveur dédié — l'ancien calcul
      // recomposait juste le CA du jour côté client depuis la liste générique de
      // transactions, sans jamais isoler ni afficher la commission du marchand.
      if (user?.role === 'MERCHANT') {
        const stats = await apiGetMerchantStats();
        setMerchantStats(stats);
      }
    } catch (e) {
      // Un échec réseau (hors ligne au lancement, ex.) laissait `balance` à `null`
      // indéfiniment, sans aucun message — l'écran affichait juste "FCFA" sous "Solde
      // Principal", sans indiquer qu'il fallait réessayer (contrairement à withdraw.tsx).
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
      SplashScreen.hideAsync();
    }
  }, [user?.role]);

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

  // L'écran (tabs) reste monté quand on pousse un écran par-dessus (transfer-confirm,
  // withdraw, etc.) : un simple useEffect de montage ne rejouait donc jamais au retour,
  // laissant le solde affiché figé après une opération financière réussie.
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
              {!loading && loadError && (
                <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>
                  Solde non actualisé — tirez vers le bas pour réessayer.
                </Text>
              )}
            </View>

            {/* Quick Access QR Button */}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff25', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 30, alignSelf: 'center', marginTop: 16 }}
              onPress={() => router.push('/receive-qr' as any)}
            >
              <Ionicons name="qr-code" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Mon QR Code (Recevoir)</Text>
            </TouchableOpacity>

          </View>

          {/* Contenu */}
          <View style={styles.contentContainer}>
            {/* Actions */}
            <View style={styles.actionsCard}>
              <ActionItem icon="send" label="Envoyer" color="#4F46E5" onPress={() => router.push('/transfer')} styles={styles} />
              <ActionItem icon="scan" label="Scan & Payer" color="#F59E0B" onPress={() => router.push('/qr?mode=scanOnly&intent=pay')} styles={styles} />
              <ActionItem icon="card" label="Recharger" color="#10B981" onPress={() => router.push('/recharge' as any)} styles={styles} />
              <ActionItem icon="wallet" label="Retrait" color="#E11D48" onPress={() => router.push('/withdraw' as any)} styles={styles} />

              {user?.role === 'AGENT' && (
                <ActionItem icon="business" label="Guichet" color="#059669" onPress={() => router.push('/qr?mode=scanOnly')} styles={styles} />
              )}
              {user?.role === 'MERCHANT' && (
                <ActionItem icon="qr-code" label="Mon QR Code" color="#8B5CF6" onPress={() => router.push('/qr')} styles={styles} />
              )}
            </View>

            {/* Tableau de Bord Marchand */}
            {user?.role === 'MERCHANT' && merchantStats && (
              <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/merchant-hub' as any)} style={[styles.actionsCard, { marginTop: 16, padding: 20, backgroundColor: '#FEF3C7', borderColor: '#F59E0B' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="stats-chart" size={24} color="#D97706" style={{ marginRight: 8 }} />
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#92400E' }}>Caisse du Jour</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#B45309', marginRight: 2 }}>Mon Commerce</Text>
                    <Ionicons name="chevron-forward" size={16} color="#B45309" />
                  </View>
                </View>
                <Text style={{ fontSize: 14, color: '#B45309', marginBottom: 4 }}>Chiffre d'affaires encaissé aujourd'hui</Text>
                <Text style={{ fontSize: 28, fontWeight: '900', color: '#D97706', marginBottom: 16 }}>
                  {formatAmount(merchantStats.todaySalesAmount, currency)}
                </Text>
                <View style={{ height: 1, backgroundColor: '#FDE68A', marginBottom: 16 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ fontSize: 13, color: '#B45309', marginBottom: 4 }}>Commission du jour</Text>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#92400E' }}>
                      {formatAmount(merchantStats.todayCommission, currency)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 13, color: '#B45309', marginBottom: 4 }}>Commission totale</Text>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: '#92400E' }}>
                      {formatAmount(merchantStats.allTimeCommission, currency)}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}

            {/* Services & Factures (Mini-Programmes) */}
            <View style={styles.serviceSection}>
              <Text style={styles.sectionTitle}>Services & Factures</Text>
              <View style={styles.serviceGrid}>
                <ServiceItem icon="flash" label="Électricité" color="#F59E0B" disabled={!appConfig.seegEnabled} onPress={() => router.push('/services/electricity' as any)} styles={styles} />

                <ServiceItem icon="phone-portrait" label="Crédit Air" color="#D946EF" onPress={() => router.push('/services/airtime' as any)} styles={styles} />

                <ServiceItem icon="tv" label="Abo TV" color="#3B82F6" onPress={() => router.push('/services/tv' as any)} styles={styles} />

                <ServiceItem icon="lock-closed" label="Tontine" color="#10B981" disabled={!appConfig.tontineEnabled} onPress={() => router.push('/services/tontine' as any)} styles={styles} />

                <ServiceItem icon="shield-checkmark" label="Caisses" color="#F59E0B" onPress={() => router.push('/services/vaults' as any)} styles={styles} />
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
                    onPress={() => router.push({ pathname: '/receipt' as any, params: { ...tx } })}
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

const ServiceItem = ({ icon, label, color, onPress, styles, disabled }: any) => {
  const handlePress = () => {
    if (disabled) {
      import('react-native').then(({ Alert }) => Alert.alert('Service Indisponible', 'Ce programme est temporairement suspendu par notre administration.'));
      return;
    }
    onPress();
  };
  return (
    <TouchableOpacity style={[styles.serviceItemContainer, disabled && { opacity: 0.4 }]} activeOpacity={0.7} onPress={handlePress}>
      <View style={[styles.serviceIconWrap, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={24} color={color} />
      </View>
      <Text style={styles.serviceLabel}>{label}</Text>
    </TouchableOpacity>
  );
};

// Voir (tabs)/history.tsx : un dépôt Mobile Money (PVit) reste 'PENDING' jusqu'à
// confirmation webhook et peut finir 'FAILED' — sans indicateur, il paraissait ici
// identique à une transaction déjà créditée.
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
        <StatusPill status={tx.status} styles={styles} />
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
    paddingBottom: 64,
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
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 24, paddingVertical: 32,
    flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 24,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1,
  },
  actionItemContainer: { alignItems: 'center', width: '22%' },
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
    flexDirection: 'row', justifyContent: 'flex-start', flexWrap: 'wrap', rowGap: 16, columnGap: 16,
    backgroundColor: COLORS.surface, borderRadius: 20, padding: 18,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1,
    marginTop: 16,
  },
  serviceItemContainer: { alignItems: 'center', width: '21%' },
  serviceIconWrap: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  serviceLabel: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary, textAlign: 'center' },

  transactionsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, marginBottom: 16 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: COLORS.textPrimary },
  seeAllText: { fontSize: 15, fontWeight: '600', color: COLORS.primary },
  transactionList: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 8, paddingBottom: 24, marginBottom: 32, borderWidth: 1, borderColor: COLORS.border },
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
});
