import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useAppTheme } from '../constants/theme';
import { request } from '../services/api';

const CURRENCIES = [
    { code: 'EUR', label: 'Euro', country: 'France', flag: '🇫🇷' },
    { code: 'USD', label: 'Dollar', country: 'USA', flag: '🇺🇸' },
    { code: 'XOF', label: 'Franc CFA', country: 'Sénégal', flag: '🇸🇳' },
    { code: 'NGN', label: 'Naira', country: 'Nigeria', flag: '🇳🇬' }
];

export default function RemitScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [amountStr, setAmountStr] = useState('');
    const [targetAccount, setTargetAccount] = useState('');
    const [targetCurrency, setTargetCurrency] = useState('EUR');
    const [quote, setQuote] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const handleCalculateQuote = async () => {
        if (!amountStr) return null;
        setLoading(true);
        try {
            const res = await request('POST', '/api/remit/quote', {
                destinationCurrency: targetCurrency,
                amountXaf: Number(amountStr)
            }, true);
            setQuote(res);
            return res;
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Erreur de cotation");
            setQuote(null);
            return null;
        } finally {
            setLoading(false);
        }
    };

    const handleSend = async () => {
        if (!targetAccount) return Alert.alert("Erreur", "Saisissez le numéro ou l'IBAN.");

        const freshQuote = await handleCalculateQuote();
        if (!freshQuote) return;

        const country = CURRENCIES.find(c => c.code === targetCurrency)?.country || targetCurrency;

        Alert.alert(
            "Confirmer le virement",
            `Souhaitez-vous vraiment débourser ${freshQuote.totalToDebit} XAF pour envoyer l'équivalent de ${freshQuote.convertedAmount} ${targetCurrency} ?`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Confirmer", style: "default",
                    onPress: () => {
                        Alert.prompt(
                            'Code PIN',
                            'Confirmez ce virement avec votre code PIN Mongain.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Envoyer', onPress: (pin?: string) => executeSend(freshQuote, country, pin) },
                            ],
                            'secure-text',
                        );
                    }
                }
            ]
        );
    };

    const executeSend = async (freshQuote: any, country: string, pin?: string) => {
        if (!pin) return Alert.alert("Erreur", "Code PIN requis.");
        setLoading(true);
        try {
            await request('POST', '/api/remit/send', {
                destinationCountry: country,
                destinationCurrency: targetCurrency,
                recipientPhone: targetAccount,
                amountXaf: freshQuote.totalToDebit,
                pin
            }, true);
            Alert.alert("Transféré !", `Fonds expédiés vers le réseau ${targetCurrency}.`);
            router.back();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Le transfert a échoué.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Transfert International" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Montant à envoyer (XAF)</Text>
                            <TextInput
                                style={[styles.inputLarge, { color: COLORS.primary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="ex: 50000"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="number-pad"
                                value={amountStr}
                                onChangeText={setAmountStr}
                                onBlur={handleCalculateQuote}
                            />
                        </View>

                        <View style={styles.exchangeIconWrapper}>
                            <View style={[styles.verticalLine, { backgroundColor: COLORS.primary + '40' }]}></View>
                            <Ionicons name="swap-vertical" size={24} color={COLORS.primary} />
                            <View style={[styles.verticalLine, { backgroundColor: COLORS.primary + '40' }]}></View>
                        </View>

                        <Text style={styles.label}>Pays Destinataire</Text>
                        <View style={styles.currencySelect}>
                            {CURRENCIES.map(c => (
                                <TouchableOpacity
                                    key={c.code}
                                    style={[styles.currencyBtn, { backgroundColor: COLORS.surface, borderColor: targetCurrency === c.code ? COLORS.primary : COLORS.border }]}
                                    onPress={() => { setTargetCurrency(c.code); setQuote(null); }}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.flagText}>{c.flag}</Text>
                                    <Text style={[styles.currencyText, { color: targetCurrency === c.code ? COLORS.textPrimary : COLORS.textSecondary }]}>{c.code}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {loading && <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />}

                        {quote && !loading && (
                            <View style={[styles.quoteBox, { backgroundColor: '#10B98115', borderColor: '#10B98140' }]}>
                                <Text style={styles.quoteConverted}>{quote.convertedAmount} {quote.targetCurrency}</Text>
                                <Text style={styles.quoteRate}>Taux d'échange : 1 XAF = {quote.rate} {quote.targetCurrency}</Text>
                                <View style={styles.quoteDetails}>
                                    <View style={styles.quoteRow}><Text style={styles.quoteRowText}>Montant initial</Text><Text style={[styles.quoteRowVal, { color: COLORS.textPrimary }]}>{amountStr} XAF</Text></View>
                                    <View style={styles.quoteRow}><Text style={styles.quoteRowText}>Frais ({((quote.fxMarkup ?? 0.025) * 100).toLocaleString('fr-FR')}%)</Text><Text style={[styles.quoteRowVal, { color: COLORS.textPrimary }]}>{quote.fee} XAF</Text></View>
                                    <View style={[styles.quoteRow, { borderTopWidth: 1, borderColor: COLORS.border, paddingTop: 8, marginTop: 8 }]}>
                                        <Text style={[styles.quoteRowText, { color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }]}>Total Débité</Text>
                                        <Text style={[styles.quoteRowVal, { color: '#EF4444', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }]}>- {quote.totalToDebit} XAF</Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        <View style={[styles.formGroup, { marginTop: 24 }]}>
                            <Text style={styles.label}>IBAN ou Numéro du destinataire</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="FR76 1234 5678..."
                                placeholderTextColor={COLORS.textSecondary}
                                value={targetAccount}
                                onChangeText={setTargetAccount}
                            />
                        </View>

                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: COLORS.primary }, (!quote || loading) && { opacity: 0.5 }]} onPress={handleSend} disabled={!quote || loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Initier le transfert</Text>}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: any) => StyleSheet.create({
    safeArea: { flex: 1 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
    scroll: { flexGrow: 1, padding: 24 },

    formGroup: { marginBottom: 16 },
    label: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', color: '#666', marginBottom: 8, marginLeft: 4, fontWeight: 'bold' },
    inputLarge: { height: 72, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, fontSize: 26, fontFamily: 'Satoshi-SemiBold', textAlign: 'center', fontWeight: 'bold' },
    input: { height: 56, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold' },

    exchangeIconWrapper: { alignItems: 'center', marginVertical: 8 },
    verticalLine: { width: 2, height: 16 },

    currencySelect: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
    currencyBtn: { flex: 1, minWidth: '46%', padding: 14, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, borderWidth: 2 },
    flagText: { fontSize: 22 },
    currencyText: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    quoteBox: { borderRadius: 16, padding: 16, marginTop: 12, borderWidth: 1 },
    quoteConverted: { fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: '#10B981', textAlign: 'center' },
    quoteRate: { fontSize: 13, color: '#10B981', textAlign: 'center', marginBottom: 16, opacity: 0.8 },
    quoteDetails: { gap: 8 },
    quoteRow: { flexDirection: 'row', justifyContent: 'space-between' },
    quoteRowText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Satoshi-Regular' },
    quoteRowVal: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },

    footer: { padding: 24, paddingBottom: 34, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    submitBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    submitText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});
