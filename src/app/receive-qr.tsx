import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiGetSystemSettings } from '../services/api';

const { width } = Dimensions.get('window');
const QR_SIZE = width * 0.5;

type QrCardDef = { key: 'pay' | 'withdraw' | 'default'; label: string; value: string; accent: string; feeLabel?: string };

export default function ReceiveQRScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [fees, setFees] = React.useState({ taxP2P: 0.01, taxWithdraw: 0.013 }); // Defaults
    // Ces valeurs par défaut ne sont QUE le repli initial le temps du premier chargement —
    // sans ce marqueur, un échec de l'unique tentative (réseau, serveur endormi) laissait le
    // marchand afficher/imprimer indéfiniment un taux par défaut possiblement périmé si
    // l'admin avait changé taxP2P/taxWithdraw depuis, sans jamais être prévenu que le
    // chargement avait échoué.
    const [feesConfirmed, setFeesConfirmed] = useState(false);
    const [printing, setPrinting] = useState(false);
    // Un ref par code (clé = QrCardDef.key) — react-native-qrcode-svg expose toDataURL()
    // sur ce ref pour extraire l'image en base64 au moment d'imprimer, voir handlePrint.
    const qrRefs = useRef<Record<string, any>>({});

    const loadFees = React.useCallback(() => {
        if (user?.role !== 'MERCHANT') return;
        apiGetSystemSettings().then(data => {
            if (data) {
                setFees({ taxP2P: data.taxP2P, taxWithdraw: data.taxWithdraw });
                setFeesConfirmed(true);
            }
        }).catch(console.error);
    }, [user]);

    React.useEffect(() => { loadFees(); }, [loadFees]);

    const baseValue = user ? `mongain://user?phone=${encodeURIComponent(user.phone)}&name=${encodeURIComponent(user.name)}&role=${encodeURIComponent(user.role || 'USER')}` : 'UNKNOWN';

    // Un marchand a deux codes distincts et permanents — un pour encaisser un paiement
    // (taxP2P), un pour un retrait cash au comptoir (taxWithdraw) — plutôt qu'un seul code
    // dont la valeur changeait selon un bouton à activer avant chaque scan. L'ancien
    // fonctionnement imposait de toucher l'écran avant chaque client et empêchait
    // d'afficher (ou d'imprimer) les deux en même temps, par ex. sur une affiche comptoir.
    // "(non confirmé)" tant que /api/settings n'a jamais répondu avec succès : sans ce
    // marqueur, un échec réseau/serveur endormi laissait afficher — et potentiellement
    // IMPRIMER sur une affiche comptoir — un taux par défaut codé en dur, sans que le
    // marchand sache qu'il n'a jamais été confirmé par le serveur et pourrait être périmé
    // si l'admin a changé taxP2P/taxWithdraw depuis.
    const unconfirmedSuffix = feesConfirmed ? '' : ' (non confirmé)';
    const cards: QrCardDef[] = user?.role === 'MERCHANT'
        ? [
            { key: 'pay', label: 'Code Paiement', value: `${baseValue}&action=pay`, accent: '#10B981', feeLabel: `Frais client : ${(fees.taxP2P * 100).toFixed(1)}%${unconfirmedSuffix}` },
            { key: 'withdraw', label: 'Code Retrait Cash', value: `${baseValue}&action=withdraw`, accent: '#F59E0B', feeLabel: `Frais client : ${(fees.taxWithdraw * 100).toFixed(1)}%${unconfirmedSuffix}` },
        ]
        : [{ key: 'default', label: 'Mon Code', value: baseValue, accent: COLORS.primary }];

    const handleShare = async () => {
        try {
            await Share.share({
                message: `Payez-moi sur Mongain ! Voici mon numéro : ${user?.phone} (${user?.name})`,
            });
        } catch (error: any) {
            Alert.alert('Erreur', error.message);
        }
    };

    const getQrBase64 = (key: string) => new Promise<string>((resolve, reject) => {
        const ref = qrRefs.current[key];
        if (!ref) { reject(new Error('QR indisponible.')); return; }
        ref.toDataURL((data: string) => resolve(data));
    });

    // Même mécanisme que receipt.tsx (Print.printToFileAsync -> Sharing.shareAsync) : génère
    // un PDF et ouvre la feuille de partage native, qui propose Imprimer/AirPrint/enregistrer
    // selon l'appareil — pas besoin de dépendance supplémentaire (react-native-view-shot).
    const handlePrint = async () => {
        setPrinting(true);
        try {
            const printable = await Promise.all(cards.map(async c => ({ ...c, base64: await getQrBase64(c.key) })));
            const htmlContent = `
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <style>
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f8fafc; padding: 30px; color: #1a1d2e; }
                        .brand { text-align: center; font-size: 22px; font-weight: 800; color: #10B981; letter-spacing: 1px; margin-bottom: 30px; }
                        .card { background: #fff; border-radius: 20px; padding: 30px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 420px; margin: 0 auto 30px; page-break-inside: avoid; }
                        .label { display: inline-block; padding: 6px 16px; border-radius: 20px; color: #fff; font-weight: 700; font-size: 13px; margin-bottom: 20px; }
                        img.qr { width: 220px; height: 220px; }
                        .name { font-size: 20px; font-weight: 800; margin-top: 16px; }
                        .phone { font-size: 16px; color: #6b7280; letter-spacing: 1px; margin-top: 4px; }
                        .fee { font-size: 13px; color: #94a3b8; margin-top: 10px; }
                    </style>
                </head>
                <body>
                    <div class="brand">MONGAIN</div>
                    ${printable.map(c => `
                        <div class="card">
                            <span class="label" style="background:${c.accent};">${c.label.toUpperCase()}</span><br/>
                            <img class="qr" src="data:image/png;base64,${c.base64}" />
                            <div class="name">${user?.name}</div>
                            <div class="phone">${user?.phone}</div>
                            ${c.feeLabel ? `<div class="fee">${c.feeLabel}</div>` : ''}
                        </div>
                    `).join('')}
                </body>
                </html>
            `;

            const { uri } = await Print.printToFileAsync({ html: htmlContent, base64: false });
            await Sharing.shareAsync(uri, {
                mimeType: 'application/pdf',
                dialogTitle: cards.length > 1 ? 'Imprimer mes codes QR Mongain' : 'Imprimer mon code QR Mongain',
                UTI: 'com.adobe.pdf',
            });
        } catch (error) {
            console.error('Erreur lors de la génération du PDF QR:', error);
            Alert.alert('Erreur', "Impossible de préparer l'impression.");
        } finally {
            setPrinting(false);
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

            <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
                <Text style={styles.instructions}>
                    {cards.length > 1 ? "Faites scanner le code correspondant à l'opération souhaitée." : "Faites scanner ce code pour recevoir de l'argent instantanément."}
                </Text>

                {cards.map(c => (
                    <View key={c.key} style={styles.card}>
                        <View style={styles.cardTop}>
                            <View style={styles.appBrandRow}>
                                <Ionicons name="wallet" size={24} color="#10B981" />
                                <Text style={styles.brandText}>MONGAIN</Text>
                            </View>
                            <Text style={[styles.roleBadge, { backgroundColor: c.accent }]}>{c.label}</Text>
                        </View>

                        <View style={styles.qrWrapper}>
                            {user ? (
                                <QRCode
                                    value={c.value}
                                    size={QR_SIZE}
                                    color={COLORS.textPrimary}
                                    backgroundColor={COLORS.surface}
                                    logoBackgroundColor="transparent"
                                    getRef={(ref) => { qrRefs.current[c.key] = ref; }}
                                />
                            ) : (
                                <ActivityIndicator color={COLORS.primary} />
                            )}
                        </View>

                        <Text style={styles.userName}>{user?.name}</Text>
                        <Text style={styles.userPhone}>{user?.phone}</Text>
                        {c.feeLabel && <Text style={[styles.merchantDesc, { color: c.accent }]}>{c.feeLabel}</Text>}
                    </View>
                ))}

                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                    <Ionicons name="share-outline" size={22} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.shareButtonText}>Partager mon Numéro</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.shareButton, styles.printButton]} onPress={handlePrint} disabled={printing}>
                    {printing ? <ActivityIndicator color="#fff" /> : <Ionicons name="print-outline" size={22} color="#fff" style={{ marginRight: 8 }} />}
                    <Text style={styles.shareButtonText}>{printing ? 'Préparation...' : cards.length > 1 ? 'Imprimer mes codes QR' : 'Imprimer ce code'}</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.surface },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
    backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    container: { paddingHorizontal: 24, paddingVertical: 20, paddingBottom: 40, alignItems: 'center' },

    instructions: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 24, paddingHorizontal: 20, lineHeight: 22, fontFamily: 'Satoshi-Regular' },

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
        marginBottom: 20
    },
    cardTop: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
    appBrandRow: { flexDirection: 'row', alignItems: 'center' },
    brandText: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#10B981', marginLeft: 8, letterSpacing: 1 },
    roleBadge: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, color: '#fff', fontSize: 10, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', letterSpacing: 1 },

    qrWrapper: { padding: 15, backgroundColor: COLORS.surface, borderRadius: 24, marginBottom: 24 },

    userName: { fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, textAlign: 'center' },
    userPhone: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, letterSpacing: 2 },
    merchantDesc: { fontSize: 12, marginTop: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    shareButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#4F46E5', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 20, width: '100%', justifyContent: 'center', marginTop: 20 },
    printButton: { backgroundColor: '#0F172A' },
    shareButtonText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});
