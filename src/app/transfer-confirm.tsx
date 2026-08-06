import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import LottieView from 'lottie-react-native';
import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { apiTransfer } from '../services/api';

const COLORS = {
    primary: '#1DC5E9',
    surface: '#ffffff',
    background: '#f8f9fe',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    error: '#E11D48',
    success: '#059669',
    border: '#e5e7eb',
};

export default function TransferConfirmScreen() {
    const { settings, user } = useAuth();
    const router = useRouter();
    const { receiverPhone, receiverName, isMerchant } = useLocalSearchParams<{ receiverPhone: string; receiverName: string; isMerchant: string }>();
    const isPayment = isMerchant === 'true';

    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState<{ receiverName: string; remainingBalance: number } | null>(null);

    const initials = receiverName
        ? receiverName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '?';

    const handleBiometricAuth = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));
        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }

        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) {
            setError('La biométrie n\'est pas disponible ou configurée sur cet appareil.');
            return;
        }

        const auth = await LocalAuthentication.authenticateAsync({
            promptMessage: 'Confirmez le transfert avec Face ID / Empreinte',
            fallbackLabel: 'Utiliser le code PIN',
        });

        if (auth.success) {
            setLoading(true);
            try {
                const result = await apiTransfer(receiverPhone, amountNum, undefined, true);
                setSuccess({
                    receiverName: result.data.receiverName,
                    remainingBalance: result.data.remainingBalance,
                });
            } catch (e: any) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleTransfer = async () => {
        setError('');
        const amountNum = parseFloat(amount.replace(/\s/g, '').replace(',', '.'));

        if (!amount || isNaN(amountNum) || amountNum <= 0) {
            setError('Veuillez entrer un montant valide.');
            return;
        }
        if (!pin || pin.length !== 4) {
            setError('Veuillez entrer votre code PIN à 4 chiffres.');
            return;
        }

        setLoading(true);
        try {
            const result = await apiTransfer(receiverPhone, amountNum, pin, false);
            setSuccess({
                receiverName: result.data.receiverName,
                remainingBalance: result.data.remainingBalance,
            });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleShareReceipt = async () => {
        try {
            const html = `
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
                    <style>
                      body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #1E293B; }
                      .receipt { border: 1px solid #E2E8F0; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
                      .header { text-align: center; margin-bottom: 30px; }
                      .logo { font-size: 24px; font-weight: 900; color: #4F46E5; letter-spacing: -1px; }
                      .title { font-size: 14px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-top: 10px; }
                      .amount { font-size: 36px; font-weight: 800; color: #10B981; text-align: center; margin-bottom: 30px; }
                      .row { display: flex; justify-content: space-between; border-bottom: 1px dashed #E2E8F0; padding: 12px 0; font-size: 14px; }
                      .row:last-child { border-bottom: none; }
                      .label { color: #64748B; }
                      .value { font-weight: 600; text-align: right; }
                      .footer { text-align: center; margin-top: 40px; font-size: 12px; color: #94A3B8; }
                    </style>
                  </head>
                  <body>
                    <div class="receipt">
                      <div class="header">
                        <div class="logo">Mongain.</div>
                        <div class="title">Reçu de Transaction</div>
                      </div>
                      <div class="amount">${parseFloat(amount).toLocaleString('fr-FR')} FCFA</div>
                      <div class="row">
                        <span class="label">Statut</span>
                        <span class="value" style="color: #10B981;">COMPLÉTÉ</span>
                      </div>
                      <div class="row">
                        <span class="label">${isPayment ? 'Marchand' : 'Bénéficiaire'}</span>
                        <span class="value">${success?.receiverName || ''}<br/>${receiverPhone}</span>
                      </div>
                      <div class="row">
                        <span class="label">Date</span>
                        <span class="value">${new Date().toLocaleString('fr-FR')}</span>
                      </div>
                      <div class="row">
                        <span class="label">Référence</span>
                        <span class="value">MNG-${Math.random().toString(36).substring(2, 10).toUpperCase()}</span>
                      </div>
                      <div class="footer">
                        Généré sécuritairement par l'application Mongain.<br/>
                        Merci pour votre confiance.
                      </div>
                    </div>
                  </body>
                </html>
            `;
            const { uri } = await Print.printToFileAsync({ html, width: 400 });
            await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf', dialogTitle: 'Envoyer le reçu Reçu Mongain' });
        } catch (e) {
            console.error('Erreur génération PDF:', e);
            alert("Erreur lors de la génération du reçu.");
        }
    };

    // ─── Écran de succès ───────────────────────────────────────────
    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={styles.successIconWrap}>
                    <LottieView
                        source={require('../assets/success.json')}
                        autoPlay
                        loop={false}
                        style={{ width: 150, height: 150 }}
                    />
                </View>
                <Text style={styles.successTitle}>Transfert réussi !</Text>
                <Text style={styles.successSubtitle}>
                    Vous avez envoyé{'\n'}
                    <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>
                        {parseFloat(amount).toLocaleString('fr-FR')} FCFA
                    </Text>
                    {'\n'}à <Text style={{ fontWeight: '800', color: COLORS.textPrimary }}>{success.receiverName}</Text>
                </Text>
                <View style={styles.remainingCard}>
                    <Text style={styles.remainingLabel}>Solde restant</Text>
                    <Text style={styles.remainingAmount}>{success.remainingBalance.toLocaleString('fr-FR')} FCFA</Text>
                </View>

                <TouchableOpacity style={[styles.doneBtn, { backgroundColor: '#334155', marginBottom: 12, flexDirection: 'row' }]} onPress={handleShareReceipt}>
                    <Ionicons name="share-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.doneBtnText}>Partager le reçu (PDF)</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.doneBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border }]} onPress={() => router.replace('/(tabs)' as any)}>
                    <Text style={[styles.doneBtnText, { color: COLORS.textPrimary }]}>Terminer</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    // ─── Écran de saisie ──────────────────────────────────────────
    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>{isPayment ? 'Paiement Marchand' : 'Confirmation'}</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 150 }]} keyboardShouldPersistTaps="handled">
                    {/* Carte destinataire */}
                    <View style={styles.recipientCard}>
                        <View style={styles.recipientAvatar}>
                            <Text style={styles.recipientInitial}>{initials}</Text>
                        </View>
                        <View>
                            <Text style={styles.recipientLabel}>{isPayment ? 'Marchand (Bénéficiaire)' : 'Destinataire'}</Text>
                            <Text style={styles.recipientName}>{receiverName || receiverPhone}</Text>
                            <Text style={styles.recipientPhone}>{receiverPhone}</Text>
                        </View>
                    </View>

                    {/* Erreur */}
                    {error ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    {/* Montant */}
                    <Text style={styles.label}>Montant (FCFA)</Text>
                    <View style={styles.inputContainer}>
                        <Text style={styles.currencyPrefix}>FCFA</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="0"
                            keyboardType="numeric"
                            value={amount}
                            onChangeText={setAmount}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    {Number(amount) > 0 && (() => {
                        const isExempt = (user?.role === 'AGENT' && !isPayment) || user?.role === 'ADMIN';
                        const p2pFee = isExempt ? 0 : Math.ceil(Number(amount) * (settings?.taxP2P || 0.01));
                        const totalDebit = Number(amount) + p2pFee;

                        return (
                            <View style={{ backgroundColor: 'rgba(29, 197, 233, 0.05)', padding: 16, borderRadius: 16, marginTop: 12, borderWidth: 1, borderColor: 'rgba(29, 197, 233, 0.2)' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <Text style={{ color: COLORS.textSecondary }}>Montant envoyé</Text>
                                    <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{Number(amount).toLocaleString('fr-FR')} FCFA</Text>
                                </View>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <Text style={{ color: isExempt ? '#059669' : '#F59E0B' }}>Frais {isExempt ? '(Gratuit)' : `(${settings?.taxP2P ? settings.taxP2P * 100 : 1}%)`}</Text>
                                    <Text style={{ color: isExempt ? '#059669' : '#F59E0B', fontWeight: '600' }}>{p2pFee.toLocaleString('fr-FR')} FCFA</Text>
                                </View>
                                <View style={{ width: '100%', height: 1, backgroundColor: COLORS.border || '#e2e8f0', marginVertical: 4 }} />
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                                    <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>Total à débiter</Text>
                                    <Text style={{ color: COLORS.textPrimary, fontWeight: '800', fontSize: 16 }}>{totalDebit.toLocaleString('fr-FR')} FCFA</Text>
                                </View>
                            </View>
                        );
                    })()}

                    {/* Raccourcis */}
                    <View style={styles.amountShortcuts}>
                        {['5 000', '10 000', '25 000', '50 000'].map(v => (
                            <TouchableOpacity
                                key={v}
                                style={styles.shortcutPill}
                                onPress={() => setAmount(v.replace(/\s/g, ''))}
                            >
                                <Text style={styles.shortcutText}>{v}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* PIN */}
                    <Text style={styles.label}>Code PIN</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                        <TextInput
                            style={styles.input}
                            placeholder="••••"
                            keyboardType="number-pad"
                            secureTextEntry={!showPin}
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                            placeholderTextColor={COLORS.textSecondary}
                        />
                        <TouchableOpacity onPress={() => setShowPin(!showPin)} style={{ padding: 4 }}>
                            <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
                        <TouchableOpacity style={[styles.sendBtn, { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary }]} onPress={handleBiometricAuth} disabled={loading}>
                            <Ionicons name="finger-print" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
                            <Text style={[styles.sendBtnText, { color: COLORS.primary }]}>Face ID</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.sendBtn, { flex: 2, backgroundColor: isPayment ? '#F59E0B' : COLORS.primary, borderWidth: 0 }]} onPress={handleTransfer} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : (
                                <>
                                    <Ionicons name={isPayment ? "cart" : "send"} size={20} color="#fff" style={{ marginRight: 8 }} />
                                    <Text style={styles.sendBtnText}>{isPayment ? 'Payer (PIN)' : 'Envoyer (PIN)'}</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
        backgroundColor: COLORS.surface,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    content: { padding: 24 },

    // Destinataire
    recipientCard: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
        gap: 16,
    },
    recipientAvatar: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: COLORS.primary + '40',
    },
    recipientInitial: { fontSize: 20, fontWeight: '800', color: COLORS.primary },
    recipientLabel: { fontSize: 12, color: COLORS.textSecondary, marginBottom: 2 },
    recipientName: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary },
    recipientPhone: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },

    errorBox: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2',
        borderRadius: 12, padding: 12, marginBottom: 16, gap: 8,
    },
    errorText: { color: COLORS.error, fontSize: 14, flex: 1 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, marginTop: 4 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
        borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 12,
        borderWidth: 1, borderColor: '#e2e8f0',
    },
    currencyPrefix: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1', paddingRight: 12 },
    input: { flex: 1, fontSize: 18, color: COLORS.textPrimary, fontWeight: '600', height: '100%' },
    amountShortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
    shortcutPill: {
        paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
        backgroundColor: COLORS.primary + '15', borderWidth: 1, borderColor: COLORS.primary + '30',
    },
    shortcutText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
    sendBtn: {
        backgroundColor: COLORS.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 56, borderRadius: 16, marginTop: 8,
        shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
    },
    sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },

    // Succès
    successIconWrap: { marginBottom: 24 },
    successTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 12, textAlign: 'center' },
    successSubtitle: { fontSize: 17, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 26, marginBottom: 24 },
    remainingCard: {
        backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 32, paddingVertical: 20,
        alignItems: 'center', marginBottom: 32,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 3,
    },
    remainingLabel: { fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 },
    remainingAmount: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary },
    doneBtn: {
        backgroundColor: COLORS.primary, paddingHorizontal: 48, paddingVertical: 16, borderRadius: 16,
        shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
    },
    doneBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
