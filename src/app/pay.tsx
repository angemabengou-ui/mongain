import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

export default function PayScreen() {
    const router = useRouter();
    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);

    useEffect(() => {
        if (!permission?.granted) {
            requestPermission();
        }
    }, [permission]);

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
                const targetRole = urlParams.get('role') || 'USER';

                if (!targetPhone) {
                    showError('QR Code invalide : Numéro manquant.');
                    return;
                }

                // Pour "Payer", on accepte les MARCHANDS et les USERS (ex: Chauffeur de Taxi)
                const isMerchantStr = targetRole === 'MERCHANT' ? 'true' : 'false';

                router.replace({
                    pathname: '/transfer-confirm',
                    params: {
                        receiverPhone: targetPhone,
                        receiverName: targetName,
                        isMerchant: isMerchantStr,
                        intent: 'payment'
                    }
                });
            } catch {
                showError("QR Code corrompu.");
            }
        } else {
            showError("Ce QR Code n'est pas un compte Mongain valide.");
        }
    };

    if (!permission) return <View />;
    if (!permission.granted) {
        return (
            <SafeAreaView style={styles.container}>
                <Text style={styles.errorText}>Autorisation de la caméra refusée.</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />

            {/* Header Overlay */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={32} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Effectuer un Paiement</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* QR Focus Frame */}
            <View style={styles.overlay}>
                <View style={styles.focusFrame}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                </View>
                <Text style={styles.instructionText}>
                    Scannez le QR Code pour payer
                </Text>

                {scanError && (
                    <View style={styles.errorBadge}>
                        <Ionicons name="warning" size={20} color="#fff" style={{ marginRight: 8 }} />
                        <Text style={styles.errorTextBadge}>{scanError}</Text>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    errorText: { color: '#fff', textAlign: 'center', marginTop: 100 },
    header: { position: 'absolute', top: 50, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
    backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
    overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    focusFrame: { width: 250, height: 250, borderWidth: 0, borderColor: 'transparent', position: 'relative' },
    corner: { position: 'absolute', width: 40, height: 40, borderColor: '#F59E0B', borderWidth: 4 },
    topLeft: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 16 },
    topRight: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 16 },
    bottomLeft: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 16 },
    bottomRight: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 16 },
    instructionText: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 40, textAlign: 'center', paddingHorizontal: 40 },
    errorBadge: { position: 'absolute', bottom: 100, backgroundColor: '#EF4444', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center' },
    errorTextBadge: { color: '#fff', fontWeight: '700', fontSize: 14 }
});
