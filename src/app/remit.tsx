import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { request } from '../services/api';

const CURRENCIES = [
    { code: 'EUR', label: 'Euro (France)', flag: '🇫🇷' },
    { code: 'USD', label: 'Dollar (USA)', flag: '🇺🇸' },
    { code: 'XOF', label: 'Franc CFA (Sénégal)', flag: '🇸🇳' },
    { code: 'NGN', label: 'Naira (Nigeria)', flag: '🇳🇬' }
];

export default function RemitScreen() {
    const router = useRouter();
    const [amountStr, setAmountStr] = useState('');
    const [targetAccount, setTargetAccount] = useState('');
    const [targetCurrency, setTargetCurrency] = useState('EUR');
    const [quote, setQuote] = useState<any>(null);
    const [loading, setLoading] = useState(false);

    const handleCalculateQuote = async () => {
        if (!amountStr) return;
        setLoading(true);
        try {
            const res = await request('POST', '/api/remit/quote', {
                targetCurrency,
                amountXaf: amountStr
            }, true);
            setQuote(res);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Erreur de cotation");
            setQuote(null);
        } finally {
            setLoading(false);
        }
    };

    const handleSend = async () => {
        if (!quote) return;
        if (!targetAccount) return Alert.alert("Erreur", "Saisissez un IBAN ou Numéro de téléphone international.");

        Alert.alert(
            "Confirmer le virement",
            `Souhaitez-vous vraiment débourser ${quote.totalToDebit} XAF pour envoyer l'équivalent de ${quote.convertedAmount} ${targetCurrency} ?`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Confirmer", style: "default",
                    onPress: async () => {
                        setLoading(true);
                        try {
                            await request('POST', '/api/remit/send', {
                                targetCurrency,
                                amountXaf: amountStr,
                                targetAccount
                            }, true);
                            Alert.alert("Transaction Réussie !", `Fonds expédiés vers le réseau ${targetCurrency}.`);
                            router.back();
                        } catch (e: any) {
                            Alert.alert("Erreur", e.response?.data?.error || "Le transfert a échoué.");
                        } finally {
                            setLoading(false);
                        }
                    }
                }
            ]
        );
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
