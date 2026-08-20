import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COLORS = {
    primary: '#1DC5E9',
    surface: '#ffffff',
    background: '#1a1d2e',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    success: '#059669',
    error: '#E11D48',
    devider: '#e2e8f0',
};

export default function ReceiptScreen() {
    const router = useRouter();
    // Les paramètres passés via router.push()
    const { id, type, amount, currency, status, reference, counterpart, counterpartPhone, createdAt } = useLocalSearchParams();

    const isIncoming = type === 'incoming';
    const amountVal = parseFloat(amount as string) || 0;
    const formattedAmount = amountVal.toLocaleString('fr-FR');
    const dateFormatted = new Date(createdAt as string).toLocaleString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    // 'PULL' = préfixe du dépôt Mobile Money PVit (backend/src/routes/wallet.ts, POST
    // /wallet/pull) — 'DEPOSIT' reste géré pour les dépôts en agence (agent-action.tsx).
    const isDeposit = reference && ((reference as string).startsWith('DEPOSIT') || (reference as string).startsWith('PULL'));
    const isWithdraw = reference && (reference as string).startsWith('WITHDRAW');

    let title = isIncoming ? 'Paiement reçu' : 'Paiement envoyé';
    if (isDeposit) title = 'Dépôt sur compte';
    if (isWithdraw) title = 'Retrait en espèces';

    // Le dépôt PVit reste PENDING tant que le webhook opérateur n'a pas confirmé (voir
    // backend/src/routes/wallet.ts et webhooks.ts) — afficher "Effectué" sans condition
    // laissait croire au client que l'argent était déjà crédité alors que la demande est
    // seulement en cours de validation, voire déjà rejetée (FAILED).
    const statusStr = (Array.isArray(status) ? status[0] : status) || 'COMPLETED';
    const isPending = statusStr === 'PENDING';
    const isFailed = statusStr === 'FAILED';
    const statusLabel = isFailed ? 'Échoué' : isPending ? 'En attente' : 'Effectué';
    const statusColor = isFailed ? '#E11D48' : isPending ? '#F59E0B' : COLORS.success;
    const statusIconName: any = isFailed ? 'close-circle' : isPending ? 'time' : 'checkmark-circle';

    const [isPrinting, setIsPrinting] = useState(false);

    const shareReceiptPDF = async () => {
        setIsPrinting(true);
        try {
            const htmlContent = `
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 40px; color: #1a1d2e; }
                        .receipt-box { background: white; border-radius: 16px; padding: 30px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 600px; margin: 0 auto; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .logo { font-size: 32px; font-weight: 800; color: #1DC5E9; margin-bottom: 5px; }
                        .title { font-size: 20px; color: #6b7280; margin-bottom: 15px; }
                        .amount { font-size: 40px; font-weight: bold; margin-bottom: 5px; color: ${isIncoming || isDeposit ? '#059669' : '#E11D48'}; }
                        .status { display: inline-block; background-color: #d1fae5; color: #059669; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; }
                        .divider { border-top: 2px dashed #e2e8f0; margin: 30px 0; }
                        .detail-row { display: flex; justify-content: space-between; margin-bottom: 16px; }
                        .detail-label { color: #6b7280; font-size: 16px; }
                        .detail-value { font-weight: bold; font-size: 16px; }
                        .footer { text-align: center; margin-top: 40px; color: #94a3b8; font-size: 14px; }
                    </style>
                </head>
                <body>
                    <div class="receipt-box">
                        <div class="header">
                            <div class="logo">MONGAIN</div>
                            <div class="title">${title}</div>
                            <div class="amount">${isIncoming || isDeposit ? '+' : '-'}${formattedAmount} ${currency}</div>
                            <div class="status" style="background-color:${statusColor}20;color:${statusColor};">${isFailed ? '✕' : isPending ? '⏳' : '✓'} ${isPending ? 'En attente de confirmation' : isFailed ? 'Opération échouée' : 'Opération réussie'}</div>
                        </div>
                        <div class="divider"></div>
                        
                        ${(!isDeposit && !isWithdraw) ? `
                            <div class="detail-row">
                                <span class="detail-label">${isIncoming ? 'De' : 'À'}</span>
                                <span class="detail-value">${counterpart || '-'}</span>
                            </div>
                            <div class="detail-row">
                                <span class="detail-label">Numéro</span>
                                <span class="detail-value">${counterpartPhone || '-'}</span>
                            </div>
                        ` : ''}
                        
                        <div class="detail-row">
                            <span class="detail-label">Date et heure</span>
                            <span class="detail-value">${dateFormatted}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">N° de Transaction</span>
                            <span class="detail-value">${(reference as string) || (id as string).split('-')[0]}</span>
                        </div>
                        
                        <div class="footer">
                            Reçu officiel généré par Mongain — L'argent mobile au Gabon<br><br>
                            Ce document est une preuve électronique de votre transaction.
                        </div>
                    </div>
                </body>
                </html>
            `;

            const { uri } = await Print.printToFileAsync({
                html: htmlContent,
                base64: false
            });

            await Sharing.shareAsync(uri, {
                mimeType: 'application/pdf',
                dialogTitle: 'Partager votre reçu Mongain',
                UTI: 'com.adobe.pdf'
            });

        } catch (error) {
            console.error('Erreur lors de la génération du PDF:', error);
            alert("Impossible de générer le PDF du reçu.");
        } finally {
            setIsPrinting(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Reçu</Text>
                <View style={{ width: 28 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.receiptCard}>
                    {/* En-tête Carte */}
                    <View style={styles.receiptHeader}>
                        <View style={[styles.iconWrapper, { backgroundColor: isIncoming || isDeposit ? COLORS.success + '20' : COLORS.error + '20' }]}>
                            <Ionicons
                                name={isDeposit ? 'cash' : isWithdraw ? 'wallet' : isIncoming ? 'arrow-down' : 'arrow-up'}
                                size={32}
                                color={isIncoming || isDeposit ? COLORS.success : COLORS.error}
                            />
                        </View>
                        <Text style={styles.receiptTitle}>{title}</Text>
                        <Text style={styles.receiptAmount}>
                            {isIncoming || isDeposit ? '+' : '-'}{formattedAmount} {currency}
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
                            <Ionicons name={statusIconName} size={14} color={statusColor} />
                            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                        </View>
                    </View>

                    <View style={styles.dashLine} />

                    {/* Détails */}
                    <View style={styles.detailsContainer}>
                        {!isDeposit && !isWithdraw && (
                            <>
                                <DetailRow label={isIncoming ? 'De' : 'À'} value={counterpart as string} icon="person-outline" />
                                <DetailRow label="Numéro" value={counterpartPhone as string} icon="call-outline" />
                            </>
                        )}
                        <DetailRow label="Date" value={dateFormatted} icon="calendar-outline" />
                        <DetailRow label="ID Transaction" value={reference as string || (id as string).split('-')[0]} icon="document-text-outline" copyable />
                    </View>

                    <View style={styles.watermarkContainer}>
                        <Ionicons name="shield-checkmark" size={16} color={COLORS.primary} style={{ marginRight: 6 }} />
                        <Text style={styles.watermarkText}>Sécurisé par Mongain</Text>
                    </View>
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.actionBtn} onPress={shareReceiptPDF} disabled={isPrinting}>
                    {isPrinting ? <ActivityIndicator color="#ffffff" /> : <Ionicons name="share-social-outline" size={20} color="#fff" />}
                    <Text style={styles.actionBtnText}>{isPrinting ? 'Génération...' : 'Partager le reçu'}</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

function DetailRow({ label, value, icon, copyable }: { label: string; value: string; icon: any; copyable?: boolean }) {
    return (
        <View style={styles.detailRow}>
            <View style={styles.detailRowLeft}>
                <Ionicons name={icon} size={18} color={COLORS.textSecondary} style={styles.detailIcon} />
                <Text style={styles.detailLabel}>{label}</Text>
            </View>
            <View style={styles.detailRowRight}>
                <Text style={styles.detailValue} selectable={copyable}>{value}</Text>
                {copyable && <Ionicons name="copy-outline" size={16} color={COLORS.primary} style={{ marginLeft: 6 }} />}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
    },
    backButton: { padding: 8, marginLeft: -8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20 },
    headerTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    receiptCard: {
        backgroundColor: '#fff', borderRadius: 24, padding: 24, marginTop: -10,
        alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
    },
    receiptHeader: { alignItems: 'center', marginBottom: 24 },
    iconWrapper: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    receiptTitle: { fontSize: 16, color: COLORS.textSecondary, marginBottom: 8, fontWeight: '500' },
    receiptAmount: { fontSize: 32, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 12 },
    statusBadge: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.success + '15',
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, gap: 6,
    },
    statusText: { color: COLORS.success, fontSize: 13, fontWeight: '700' },

    dashLine: {
        width: '100%', height: 1, backgroundColor: 'transparent',
        borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.devider, borderRadius: 1,
        marginBottom: 24,
    },
    detailsContainer: { width: '100%', gap: 16 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    detailRowLeft: { flexDirection: 'row', alignItems: 'center' },
    detailIcon: { marginRight: 8 },
    detailLabel: { fontSize: 14, color: COLORS.textSecondary },
    detailRowRight: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end', paddingLeft: 16 },
    detailValue: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'right' },

    watermarkContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 32, opacity: 0.8 },
    watermarkText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },

    footer: { padding: 20, backgroundColor: COLORS.background },
    actionBtn: {
        backgroundColor: COLORS.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 56, borderRadius: 16, gap: 8,
    },
    actionBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
