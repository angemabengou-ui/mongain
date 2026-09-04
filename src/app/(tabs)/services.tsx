import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
            <ScreenHeader title="Tous vos Services" onBack={() => router.push('/(tabs)')} />
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.servicesGridSquares}>
                    <ServiceSquareItem icon="cash" label="Micro-crédit" bgColor="#1E3A8A15" color="#1E3A8A" onPress={() => router.push('/credit')} styles={styles} />
                    <ServiceSquareItem icon="card" label="Paiement x3" bgColor="#F59E0B15" color="#F59E0B" onPress={() => router.push('/bnpl')} styles={styles} />
                    <ServiceSquareItem icon="trending-up" label="Crypto" bgColor="#10B98115" color="#10B981" onPress={() => router.push('/crypto')} styles={styles} />
                    <ServiceSquareItem icon="flash" label="Factures" bgColor="#FFB02015" color="#FFB020" disabled={!appConfig.seegEnabled} onPress={() => router.push('/billers')} styles={styles} />
                    <ServiceSquareItem icon="phone-portrait" label="Recharge" bgColor="#2563FF15" color="#2563FF" onPress={() => router.push('/services/airtime')} styles={styles} />
                    <ServiceSquareItem icon="water" label="Eau" bgColor="#EF444415" color="#EF4444" onPress={() => Alert.alert('Bientôt disponible', "Le paiement des factures d'eau sera bientôt activé.")} styles={styles} />
                    <ServiceSquareItem icon="earth" label="Internat." bgColor="#00C27A15" color="#00C27A" onPress={() => router.push('/remit')} styles={styles} />
                </View>
            </ScrollView>
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
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    scroll: { padding: 20 },
    servicesGridSquares: {
        flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start',
        backgroundColor: isDark ? COLORS.surface : 'transparent',
        borderRadius: 20, padding: isDark ? 20 : 0, gap: 8,
        marginTop: 20
    },
    serviceSquareItem: { alignItems: 'center', width: '22%', marginBottom: 24 },
    actionIconContainer: { width: 64, height: 64, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    actionLabel: { color: COLORS.textPrimary, fontSize: 13, fontFamily: 'Satoshi-SemiBold', textAlign: 'center', fontWeight: 'bold' },
});
