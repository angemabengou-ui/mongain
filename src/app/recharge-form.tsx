import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';

// Aucune intégration réelle avec Airtel/Moov n'existe côté backend (voir
// backend/src/routes/wallet.ts, /pull gardé derrière ENABLE_UNVERIFIED_CARD_TOPUP — sans
// webhook de confirmation opérateur, un dépôt "réussi" restait PENDING pour toujours et le
// wallet n'était jamais crédité). Même traitement que services/airtime|tv|electricity.tsx.
export default function RechargeFormScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { method } = useLocalSearchParams<{ method: string }>();

    const isAirtel = method === 'AIRTEL';
    const providerName = isAirtel ? 'Airtel Money' : method === 'MOOV' ? 'Moov Africa' : 'Compte Mobile';

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Dépôt par {providerName}</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.card}>
                    <View style={{ alignItems: 'center' }}>
                        <View style={[styles.iconWrap, { backgroundColor: '#f59e0b15' }]}>
                            <Ionicons name="construct-outline" size={40} color="#f59e0b" />
                        </View>
                        <Text style={styles.title}>{providerName}</Text>
                        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 12 }]}>
                            Pas encore connecté à {providerName}. Cette fonctionnalité est en cours de déploiement — sans confirmation réelle de l'opérateur, un dépôt ne pourrait jamais créditer votre solde, elle reste désactivée pour ne pas vous laisser croire qu'il a réussi.
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    backButton: { padding: 8, marginLeft: -12 },
    headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
    scroll: { flexGrow: 1, padding: 24, paddingTop: 8 },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
    iconWrap: { backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
    subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
});
