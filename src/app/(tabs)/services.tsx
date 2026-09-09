import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

const { width } = Dimensions.get('window');

export default function ServicesScreen() {
    const COLORS = useAppTheme();
    const isDark = COLORS.background === '#0A0F1C';
    const styles = getStyles(COLORS, isDark);
    const router = useRouter();
    const { settings } = useAuth();
    const appConfig = { seegEnabled: settings?.seegEnabled ?? true };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.headerArea}>
                <ScreenHeader title="Crédit & Investissement" onBack={() => router.push('/(tabs)')} />
            </View>
            <View style={styles.sheetContainer}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.servicesGridSquares}>
                        <ServiceSquareItem icon="cash" label="Micro-crédit" bgColor={isDark ? "#1E3A8A40" : "#1E3A8A15"} color={isDark ? "#81A6FF" : "#1E3A8A"} onPress={() => router.push('/credit')} styles={styles} />
                        <ServiceSquareItem icon="card" label="Paiement x3" bgColor={isDark ? "#F59E0B40" : "#F59E0B15"} color={isDark ? "#FBBF24" : "#F59E0B"} onPress={() => router.push('/bnpl')} styles={styles} />
                        <ServiceSquareItem icon="trending-up" label="Crypto" bgColor={isDark ? "#10B98140" : "#10B98115"} color={isDark ? "#34D399" : "#10B981"} onPress={() => router.push('/crypto')} styles={styles} />
                        {/* backend/src/routes/invest.ts (coffres de staking) existait déjà, entièrement
                            fonctionnel, mais aucun écran mobile n'y menait jamais avant ce bouton. */}
                        <ServiceSquareItem icon="lock-closed" label="Staking" bgColor={isDark ? "#F59E0B40" : "#F59E0B15"} color={isDark ? "#FBBF24" : "#F59E0B"} onPress={() => router.push('/services/invest')} styles={styles} />
                    </View>
                </ScrollView>
            </View>
        </SafeAreaView>
    );
}

const ServiceSquareItem = ({ icon, label, color, bgColor, onPress, styles, disabled }: any) => (
    <TouchableOpacity style={[styles.serviceSquareItem, disabled && { opacity: 0.4 }]} activeOpacity={0.7} onPress={disabled ? undefined : onPress}>
        <View style={[styles.actionIconContainer, { backgroundColor: bgColor }]}>
            <Ionicons name={icon} size={28} color={color} />
        </View>
        <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
);

const getStyles = (COLORS: ReturnType<typeof useAppTheme>, isDark: boolean) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    headerArea: { paddingBottom: 24, paddingTop: 10 },
    sheetContainer: {
        flex: 1,
        backgroundColor: COLORS.background,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        overflow: 'hidden'
    },
    scroll: { padding: 20 },
    servicesGridSquares: {
        flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start',
        backgroundColor: isDark ? COLORS.surface : 'transparent',
        borderRadius: 20, padding: isDark ? 20 : 0, gap: 8,
        marginTop: 10
    },
    serviceSquareItem: { alignItems: 'center', width: '22%', marginBottom: 24 },
    actionIconContainer: { width: 64, height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    actionLabel: { color: COLORS.textPrimary, fontSize: 13, fontFamily: 'Satoshi-SemiBold', textAlign: 'center', fontWeight: 'bold' },
});
