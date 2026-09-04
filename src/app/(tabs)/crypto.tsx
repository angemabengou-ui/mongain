import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function CryptoScreen() {
    const { token } = useAuth();
    const [market, setMarket] = useState<any[]>([]);
    const [wallets, setWallets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    const fetchCryptoData = async () => {
        try {
            const res = await request('GET', '/api/crypto/market', {}, true);
            setMarket(res.market || []);
            setWallets(res.wallets || []);
        } catch (e) {
            console.warn(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token) fetchCryptoData();
    }, [token]);

    const handleBuy = (asset: string) => {
        if (!amount) return Alert.alert("Erreur", "Veuillez entrer un montant XAF.");
        Alert.prompt(
            'Confirmer l\'achat',
            `Saisissez votre code PIN Mongain pour acheter du ${asset}.`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Confirmer', onPress: (pin?: string) => executeBuy(asset, pin) },
            ],
            'secure-text',
        );
    };

    const executeBuy = async (asset: string, pin?: string) => {
        if (!pin) return Alert.alert("Erreur", "Code PIN requis.");
        setActionLoading(true);
        try {
            await request('POST', '/api/crypto/buy', { asset, amountXaf: amount, pin }, true);
            await fetchCryptoData();
            Alert.alert("Succès", `Vous avez acheté du ${asset} avec succès.`);
            setAmount('');
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleSell = (asset: string) => {
        if (!amount) return Alert.alert("Erreur", "Veuillez entrer la quantité de crypto à vendre.");
        Alert.prompt(
            'Confirmer la vente',
            `Saisissez votre code PIN Mongain pour vendre du ${asset}.`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Confirmer', onPress: (pin?: string) => executeSell(asset, pin) },
            ],
            'secure-text',
        );
    };

    const executeSell = async (asset: string, pin?: string) => {
        if (!pin) return Alert.alert("Erreur", "Code PIN requis.");
        setActionLoading(true);
        try {
            await request('POST', '/api/crypto/sell', { asset, amountCrypto: amount, pin }, true);
            await fetchCryptoData();
            Alert.alert("Succès", `Vente de ${asset} exécutée avec succès.`);
            setAmount('');
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    const getWalletBalance = (asset: string) => {
        const w = wallets.find(w => w.asset === asset);
        return w ? w.balance : 0;
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <Text style={styles.title}>Mongain Crypto</Text>
                    <Text style={styles.subtitle}>Achetez, vendez et tradez vos actifs numériques (V8)</Text>
                </View>

                {loading ? (
                    <ActivityIndicator size="large" color="#ffffff" style={{ marginTop: 40 }} />
                ) : (
                    <View>
                        <BlurView intensity={50} tint="dark" style={styles.portfolioGlass}>
                            <Text style={styles.portfolioLabel}>VALEUR DU PORTEFEUILLE</Text>
                            <Text style={styles.portfolioValue}>
                                {wallets.reduce((acc, w) => {
                                    const mk = market.find(m => m.asset === w.asset);
                                    return acc + (w.balance * (mk ? mk.priceXAF : 0));
                                }, 0).toLocaleString()} <Text style={{ fontSize: 16, color: '#A855F7' }}>XAF</Text>
                            </Text>
                        </BlurView>

                        <Text style={styles.sectionTitle}>Marché en direct</Text>

                        {market.map((m, i) => {
                            const change = parseFloat(m.change24h);
                            const isPositive = change >= 0;
                            const balance = getWalletBalance(m.asset);

                            return (
                                <View key={i} style={styles.assetCard}>
                                    <View style={styles.assetHeader}>
                                        <View>
                                            <Text style={styles.assetName}>{m.asset}</Text>
                                            <Text style={styles.assetOwned}>Solde: {balance.toFixed(6)} {m.asset}</Text>
                                        </View>
                                        <View style={{ alignItems: 'flex-end' }}>
                                            <Text style={styles.assetPrice}>{m.priceXAF.toLocaleString()} XAF</Text>
                                            <Text style={{ color: isPositive ? '#10B981' : '#EF4444', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>
                                                {isPositive ? '+' : ''}{m.change24h}%
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.actionRow}>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Montant..."
                                            placeholderTextColor="#94A3B8"
                                            keyboardType="numeric"
                                            value={amount}
                                            onChangeText={setAmount}
                                        />
                                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#10B981' }]} onPress={() => handleBuy(m.asset)} disabled={actionLoading}>
                                            <Ionicons name="arrow-down" color="#fff" size={16} />
                                            <Text style={styles.btnText}>Acheter</Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#EF4444' }]} onPress={() => handleSell(m.asset)} disabled={actionLoading}>
                                            <Ionicons name="arrow-up" color="#fff" size={16} />
                                            <Text style={styles.btnText}>Vendre</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    scroll: { padding: 24, paddingBottom: 60 },
    header: { marginBottom: 32, marginTop: 20 },
    title: { color: '#ffffff', fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', marginBottom: 8 },
    subtitle: { color: '#94a3b8', fontSize: 16 },
    portfolioGlass: { padding: 30, borderRadius: 24, marginBottom: 40, borderBottomWidth: 4, borderBottomColor: '#A855F7', backgroundColor: 'rgba(168, 85, 247, 0.05)' },
    portfolioLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
    portfolioValue: { color: '#fff', fontSize: 40, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    sectionTitle: { color: '#fff', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 20 },
    assetCard: { padding: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    assetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    assetName: { color: '#fff', fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    assetOwned: { color: '#94a3b8', fontSize: 13, marginTop: 4 },
    assetPrice: { color: '#fff', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 4 },
    actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    input: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 12, color: '#fff', borderBottomWidth: 2, borderBottomColor: '#3B82F6' },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, gap: 8, paddingHorizontal: 16 },
    btnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12 }
});

