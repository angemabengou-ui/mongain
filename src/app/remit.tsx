import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { request } from '../services/api';

const CURRENCIES = [
    { code: 'EUR', label: 'Euro (France)', country: 'France', flag: '🇫🇷' },
    { code: 'USD', label: 'Dollar (USA)', country: 'USA', flag: '🇺🇸' },
    { code: 'XOF', label: 'Franc CFA (Sénégal)', country: 'Sénégal', flag: '🇸🇳' },
    { code: 'NGN', label: 'Naira (Nigeria)', country: 'Nigeria', flag: '🇳🇬' }
];

export default function RemitScreen() {
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
        if (!targetAccount) return Alert.alert("Erreur", "Saisissez le numéro de téléphone du destinataire.");

        // On recalcule la cotation juste avant de confirmer : évite d'envoyer un montant
        // différent de celui affiché si le champ a été modifié depuis le dernier calcul.
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
            Alert.alert("Transaction Réussie !", `Fonds expédiés vers le réseau ${targetCurrency}.`);
            router.back();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Le transfert a échoué.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                        <Ionicons name="arrow-back" size={24} color="#fff" />
                    </TouchableOpacity>
                    <Text style={styles.title}>Virements Internationaux</Text>
                </View>

                <ScrollView contentContainerStyle={styles.scroll}>

                    <View style={styles.card}>
                        <Text style={styles.label}>Montant à envoyer (XAF)</Text>
                        <TextInput
                            style={styles.inputXaf}
                            placeholder="ex: 50000"
                            placeholderTextColor="#64748b"
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={setAmountStr}
                            onBlur={handleCalculateQuote}
                        />

                        <View style={styles.exchangeIconWrapper}>
                            <View style={styles.verticalLine}></View>
                            <Ionicons name="swap-vertical" size={24} color="#6366f1" />
                            <View style={styles.verticalLine}></View>
                        </View>

                        <Text style={styles.label}>Pays Destinataire</Text>
                        <View style={styles.currencySelect}>
                            {CURRENCIES.map(c => (
                                <TouchableOpacity
                                    key={c.code}
                                    style={[styles.currencyBtn, targetCurrency === c.code && styles.currencyBtnActive]}
                                    onPress={() => { setTargetCurrency(c.code); setQuote(null); }}
                                >
                                    <Text style={styles.flagText}>{c.flag}</Text>
                                    <Text style={[styles.currencyText, targetCurrency === c.code && { color: '#fff' }]}>{c.code}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {loading && <ActivityIndicator color="#6366f1" style={{ marginVertical: 20 }} />}

                        {quote && !loading && (
                            <View style={styles.quoteBox}>
                                <Text style={styles.quoteConverted}>{quote.convertedAmount} {quote.targetCurrency}</Text>
                                <Text style={styles.quoteRate}>Taux d'échange : 1 XAF = {quote.rate} {quote.targetCurrency}</Text>
                                <View style={styles.quoteDetails}>
                                    <View style={styles.quoteRow}><Text style={styles.quoteRowText}>Montant initial</Text><Text style={styles.quoteRowVal}>{amountStr} XAF</Text></View>
                                    <View style={styles.quoteRow}><Text style={styles.quoteRowText}>Frais (1.5%)</Text><Text style={styles.quoteRowVal}>{quote.fee} XAF</Text></View>
                                    <View style={[styles.quoteRow, { borderTopWidth: 1, borderColor: '#334155', paddingTop: 8, marginTop: 8 }]}>
                                        <Text style={[styles.quoteRowText, { color: '#fff', fontWeight: 'bold' }]}>Total Débité</Text>
                                        <Text style={[styles.quoteRowVal, { color: '#F43F5E', fontWeight: 'bold' }]}>- {quote.totalToDebit} XAF</Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        <Text style={[styles.label, { marginTop: 20 }]}>IBAN ou Numéro du destinataire</Text>
                        <TextInput
                            style={styles.inputAccount}
                            placeholder="FR76 1234 5678..."
                            placeholderTextColor="#64748b"
                            value={targetAccount}
                            onChangeText={setTargetAccount}
                        />

                        <TouchableOpacity style={[styles.submitBtn, (!quote || loading) && { opacity: 0.5 }]} onPress={handleSend} disabled={!quote || loading}>
                            <Ionicons name="globe" color="#fff" size={20} />
                            <Text style={styles.submitBtnText}>Initier le transfert</Text>
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
    backBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12 },
    title: { color: '#ffffff', fontSize: 20, fontWeight: '800' },

    scroll: { padding: 20 },
    card: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },

    label: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 8 },
    inputXaf: { backgroundColor: '#1e293b', color: '#fff', padding: 20, borderRadius: 16, fontSize: 28, fontWeight: '800', textAlign: 'center' },
    inputAccount: { backgroundColor: '#1e293b', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    exchangeIconWrapper: { alignItems: 'center', marginVertical: 12 },
    verticalLine: { width: 1, height: 16, backgroundColor: 'rgba(99, 102, 241, 0.4)' },

    currencySelect: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, flexWrap: 'wrap' },
    currencyBtn: { flex: 1, minWidth: '48%', backgroundColor: '#1e293b', padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderWidth: 1, borderColor: 'transparent' },
    currencyBtnActive: { backgroundColor: 'rgba(99, 102, 241, 0.2)', borderColor: '#6366f1' },
    flagText: { fontSize: 20 },
    currencyText: { color: '#94a3b8', fontSize: 16, fontWeight: 'bold' },

    quoteBox: { backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
    quoteConverted: { fontSize: 32, fontWeight: '900', color: '#10B981', textAlign: 'center' },
    quoteRate: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 16 },

    quoteDetails: { gap: 8 },
    quoteRow: { flexDirection: 'row', justifyContent: 'space-between' },
    quoteRowText: { color: '#94a3b8', fontSize: 14 },
    quoteRowVal: { color: '#cbd5e1', fontSize: 14, fontWeight: '600' },

    submitBtn: { backgroundColor: '#6366f1', borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 32 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
