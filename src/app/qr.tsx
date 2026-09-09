import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, Animated, Dimensions, StyleSheet,
    Text, TouchableOpacity, View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { apiLookupUser } from '../services/api';

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

export default function QrScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const params = useLocalSearchParams();
    const insets = useSafeAreaInsets();

    // Scanner uniquement : le mode "Mon Code" (générer son propre QR ici) est retiré — il
    // n'était de toute façon plus jamais atteignable (aucun bouton n'appelait plus setMode,
    // resté sur 'scan' en permanence depuis une ancienne refonte), et /receive-qr le
    // remplace correctement depuis (voir profile.tsx) avec un vrai QR par type d'encaissement
    // (paiement/retrait), ce que ce doublon ne distinguait pas.
    const intent = params.intent as string;

    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);

    // Scanner Line Animation
    const scanLineAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!permission?.granted) requestPermission();

        scanLineAnim.setValue(0);
        Animated.loop(
            Animated.sequence([
                Animated.timing(scanLineAnim, { toValue: SCAN_FRAME_SIZE - 4, duration: 1500, useNativeDriver: true }),
                Animated.timing(scanLineAnim, { toValue: 0, duration: 1500, useNativeDriver: true })
            ])
        ).start();
    }, [permission]);

    const [scanError, setScanError] = useState<string | null>(null);

    // Sans ce reset, revenir en arrière depuis transfer-confirm.tsx/client-withdraw-desk.tsx
    // après un scan réussi (router.push, cet écran reste monté dessous) laissait `scanned`
    // bloqué à `true` pour toujours — seule la branche ERREUR du scan le remettait à `false`
    // (après son setTimeout de 3s). onBarcodeScanned devient alors `undefined` en permanence
    // (ligne du CameraView plus bas) : pointer la caméra sur n'importe quel QR, y compris un
    // autre, ne faisait plus rien, sans le moindre message. Remonter le scanner exigeait de
    // quitter et rouvrir complètement cet écran.
    useFocusEffect(useCallback(() => {
        setScanned(false);
        setScanError(null);
    }, []));

    const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
        if (scanned) return;
        setScanned(true);
        setScanError(null);

        const showError = (msg: string) => {
            setScanError(msg);
            setTimeout(() => { setScanError(null); setScanned(false); }, 3000);
        };

        if (data.startsWith('mongain://user')) {
            (async () => {
                try {
                    const qs = data.split('?')[1];
                    const urlParams = new URLSearchParams(qs);
                    const targetPhone = urlParams.get('phone');
                    const qrAction = urlParams.get('action'); // 'pay' or 'withdraw' (added for merchants)

                    if (!targetPhone) {
                        showError('QR Code invalide : Numéro manquant.');
                        return;
                    }

                    // Le nom et le rôle affichés/utilisés pour le routage ne viennent JAMAIS du
                    // contenu brut du QR (contrairement à avant) : n'importe qui peut fabriquer
                    // un QR "mongain://user?phone=<numéro réel>&name=<faux nom de confiance>"
                    // (ex: un autocollant marchand substitué). Le flux de saisie manuelle
                    // (transfer.tsx) vérifie déjà le nom via apiLookupUser avant confirmation —
                    // le scan doit offrir la même garantie : le nom vu sur l'écran de
                    // confirmation appartient réellement à ce numéro, jamais une valeur que
                    // l'attaquant contrôle. L'argent n'aurait de toute façon jamais pu partir
                    // ailleurs que vers ce numéro (revérifié côté serveur), mais sans cette
                    // vérification l'utilisateur pouvait croire payer quelqu'un d'autre que la
                    // personne réellement associée à ce numéro.
                    let verified;
                    try {
                        verified = await apiLookupUser(targetPhone);
                    } catch {
                        showError('Compte introuvable pour ce QR Code.');
                        return;
                    }

                    const targetName = verified.name;
                    const targetRole = verified.role;

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
            })();
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

    return (
        <View style={styles.absoluteFlex}>

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
                        {/* Dimensions numériques explicites (pas StyleSheet.absoluteFill) :
                            la surface de prévisualisation caméra native calcule mal son
                            échelle/centrage quand on lui donne des bornes en flex/pourcentage
                            plutôt que des pixels réels — symptôme classique sur Android
                            (aperçu décentré, mise à l'échelle grossière, cadre qui ne
                            remplit pas tout l'écran). */}
                        <CameraView
                            style={{ position: 'absolute', top: 0, left: 0, width, height }}
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

    // Transparent Cutout Logic
    maskContainer: { ...StyleSheet.absoluteFill },
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
});
