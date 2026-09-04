import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Animated, Dimensions, StyleSheet,
    Text, TouchableOpacity, View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';

const { width, height } = Dimensions.get('window');
const SCAN_FRAME_SIZE = width * 0.65;

// Palette volontairement statique et sombre (pas de useAppTheme) : c'est un écran caméra
// (viseur QR), le fond doit rester sombre pour le contraste quel que soit le thème système
// du téléphone — comme la caméra d'Instagram/WhatsApp. Seule la teinte primaire suit
// l'identité de marque.
const COLORS = {
    primary: '#60A5FA',
    background: '#1a1d2e',
    surface: '#ffffff',
    textPrimary: '#ffffff',
    textSecondary: '#a0aec0',
};

// Data encoded in the Universal QR Code
// Format: mongain://user?phone=...&name=...&role=...
function generateQrData(phone: string, name: string, role: string) {
    const encodedPhone = encodeURIComponent(phone);
    const encodedName = encodeURIComponent(name);
    const encodedRole = encodeURIComponent(role || 'USER');
    return `mongain://user?phone=${encodedPhone}&name=${encodedName}&role=${encodedRole}`;
}

export default function QrScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const params = useLocalSearchParams();
    const insets = useSafeAreaInsets();

    const scanOnly = params.mode === 'scanOnly';
    const intent = params.intent as string;
    const [mode, setMode] = useState<'scan' | 'receive'>(scanOnly ? 'scan' : 'scan');

    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);

    // Scanner Line Animation
    const scanLineAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!permission?.granted && mode === 'scan') requestPermission();

        if (mode === 'scan') {
            scanLineAnim.setValue(0);
            Animated.loop(
                Animated.sequence([
                    Animated.timing(scanLineAnim, { toValue: SCAN_FRAME_SIZE - 4, duration: 1500, useNativeDriver: true }),
                    Animated.timing(scanLineAnim, { toValue: 0, duration: 1500, useNativeDriver: true })
                ])
            ).start();
        } else {
            scanLineAnim.stopAnimation();
        }
    }, [mode, permission]);

    const [scanError, setScanError] = useState<string | null>(null);

    const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
        if (scanned) return;
        setScanned(true);
        setScanError(null);

        const showError = (msg: string) => {
            setScanError(msg);
            setTimeout(() => { setScanError(null); setScanned(false); }, 3000);
        };

        if (data.startsWith('mongain://user')) {
            try {
                const qs = data.split('?')[1];
                const urlParams = new URLSearchParams(qs);
                const targetPhone = urlParams.get('phone');
                const targetName = urlParams.get('name') || targetPhone;
                const targetRole = urlParams.get('role');
                const qrAction = urlParams.get('action'); // 'pay' or 'withdraw' (added for merchants)

                if (!targetPhone) {
                    showError('QR Code invalide : Numéro manquant.');
                    return;
                }

                // --- UNIVERSAL DISPATCHER LOGIC --- //

                // Un retrait ne peut se faire qu'auprès d'un Agent : si l'utilisateur est entré
                // dans le scanner spécifiquement pour retirer (?intent=withdraw) mais que le QR
                // scanné n'appartient pas à un Agent, on refuse plutôt que de basculer
                // silencieusement vers un transfert P2P classique (qui enverrait de l'argent au
                // lieu d'en retirer — voir withdraw.tsx qui pointe ici avec intent=withdraw).
                // Un retrait ne peut se faire qu'auprès d'un Agent ou d'un Marchand :
                // si l'intent explicite est withdraw OR si le QR scanné contient action=withdraw.
                const isWithdrawalIntent = intent === 'withdraw' || qrAction === 'withdraw';
                if (isWithdrawalIntent && targetRole !== 'AGENT' && targetRole !== 'MERCHANT') {
                    showError("Vous ne pouvez retirer de l'argent qu'auprès d'un Agent ou d'un Marchand.");
                    return;
                }

                // 1. If scanned by an AGENT -> Agent wants to deposit digital money to Client!
                if (user?.role === 'AGENT') {
                    if (targetRole === 'AGENT') {
                        showError("Un Agent ne peut pas scanner un autre Agent au guichet.");
                        return;
                    }
                    // Goto universal agent dashboard to handle the client (Deposit)
                    router.replace({ pathname: '/agent-action', params: { clientPhone: targetPhone, clientName: targetName, action: 'DEPOSIT' } });
                    return;
                }

                // 2. If User scans a MERCHANT -> Payment OR Withdrawal depending on the QR!
                if (targetRole === 'MERCHANT') {
                    if (isWithdrawalIntent) {
                        // `agentRole` : sans lui, l'écran de retrait appliquait toujours la
                        // formule Agent (seuil + taux marginal) même face à un Marchand, qui a
                        // sa propre formule (taux plein dès le premier franc, sans seuil) —
                        // affichant "GRATUIT" alors que le serveur facture réellement.
                        router.replace({ pathname: '/client-withdraw-desk', params: { agentPhone: targetPhone, agentName: targetName, agentRole: targetRole } });
                    } else {
                        router.push({ pathname: '/transfer-confirm', params: { receiverPhone: targetPhone, receiverName: targetName, isMerchant: 'true' } });
                    }
                    return;
                }

                // 3. If User scans an AGENT -> Withdraw at the Agent's Desk
                if (targetRole === 'AGENT') {
                    // Client initiates a withdrawal by sending digital cash to the Agent
                    router.replace({ pathname: '/client-withdraw-desk', params: { agentPhone: targetPhone, agentName: targetName, agentRole: targetRole } });
                    return;
                }

                // 4. Default: User scans a User -> P2P Transfer
                router.push({ pathname: '/transfer-confirm', params: { receiverPhone: targetPhone, receiverName: targetName, isMerchant: 'false' } });

            } catch (e) {
                showError('Le QR Code est corrompu ou illisible.');
            }
        } else {
            showError("Ce QR Code n'est pas reconnu par le réseau Mongain.");
        }
    };

    if (!user) {
        return (
            <SafeAreaView style={[styles.absoluteFlex, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={COLORS.primary} size="large" />
            </SafeAreaView>
        );
    }

    const qrValue = generateQrData(user.phone, user.name, user.role as string || 'USER');

    return (
        <View style={styles.absoluteFlex}>

            {/* The background is always dark for scan, but we want a fluid view. */}
            <View style={styles.absoluteFlex}>
                {mode === 'scan' ? (
                    <View style={styles.absoluteFlex}>
                        {!permission ? (
                            <View style={styles.centerAll}><ActivityIndicator color={COLORS.primary} size="large" /></View>
                        ) : !permission.granted ? (
                            <View style={styles.permissionMessage}>
                                <Ionicons name="camera-outline" size={48} color="#fff" style={{ marginBottom: 16 }} />
                                <Text style={styles.permissionTitle}>Caméra désactivée</Text>
                                <Text style={styles.permissionSubtitle}>Autorisez l'appareil photo pour scanner un code QR.</Text>
                                <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
                                    <Text style={styles.permissionBtnText}>Autoriser</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.absoluteFlex}>
                                <CameraView
                                    style={StyleSheet.absoluteFill}
                                    facing="back"
                                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                                />

                                {/* PURE CUTOUT MASK (No blurring the center) */}
                                <View style={styles.maskContainer}>
                                    <View style={styles.maskTopBottom} />
                                    <View style={styles.maskCenterRow}>
                                        <View style={styles.maskLeftRight} />
                                        <View style={styles.cutoutFrame}>
                                            <View style={[styles.corner, styles.topLeft]} />
                                            <View style={[styles.corner, styles.topRight]} />
                                            <View style={[styles.corner, styles.bottomLeft]} />
                                            <View style={[styles.corner, styles.bottomRight]} />
                                            <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineAnim }] }]} />
                                        </View>
                                        <View style={styles.maskLeftRight} />
                                    </View>
                                    <View style={[styles.maskTopBottom, { justifyContent: 'flex-start', paddingTop: 40 }]}>
                                        <Text style={styles.scanInstruction}>
                                            {scanned ? 'Traitement en cours...' :
                                                intent === 'withdraw' ? 'Scanner pour retirer' :
                                                    intent === 'deposit' ? 'Scannez le Code du Client pour Déposer' :
                                                        'Placez le code QR dans le cadre'
                                            }
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}
                    </View>
                ) : (
                    <View style={styles.receiveWrapper}>
                        <View style={styles.qrCard}>
                            <View style={styles.qrHeader}>
                                <View style={styles.qrAvatar}>
                                    <Text style={styles.qrInitials}>
                                        {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                    </Text>
                                </View>
                                <View>
                                    <Text style={styles.qrName}>{user.name}</Text>
                                    <Text style={styles.qrPhone}>{user.phone}</Text>
                                </View>
                            </View>

                            <View style={styles.qrCodeWrapper}>
                                <QRCode value={qrValue} size={width * 0.55} color="#1a1d2e" backgroundColor="#ffffff" />
                            </View>

                            <Text style={styles.qrFooterText}>Présentez ce code QR pour recevoir un paiement Mongain</Text>
                        </View>
                    </View>
                )}
            </View>

            {/* ERROR BANNER (Floating) */}
            {scanError && (
                <View style={[styles.errorBanner, { top: insets.top + 70 }]}>
                    <Ionicons name="close-circle" size={22} color="#fff" />
                    <Text style={styles.errorBannerText}>{scanError}</Text>
                </View>
            )}

            {/* FLOATING HEADER */}
            <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
                <View style={styles.floatingHeader}>
                    <TouchableOpacity style={styles.floatingBackBtn} onPress={() => router.back()}>
                        <Ionicons name="close" size={26} color="#fff" />
                    </TouchableOpacity>

                    <View style={{ width: 44 }} />
                </View>
            </SafeAreaView>

        </View>
    );
}

