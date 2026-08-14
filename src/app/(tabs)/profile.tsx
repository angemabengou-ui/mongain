import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiGetBalance, apiGetDailyLimits } from '../../services/api';

export default function ProfileScreen() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [balance, setBalance] = useState(user?.wallet?.balance ?? 0);
    const [currency, setCurrency] = useState(user?.wallet?.currency ?? 'FCFA');

    useFocusEffect(
        useCallback(() => {
            apiGetBalance().then(res => {
                if (res && res.balance !== undefined) {
                    setBalance(res.balance);
                    setCurrency(res.currency || 'FCFA');
                }
            }).catch(console.error);
        }, [])
    );

    const [limits, setLimits] = useState<any>(null);
    const [appLockEnabled, setAppLockEnabled] = useState(false);

    useEffect(() => {
        if (user && user.role === 'USER') {
            apiGetDailyLimits().then(data => setLimits(data)).catch(console.error);
        }
        // Charger la préférence AppLock (ON par défaut)
        if (Platform.OS !== 'web') {
            SecureStore.getItemAsync('appLockEnabled').then(val => {
                setAppLockEnabled(val !== 'false');
            }).catch(e => console.log("SecureStore error:", e));
        }
    }, [user]);

    const toggleAppLock = async (value: boolean) => {
        if (Platform.OS === 'web') {
            Alert.alert("Non supporté", "La sécurité renforcée n'est pas supportée sur le Web.");
            return;
        }

        await SecureStore.setItemAsync('appLockEnabled', value ? 'true' : 'false');
        setAppLockEnabled(value);
    };

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

                {/* --- Limits Progress Bar --- */}
                {limits && !limits.skip && (
                    <View style={{ marginHorizontal: 20, marginTop: 15, padding: 18, backgroundColor: COLORS.surface, borderRadius: 16, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textPrimary }}>Plafond Journalier</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: COLORS.textSecondary }}>{(limits.dailySpend / limits.dailyLimit * 100).toFixed(0)}%</Text>
                        </View>
                        <View style={{ width: '100%', height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden' }}>
                            <View style={{ width: `${Math.min(100, (limits.dailySpend / limits.dailyLimit) * 100)}%`, height: '100%', backgroundColor: limits.dailySpend > limits.dailyLimit * 0.8 ? '#ef4444' : '#10b981', borderRadius: 4 }} />
                        </View>
                        <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 8 }}>
                            Dépensé : <Text style={{ fontWeight: 'bold', color: COLORS.textPrimary }}>{limits.dailySpend.toLocaleString('fr-FR')}</Text> / {limits.dailyLimit.toLocaleString('fr-FR')} FCFA
                        </Text>
                        {limits.kycLevel === 0 && (
                            <TouchableOpacity onPress={() => router.push('/profile-edit')} style={{ marginTop: 12, backgroundColor: '#fef3c7', padding: 8, borderRadius: 8 }}>
                                <Text style={{ color: '#d97706', fontSize: 12, fontWeight: '600', textAlign: 'center' }}>+ Débloquer la limite d'envoi jusqu'à 2M (KYC) 🚀</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* Options */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Compte</Text>
                    <MenuItem icon="person-outline" label="Informations personnelles" onPress={() => router.push('/profile-edit')} styles={styles} colors={COLORS} />
                    <MenuItem icon="shield-checkmark-outline" label="Sécurité & PIN" onPress={() => router.push('/pin-change')} styles={styles} colors={COLORS} />
                    <MenuItem icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications' as any)} styles={styles} colors={COLORS} />
                    {/* AppLock Toggle */}
                    <View style={[styles.menuItem, { justifyContent: 'space-between' }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={styles.menuIconWrap}>
                                <Ionicons name="lock-closed-outline" size={20} color={COLORS.primary} />
                            </View>
                            <View style={styles.menuTextWrap}>
                                <Text style={styles.menuLabel}>Verrou Biométrique</Text>
                                <Text style={styles.menuSublabel}>Exiger FaceID à l'ouverture</Text>
                            </View>
                        </View>
                        <Switch
                            value={appLockEnabled}
                            onValueChange={toggleAppLock}
                            trackColor={{ false: '#767577', true: '#208AEF' }}
                            thumbColor={appLockEnabled ? '#fff' : '#f4f3f4'}
                        />
                    </View>
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
