import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useRef } from 'react';
import { ActivityIndicator, Alert, Dimensions, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiGetSystemSettings } from '../services/api';

const { width } = Dimensions.get('window');

export default function ReceiveQRScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();
    const viewRef = useRef(null);

    const [merchantAction, setMerchantAction] = React.useState<'pay' | 'withdraw'>('pay');
    const [fees, setFees] = React.useState({ taxP2P: 0.01, taxWithdraw: 0.013 }); // Defaults

    React.useEffect(() => {
        if (user?.role === 'MERCHANT') {
            apiGetSystemSettings().then(data => {
                if (data) setFees({ taxP2P: data.taxP2P, taxWithdraw: data.taxWithdraw });
            }).catch(console.error);
        }
    }, [user]);

    // This is the permanent string we use to route peer-to-peer or merchant reads.
    // If the user is a merchant, we inject '&action=xxx' based on their toggle choice.
    const qrValue = user ? `mongain://user?phone=${encodeURIComponent(user.phone)}&name=${encodeURIComponent(user.name)}&role=${encodeURIComponent(user.role || 'USER')}${user.role === 'MERCHANT' ? '&action=' + merchantAction : ''}` : 'UNKNOWN';

    const handleShare = async () => {
        try {
            // Note for Expo Web/iOS: we are simulating the share for now.
            // Under normal React Native, we would use react-native-view-shot to render the 'card' to image.
            await Share.share({
                message: `Payez-moi sur Mongain ! Voici mon numéro : ${user?.phone} (${user?.name})`,
            });
        } catch (error: any) {
            Alert.alert("Erreur", error.message);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* Simple Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="close" size={32} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Mon QR Code</Text>
                <View style={{ width: 32 }} />
            </View>

            <View style={styles.container}>
                <Text style={styles.instructions}>Faites scanner ce code pour recevoir de l'argent instantanément.</Text>

                {/* The "Printable" Card */}
                <View style={styles.card} ref={viewRef}>
                    <View style={styles.cardTop}>
                        <View style={styles.appBrandRow}>
                            <Ionicons name="wallet" size={24} color="#10B981" />
                            <Text style={styles.brandText}>MONGAIN</Text>
                        </View>
                        <Text style={styles.roleBadge}>{user?.role === 'MERCHANT' ? 'MARCHAND' : 'CLIENT'}</Text>
                    </View>

                    <View style={styles.qrWrapper}>
                        {user ? (
                            <QRCode
                                value={qrValue}
                                size={width * 0.55}
                                color={COLORS.textPrimary}
                                backgroundColor={COLORS.surface}
                                logoBackgroundColor='transparent'
                            />
                        ) : (
                            <ActivityIndicator color={COLORS.primary} />
                        )}
                    </View>

                    <Text style={styles.userName}>{user?.name}</Text>
                    <Text style={styles.userPhone}>{user?.phone}</Text>

                    {user?.role === 'MERCHANT' && (
                        <Text style={styles.merchantDesc}>Commerçant / Partenaire Mongain</Text>
                    )}
                </View>

                {/* Actions */}
                {user?.role === 'MERCHANT' && (
                    <View style={styles.merchantToggleContainer}>
                        <TouchableOpacity
                            style={[styles.merchantToggleBtn, merchantAction === 'pay' && styles.merchantToggleBtnActivePay]}
                            onPress={() => setMerchantAction('pay')}
                        >
                            <Ionicons name="cart-outline" size={20} color={merchantAction === 'pay' ? '#fff' : COLORS.textSecondary} style={{ marginRight: 6 }} />
                            <Text style={[styles.merchantToggleText, merchantAction === 'pay' && styles.merchantToggleTextActive]}>
                                Paiement ({fees.taxP2P * 100}%)
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.merchantToggleBtn, merchantAction === 'withdraw' && styles.merchantToggleBtnActiveWithdraw]}
                            onPress={() => setMerchantAction('withdraw')}
                        >
                            <Ionicons name="cash-outline" size={20} color={merchantAction === 'withdraw' ? '#fff' : COLORS.textSecondary} style={{ marginRight: 6 }} />
                            <Text style={[styles.merchantToggleText, merchantAction === 'withdraw' && styles.merchantToggleTextActive]}>
                                Retrait Cash ({fees.taxWithdraw * 100}%)
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}

                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                    <Ionicons name="share-outline" size={24} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.shareButtonText}>Partager mon Numéro</Text>
                </TouchableOpacity>

                <Text style={styles.tipText}>Astuce : Faites une capture d'écran pour imprimer cette carte !</Text>
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.surface },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
    backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
    container: { flex: 1, paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center' },

    instructions: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 30, paddingHorizontal: 20, lineHeight: 22 },

    card: {
        width: '100%',
        backgroundColor: COLORS.surface, // Clean surface for readability
        borderRadius: 30,
        padding: 30,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 20,
        elevation: 10,
        borderWidth: 1,
        borderColor: COLORS.border,
        marginBottom: 40
    },
    cardTop: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
    appBrandRow: { flexDirection: 'row', alignItems: 'center' },
    brandText: { fontSize: 18, fontWeight: '900', color: '#10B981', marginLeft: 8, letterSpacing: 1 },
    roleBadge: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 1 },

    qrWrapper: { padding: 15, backgroundColor: COLORS.surface, borderRadius: 24, marginBottom: 24 },

    userName: { fontSize: 24, fontWeight: '900', color: COLORS.textPrimary, textAlign: 'center' },
    userPhone: { fontSize: 18, fontWeight: '600', color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, letterSpacing: 2 },
    merchantDesc: { fontSize: 12, color: '#10B981', marginTop: 12, fontWeight: 'bold' },

    shareButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4F46E5', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 20, width: '100%', justifyContent: 'center', marginBottom: 16 },
    shareButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    tipText: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },

    merchantToggleContainer: { flexDirection: 'row', backgroundColor: COLORS.border, borderRadius: 16, padding: 4, width: '100%', marginBottom: 20 },
    merchantToggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12 },
    merchantToggleBtnActivePay: { backgroundColor: '#10B981', shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
    merchantToggleBtnActiveWithdraw: { backgroundColor: '#F59E0B', shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
    merchantToggleText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
    merchantToggleTextActive: { color: '#fff' }
});