const styles = StyleSheet.create({
    absoluteFlex: { flex: 1, backgroundColor: COLORS.background },
    centerAll: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // Floating Navigation Header
    floatingHeaderArea: { position: 'absolute', top: 0, left: 0, right: 0 },
    floatingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
    floatingBackBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    floatingTogglePill: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)', padding: 4, borderRadius: 30, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    toggleBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 26 },
    toggleBtnActive: { backgroundColor: '#ffffff', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
    toggleText: { color: '#ffffff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 13 },
    toggleTextActive: { color: '#000000', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    // Transparent Cutout Logic
    maskContainer: { ...StyleSheet.absoluteFillObject },
    maskTopBottom: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center' },
    maskCenterRow: { flexDirection: 'row', height: SCAN_FRAME_SIZE },
    maskLeftRight: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
    cutoutFrame: { width: SCAN_FRAME_SIZE, height: SCAN_FRAME_SIZE, backgroundColor: 'transparent', position: 'relative' },

    // Borders & Scanner Animation
    scanLine: { position: 'absolute', left: 4, right: 4, top: 0, height: 3, backgroundColor: COLORS.primary, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 5 },
    corner: { position: 'absolute', width: 40, height: 40, borderColor: COLORS.primary },
    topLeft: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 20 },
    topRight: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 20 },
    bottomLeft: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 20 },
    bottomRight: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 20 },
    scanInstruction: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', textAlign: 'center', opacity: 0.9 },

    // Status & Error
    errorBanner: { position: 'absolute', left: 20, right: 20, backgroundColor: 'rgba(239, 68, 68, 0.95)', borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, zIndex: 100, shadowColor: '#ef4444', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 },
    errorBannerText: { color: '#fff', fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', flex: 1 },

    // Permissions
    permissionMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: COLORS.background },
    permissionTitle: { color: '#fff', fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 12 },
    permissionSubtitle: { color: '#a0aec0', fontSize: 15, textAlign: 'center', marginBottom: 30, lineHeight: 22, fontFamily: 'Satoshi-Regular' },
    permissionBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 40, paddingVertical: 16, borderRadius: 20, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6 },
    permissionBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    // Receive Mode
    receiveWrapper: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: COLORS.background },
    qrCard: { backgroundColor: COLORS.surface, borderRadius: 32, padding: 28, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.25, shadowRadius: 30, elevation: 15 },
    qrHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28, alignSelf: 'stretch', backgroundColor: '#f8f9fa', padding: 16, borderRadius: 20 },
    qrAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
    qrInitials: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff' },
    qrName: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    qrPhone: { fontSize: 14, fontFamily: 'Satoshi-Regular', color: COLORS.textSecondary, marginTop: 2 },
    qrCodeWrapper: { padding: 20, backgroundColor: '#fff', borderRadius: 24, marginBottom: 28, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 4 },
    qrFooterText: { color: COLORS.textSecondary, fontSize: 14, fontFamily: 'Satoshi-Regular', textAlign: 'center', lineHeight: 22 },
});
