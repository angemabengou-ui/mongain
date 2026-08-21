import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');

const COLORS = {
    primary: '#1DC5E9',
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

    // mode can be enforced via URL parameter (e.g. ?mode=scanOnly)
    const scanOnly = params.mode === 'scanOnly';
    const intent = params.intent as string;
    const [mode, setMode] = useState<'scan' | 'receive'>(scanOnly ? 'scan' : 'scan');

    // Camera permissions
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);

    useEffect(() => {
        if (!permission?.granted && mode === 'scan') {
            requestPermission();
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
                    router.replace({ pathname: '/agent-action' as any, params: { clientPhone: targetPhone, clientName: targetName, action: 'DEPOSIT' } });
                    return;
                }

                // 2. If User scans a MERCHANT -> Payment OR Withdrawal depending on the QR!
                if (targetRole === 'MERCHANT') {
                    if (isWithdrawalIntent) {
                        router.replace({ pathname: '/client-withdraw-desk', params: { agentPhone: targetPhone, agentName: targetName } });
                    } else {
                        router.push({ pathname: '/transfer-confirm', params: { receiverPhone: targetPhone, receiverName: targetName, isMerchant: 'true' } });
                    }
                    return;
                }

                // 3. If User scans an AGENT -> Withdraw at the Agent's Desk
                if (targetRole === 'AGENT') {
                    // Client initiates a withdrawal by sending digital cash to the Agent
                    router.replace({ pathname: '/client-withdraw-desk', params: { agentPhone: targetPhone, agentName: targetName } });
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
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
                <ActivityIndicator color={COLORS.primary} size="large" />
            </SafeAreaView>
        );
    }

    const qrValue = generateQrData(user.phone, user.name, user.role as string || 'USER');

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                {scanOnly ? null : (
                    <View style={styles.toggleContainer}>
                        <TouchableOpacity
                            style={[styles.toggleBtn, mode === 'scan' && styles.toggleBtnActive]}
                            onPress={() => setMode('scan')}
                        >
                            <Text style={[styles.toggleText, mode === 'scan' && styles.toggleTextActive]}>Scanner</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleBtn, mode === 'receive' && styles.toggleBtnActive]}
                            onPress={() => setMode('receive')}
                        >
                            <Text style={[styles.toggleText, mode === 'receive' && styles.toggleTextActive]}>Recevoir</Text>
                        </TouchableOpacity>
                    </View>
                )}
                <View style={{ width: 28 }} />
            </View>

            {/* Content Mode */}
            <View style={styles.content}>
                {mode === 'scan' ? (
                    <View style={styles.scanContainer}>
                        {!permission ? (
                            <ActivityIndicator color={COLORS.primary} size="large" />
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
                            <View style={styles.cameraFrame}>
                                <CameraView
                                    style={StyleSheet.absoluteFill}
                                    facing="back"
                                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                                    barcodeScannerSettings={{
                                        barcodeTypes: ['qr'],
                                    }}
                                />
                                <View style={styles.scannerOverlay}>
                                    {scanError ? (
                                        <View style={styles.errorBanner}>
                                            <Ionicons name="close-circle" size={22} color="#fff" />
                                            <Text style={styles.errorBannerText}>{scanError}</Text>
                                        </View>
                                    ) : null}
                                    <View style={styles.scanCorners}>
                                        <View style={[styles.corner, styles.topLeft]} />
                                        <View style={[styles.corner, styles.topRight]} />
                                        <View style={[styles.corner, styles.bottomLeft]} />
                                        <View style={[styles.corner, styles.bottomRight]} />
                                    </View>
                                    <Text style={styles.scanInstruction}>
                                        {scanned ? 'Traitement en cours...' :
                                            intent === 'withdraw' ? 'Scanner pour retirer' :
                                                intent === 'deposit' ? 'Scannez le Code du Client pour Déposer' :
                                                    'Placez le code QR dans le cadre pour transférer'
                                        }
                                    </Text>
                                </View>
                            </View>
                        )}
                    </View>
                ) : (
                    <View style={styles.receiveContainer}>
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
                                <QRCode
                                    value={qrValue}
                                    size={width * 0.55}
                                    color="#1a1d2e"
                                    backgroundColor="#ffffff"
                                />
                            </View>

                            <Text style={styles.qrFooterText}>
                                Présentez ce code QR pour recevoir un paiement Mongain
                            </Text>
                        </View>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24,
    },
    backBtn: { padding: 8, marginLeft: -8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 },
    toggleContainer: {
        flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)',
        padding: 4, borderRadius: 24,
    },
    toggleBtn: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20 },
    toggleBtnActive: { backgroundColor: '#ffffff' },
    toggleText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
    toggleTextActive: { color: '#000000' },

    content: { flex: 1 },

    // Scan Mode
    scanContainer: { flex: 1, backgroundColor: '#000' },
    cameraFrame: { flex: 1 },
    scannerOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    scanCorners: { width: width * 0.65, height: width * 0.65, borderColor: COLORS.primary, borderWidth: 1, borderRadius: 16 },
    corner: { position: 'absolute', width: 40, height: 40, borderColor: COLORS.primary },
    topLeft: { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 },
    topRight: { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 },
    bottomLeft: { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 },
    bottomRight: { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 },
    scanInstruction: { color: '#fff', fontSize: 15, fontWeight: '500', textAlign: 'center', marginTop: 32 },
    errorBanner: {
        position: 'absolute', top: 32, left: 20, right: 20,
        backgroundColor: 'rgba(239, 68, 68, 0.92)', borderRadius: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    },
    errorBannerText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
    permissionMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    permissionTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
    permissionSubtitle: { color: '#a0aec0', fontSize: 15, textAlign: 'center', marginBottom: 24, lineHeight: 22 },
    permissionBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 },
    permissionBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    // Receive Mode
    receiveContainer: { flex: 1, padding: 24, justifyContent: 'center' },
    qrCard: {
        backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
        alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
    },
    qrHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24, alignSelf: 'stretch' },
    qrAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center' },
    qrInitials: { fontSize: 18, fontWeight: '800', color: COLORS.primary },
    qrName: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    qrPhone: { fontSize: 14, color: COLORS.textSecondary, marginTop: 2 },
    qrCodeWrapper: { padding: 16, backgroundColor: '#fff', borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: '#f1f5f9' },
    qrFooterText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
