import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { apiGetBalance, apiGetDailyLimits, request } from '../../services/api';

// Refonte : l'ancienne page mettait "Informations personnelles", "Sécurité & PIN",
// "Notifications", "Centre d'aide" et "Conditions d'utilisation" (qui ne menait nulle
// part — aucun onPress) dans deux groupes vagues ("Compte"/"Support") avec exactement
// le même style de carte pour chaque ligne, y compris le Verrou Biométrique qui est
// pourtant un réglage de sécurité et se retrouvait mélangé aux infos de profil. Résultat :
// tout paraissait au même niveau d'importance, sans hiérarchie ni cohérence.
// Regroupement par vraie fonction (Aperçu / Compte / Sécurité / Assistance), avec une
// teinte d'icône propre à chaque groupe pour que la hiérarchie se voie, pas seulement
// se lise. Le QR code intégré ici (généré à la volée, sans le paramètre `action`) a
// aussi été retiré au profit d'un lien vers /receive-qr, seul endroit qui reflète
// correctement les 2 codes distincts d'un marchand (paiement/retrait) — l'ancien
// doublon aurait affiché un troisième code, générique et incohérent avec les deux autres.
export default function ProfileScreen() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const tabBarHeight = useTabBarHeight();

    const [balance, setBalance] = useState(user?.wallet?.balance ?? 0);
    const [currency, setCurrency] = useState(user?.wallet?.currency ?? 'FCFA');
    const [userData, setUserData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [appLockEnabled, setAppLockEnabled] = useState(true);

    const fetchProfileData = async () => {
        try {
            const res = await request('GET', '/api/users/profile', {}, true);
            setUserData(res.user);
            let pointBalance = 0;
            try {
                const lp = await request('GET', '/api/loyalty/balance', {}, true);
                if (lp && lp.points) pointBalance = lp.points;
            } catch (e) {
                // Feature fails silently if endpoint not ready yet
            }
            if (res.user) setUserData({ ...res.user, loyaltyPoints: pointBalance });
        } catch (e: any) {
            console.warn(e);
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(
        useCallback(() => {
            fetchProfileData();
            apiGetBalance().then(res => {
                if (res && res.balance !== undefined) {
                    setBalance(res.balance);
                    setCurrency(res.currency || 'FCFA');
                }
            }).catch(console.error);
        }, [])
    );

    const [limits, setLimits] = useState<any>(null);

    useEffect(() => {
        if (user && user.role === 'USER') {
            apiGetDailyLimits().then(data => setLimits(data)).catch(console.error);
        }
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

    const authName = userData?.name || user?.name;
    const authEmail = userData?.email || user?.email;
    const initials = authName
        ? authName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
        : '??';

    return (
        <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'top']}>
            <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

                <View style={styles.heroHeader}>
                    <View style={styles.headerTop}>
                        <Text style={styles.headerTitle}>Mon Profil</Text>
                        <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/profile-edit')}>
                            <Ionicons name="pencil" size={16} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.avatarSection}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{initials}</Text>
                        </View>
                        <View>
                            <Text style={styles.userName}>{authName ?? '...'}</Text>
                            <Text style={styles.userRole}>{authEmail ?? '...'}</Text>
                        </View>
                    </View>
                </View>

                <View style={[styles.contentContainer, { paddingBottom: tabBarHeight + 40 }]}>


                    <Text style={styles.sectionTitle}>Aperçu</Text>
                    <View style={styles.balanceCard}>
                        <View style={styles.balanceRow}>
                            <Ionicons name="wallet-outline" size={22} color={COLORS.primary} />
                            <Text style={styles.balanceLabel}>Solde du portefeuille</Text>
                        </View>
                        <Text style={styles.balanceAmount}>
                            {balance.toLocaleString('fr-FR')} <Text style={styles.balanceCurrency}>{currency}</Text>
                        </Text>
                    </View>

                    {limits && !limits.skip && (
                        <View style={styles.limitsCard}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Text style={{ fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: COLORS.textPrimary }}>Plafond Journalier</Text>
                                <Text style={{ fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', color: COLORS.textSecondary }}>{(limits.dailySpend / limits.dailyLimit * 100).toFixed(0)}%</Text>
                            </View>
                            <View style={{ width: '100%', height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden' }}>
                                <View style={{ width: `${Math.min(100, (limits.dailySpend / limits.dailyLimit) * 100)}%`, height: '100%', backgroundColor: limits.dailySpend > limits.dailyLimit * 0.8 ? '#ef4444' : '#10b981', borderRadius: 4 }} />
                            </View>
                            <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 8 }}>
                                Dépensé : <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary }}>{limits.dailySpend.toLocaleString('fr-FR')}</Text> / {limits.dailyLimit.toLocaleString('fr-FR')} FCFA
                            </Text>
                        </View>
                    )}

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Compte</Text>
                        <MenuItem icon="person-outline" label="Informations personnelles" onPress={() => router.push('/profile-edit')} styles={styles} tint={COLORS.primary} chevronColor={COLORS.textSecondary} />
                        <MenuItem icon="qr-code-outline" label="Mon code QR" sublabel="Pour recevoir un paiement" onPress={() => router.push('/receive-qr')} styles={styles} tint={COLORS.primary} chevronColor={COLORS.textSecondary} />
                        <MenuItem icon="pie-chart-outline" label="Aperçu des dépenses" sublabel="Vos dépenses par catégorie ce mois-ci" onPress={() => router.push('/insights')} styles={styles} tint={COLORS.primary} chevronColor={COLORS.textSecondary} />
                        <MenuItem icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} styles={styles} tint={COLORS.primary} chevronColor={COLORS.textSecondary} />
                        {/* merchant-hub.tsx est un écran complet et fonctionnel, mais aucun menu
                            ne le liait jamais — même pour les comptes MERCHANT auxquels il est
                            destiné. */}
                        {user?.role === 'MERCHANT' && (
                            <MenuItem icon="storefront-outline" label="Espace Marchand" sublabel="Ventes, commissions et retraits" onPress={() => router.push('/merchant-hub')} styles={styles} tint={COLORS.primary} chevronColor={COLORS.textSecondary} />
                        )}
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Sécurité</Text>
                        <MenuItem icon="shield-checkmark-outline" label="Sécurité & PIN" onPress={() => router.push('/pin-change')} styles={styles} tint={COLORS.warning} chevronColor={COLORS.textSecondary} />
                        <View style={[styles.menuItem, { justifyContent: 'space-between' }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <View style={[styles.menuIconWrap, { backgroundColor: COLORS.warning + '18' }]}>
                                    <Ionicons name="lock-closed-outline" size={20} color={COLORS.warning} />
                                </View>
                                <View style={styles.menuTextWrap}>
                                    <Text style={styles.menuLabel}>Verrou Biométrique</Text>
                                    <Text style={styles.menuSublabel}>Exiger FaceID à l'ouverture</Text>
                                </View>
                            </View>
                            <Switch
                                value={appLockEnabled}
                                onValueChange={toggleAppLock}
                                trackColor={{ false: COLORS.border, true: COLORS.warning + '80' }}
                                thumbColor={appLockEnabled ? COLORS.warning : '#f4f3f4'}
                            />
                        </View>
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Assistance</Text>
                        <MenuItem icon="help-circle-outline" label="Centre d'aide" onPress={() => router.push('/support')} styles={styles} tint={COLORS.textSecondary} chevronColor={COLORS.textSecondary} />
                        <MenuItem
                            icon="document-text-outline"
                            label="Conditions d'utilisation"
                            onPress={() => Alert.alert('Bientôt disponible', "Les conditions d'utilisation seront consultables ici prochainement.")}
                            styles={styles}
                            tint={COLORS.textSecondary}
                            chevronColor={COLORS.textSecondary}
                        />
                        <MenuItem icon="information-circle-outline" label="À propos de Mongain" sublabel="v1.0.0" styles={styles} tint={COLORS.textSecondary} />
                    </View>

                    <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.8}>
                        <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
                        <Text style={styles.logoutText}>Se déconnecter</Text>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

function MenuItem({ icon, label, sublabel, onPress, styles, tint, chevronColor }: any) {
    const content = (
        <>
            <View style={[styles.menuIconWrap, { backgroundColor: tint + '18' }]}>
                <Ionicons name={icon} size={20} color={tint} />
            </View>
            <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{label}</Text>
                {sublabel && <Text style={styles.menuSublabel}>{sublabel}</Text>}
            </View>
            {onPress && <Ionicons name="chevron-forward" size={18} color={chevronColor} />}
        </>
    );

    if (!onPress) {
        return <View style={[styles.menuItem, styles.menuItemStatic]}>{content}</View>;
    }

    return (
        <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={onPress}>
            {content}
        </TouchableOpacity>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    container: { flexGrow: 1, backgroundColor: COLORS.primary },

    heroHeader: {
        backgroundColor: COLORS.primary,
        paddingTop: 40,
        paddingBottom: 36,
        paddingHorizontal: 20,
    },
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    headerTitle: { fontSize: 26, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff', letterSpacing: 0.5 },
    editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },

    avatarSection: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 10 },
    avatar: {
        width: 64, height: 64, borderRadius: 32,
        backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
    },
    avatarText: { fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.primary },
    userName: { fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff' },
    userRole: { fontSize: 14, fontFamily: 'Satoshi-Regular', color: 'rgba(255,255,255,0.7)' },

    contentContainer: {
        flex: 1,
        backgroundColor: COLORS.background,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 20,
        paddingHorizontal: 20,
    },

    balanceCard: {
        backgroundColor: COLORS.primary + '12',
        borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.primary + '30',
    },
    balanceRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
    balanceLabel: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textSecondary },
    balanceAmount: { fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    balanceCurrency: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textSecondary },

    limitsCard: { marginTop: 12, padding: 18, backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border },

    section: { marginTop: 28 },
    sectionTitle: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
    settingValueContainer: { flexDirection: 'row', alignItems: 'center' },
    settingValue: { color: '#ffffff', fontSize: 16, marginRight: 8, fontFamily: 'Satoshi-Regular' },

    rewardsCard: { marginBottom: 32, padding: 24, borderRadius: 24, backgroundColor: 'rgba(245, 158, 11, 0.05)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10 },
    rewardsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    rewardsTitle: { color: '#FCD34D', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    rewardsPoints: { color: '#fff', fontSize: 40, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 4 },
    rewardsSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontFamily: 'Satoshi-Regular', marginBottom: 20 },
    rewardsActions: { flexDirection: 'column', gap: 10 },
    rewardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 16, gap: 8 },
    rewardBtnClaim: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    rewardBtnConvert: { backgroundColor: '#FCD34D' },
    rewardBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase' },

    menuItem: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface, borderRadius: 16, padding: 18,
        marginBottom: 8,
        borderWidth: 1, borderColor: COLORS.border,
    },
    menuItemStatic: { opacity: 0.75 },
    menuIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    menuTextWrap: { flex: 1 },
    menuLabel: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    menuSublabel: { fontSize: 12, fontFamily: 'Satoshi-Regular', color: COLORS.textSecondary, marginTop: 2 },

    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        marginTop: 32,
        backgroundColor: COLORS.error + '12', borderRadius: 16, height: 56, gap: 10,
        borderWidth: 1, borderColor: COLORS.error + '30',
    },
    logoutText: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.error },
});

