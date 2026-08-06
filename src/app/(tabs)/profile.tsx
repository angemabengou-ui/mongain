import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

export default function ProfileScreen() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const balance = user?.wallet?.balance ?? 0;
    const currency = user?.wallet?.currency ?? 'FCFA';

    const initials = user?.name
        ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '??';

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Mon Profil</Text>
                </View>

                {/* Avatar + nom */}
                <View style={styles.avatarSection}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <Text style={styles.userName}>{user?.name ?? '...'}</Text>
                    <Text style={styles.userPhone}>{user?.phone ?? '...'}</Text>

                    {/* Identity P2P Barcode */}
                    {user?.phone && (
                        <View style={{ marginTop: 20, padding: 10, backgroundColor: '#fff', borderRadius: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 }}>
                            <QRCode
                                value={`mongain://transfer?phone=${encodeURIComponent(user.phone)}&name=${encodeURIComponent(user.name || '')}`}
                                size={120}
                                color="#1a1d2e"
                                backgroundColor="#ffffff"
                            />
                            <Text style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: '#64748b', fontWeight: 'bold' }}>SCAN P2P (MONG-ID)</Text>
                        </View>
                    )}
                </View>

                {/* Carte solde */}
                <View style={styles.balanceCard}>
                    <View style={styles.balanceRow}>
                        <Ionicons name="wallet-outline" size={22} color={COLORS.primary} />
                        <Text style={styles.balanceLabel}>Solde du portefeuille</Text>
                    </View>
                    <Text style={styles.balanceAmount}>
                        {balance.toLocaleString('fr-FR')} <Text style={styles.balanceCurrency}>{currency}</Text>
                    </Text>
                </View>

                {/* Options */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Compte</Text>
                    <MenuItem icon="person-outline" label="Informations personnelles" onPress={() => router.push('/profile-edit')} styles={styles} colors={COLORS} />
                    <MenuItem icon="shield-checkmark-outline" label="Sécurité & PIN" onPress={() => router.push('/pin-change')} styles={styles} colors={COLORS} />
                    <MenuItem icon="notifications-outline" label="Notifications" styles={styles} colors={COLORS} />
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Support</Text>
                    <MenuItem icon="help-circle-outline" label="Centre d'aide" onPress={() => router.push('/support')} styles={styles} colors={COLORS} />
                    <MenuItem icon="document-text-outline" label="Conditions d'utilisation" styles={styles} colors={COLORS} />
                    <MenuItem icon="information-circle-outline" label="À propos de Mongain" sublabel="v1.0.0" styles={styles} colors={COLORS} />
                </View>

                {/* Déconnexion */}
                <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.8}>
                    <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
                    <Text style={styles.logoutText}>Se déconnecter</Text>
                </TouchableOpacity>

            </ScrollView>
        </SafeAreaView>
    );
}

function MenuItem({ icon, label, sublabel, onPress, styles, colors }: any) {
    return (
        <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={onPress}>
            <View style={styles.menuIconWrap}>
                <Ionicons name={icon} size={20} color={colors.primary} />
            </View>
            <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{label}</Text>
                {sublabel && <Text style={styles.menuSublabel}>{sublabel}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    container: { paddingBottom: 40 },
    header: {
        paddingHorizontal: 20, paddingVertical: 20,
        backgroundColor: COLORS.surface, elevation: 2,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4,
    },
    headerTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },

    avatarSection: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 },
    avatar: {
        width: 90, height: 90, borderRadius: 45,
        backgroundColor: COLORS.primary + '20',
        borderWidth: 3, borderColor: COLORS.primary,
        justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    },
    avatarText: { fontSize: 30, fontWeight: '800', color: COLORS.primary },
    userName: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 4 },
    userPhone: { fontSize: 15, color: COLORS.textSecondary },

    balanceCard: {
        marginHorizontal: 20, backgroundColor: COLORS.primary + '12',
        borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.primary + '30',
    },
    balanceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
    balanceLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
    balanceAmount: { fontSize: 32, fontWeight: '800', color: COLORS.textPrimary },
    balanceCurrency: { fontSize: 18, fontWeight: '600', color: COLORS.textSecondary },

    section: { marginTop: 28, marginHorizontal: 20 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
    menuItem: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface, borderRadius: 16, padding: 18,
        marginBottom: 8,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2,
    },
    menuIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.primary + '15', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    menuTextWrap: { flex: 1 },
    menuLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary },
    menuSublabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginHorizontal: 20, marginTop: 32,
        backgroundColor: COLORS.error + '12', borderRadius: 16, height: 56, gap: 10,
        borderWidth: 1, borderColor: COLORS.error + '30',
    },
    logoutText: { fontSize: 16, fontWeight: '700', color: COLORS.error },
});
