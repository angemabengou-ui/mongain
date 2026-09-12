import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import PinPromptModal from '../../components/ui/PinPromptModal';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function CryptoScreen() {
    const { token, user } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();
    const insets = useSafeAreaInsets();
    const isDark = COLORS.background === '#0A0F1C';
    const styles = getStyles(COLORS, isDark);

    // Filet de sécurité UX (pas la barrière de sécurité — le backend refuse déjà ces routes
    // pour un CHILD) : couvre un lien profond périmé, une notification, ou tout autre chemin
    // qui contournerait les boutons/onglet masqués côté navigation ((tabs)/index.tsx et
    // (tabs)/_layout.tsx).
    const isChild = user?.role === 'CHILD';

    const [market, setMarket] = useState<any[]>([]);
    const [wallets, setWallets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    // Un montant PAR actif, pas un seul champ partagé entre toutes les cartes de la liste :
    // avant ce correctif, un unique `amount` alimentait le TextInput de CHAQUE actif rendu
    // (BTC/ETH/USDT...) — saisir "5000" pour acheter du BTC laissait ce même "5000" visible
    // (et actif) sur la carte ETH juste en dessous. Toucher "Vendre" sur ETH sans y retoucher
    // envoyait alors amountCrypto:"5000" (5000 ETH, pas 5000 XAF de BTC) à /api/crypto/sell.
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [actionLoading, setActionLoading] = useState(false);
    // Remplace Alert.prompt (n'existe que sur iOS, no-op silencieux sur Android — voir
    // PinPromptModal) pour les deux actions débitrices de cet écran.
    const [pinPrompt, setPinPrompt] = useState<{ type: 'buy' | 'sell'; asset: string; amount: string } | null>(null);

    // Retourne un booléen (même correctif que (tabs)/cards.tsx, fetchCards) : sans lui, un
    // achat/vente réellement exécuté par le serveur affichait quand même "Succès" ci-dessous
    // même quand CE rafraîchissement échouait (le marché/les soldes affichés restaient alors
    // périmés, pouvant donner l'impression trompeuse que rien ne s'est passé).
    const fetchCryptoData = async (): Promise<boolean> => {
        try {
            const res = await request('GET', '/api/crypto/market', undefined, true);
            setMarket(res.market || []);
            setWallets(res.wallets || []);
            return true;
        } catch (e: any) {
            // Un échec silencieux (juste console.warn) rendait un marché indisponible
            // indiscernable d'un marché simplement vide côté utilisateur.
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Impossible de charger le marché crypto.");
            return false;
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token && !isChild) fetchCryptoData();
    }, [token, isChild]);

    const handleBuy = (asset: string) => {
        const amount = amounts[asset];
        if (!amount) return Alert.alert("Erreur", "Veuillez entrer un montant XAF.");
        setPinPrompt({ type: 'buy', asset, amount });
    };

    const executeBuy = async (asset: string, amount: string, pin: string) => {
        setActionLoading(true);
        try {
            await request('POST', '/api/crypto/buy', { asset, amountXaf: amount, pin }, true);
            const refreshed = await fetchCryptoData();
            if (refreshed) Alert.alert("Succès", `Vous avez acheté du ${asset} avec succès.`);
            setAmounts(prev => ({ ...prev, [asset]: '' }));
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleSell = (asset: string) => {
        const amount = amounts[asset];
        if (!amount) return Alert.alert("Erreur", "Veuillez entrer la quantité de crypto à vendre.");
        setPinPrompt({ type: 'sell', asset, amount });
    };

    const executeSell = async (asset: string, amount: string, pin: string) => {
        setActionLoading(true);
        try {
            await request('POST', '/api/crypto/sell', { asset, amountCrypto: amount, pin }, true);
            const refreshed = await fetchCryptoData();
            if (refreshed) Alert.alert("Succès", `Vente de ${asset} exécutée avec succès.`);
            setAmounts(prev => ({ ...prev, [asset]: '' }));
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    const handlePinConfirm = (pin: string) => {
        const prompt = pinPrompt;
        setPinPrompt(null);
        if (!prompt) return;
        if (prompt.type === 'buy') executeBuy(prompt.asset, prompt.amount, pin);
        else executeSell(prompt.asset, prompt.amount, pin);
    };

    const getWalletBalance = (asset: string) => {
        const w = wallets.find(w => w.asset === asset);
        return w ? w.balance : 0;
    };

    if (isChild) {
        return (
            <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <Ionicons name="lock-closed-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 24 }}>
                    Cette fonctionnalité n'est pas disponible pour les comptes enfant.
                </Text>
                <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={{ backgroundColor: COLORS.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 }}>
                    <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.primary }}>
            {/* Header Clean */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.primary }}>
                <TouchableOpacity style={{ padding: 8, marginLeft: -12 }} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff' }}>Mongain Crypto</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={{ flex: 1, backgroundColor: COLORS.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
                <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 60) }]}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Marchés & Actifs</Text>
                        <Text style={styles.subtitle}>Achetez, vendez et tradez vos actifs numériques</Text>
                    </View>

                    {loading ? (
                        <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
                    ) : (
                        <View>
                            <BlurView intensity={isDark ? 50 : 80} tint={isDark ? "dark" : "light"} style={styles.portfolioGlass}>
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
                                                placeholderTextColor={COLORS.textSecondary}
                                                keyboardType="numeric"
                                                value={amounts[m.asset] || ''}
                                                onChangeText={(text) => setAmounts(prev => ({ ...prev, [m.asset]: text }))}
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
            </View>

            <PinPromptModal
                visible={!!pinPrompt}
                title={pinPrompt?.type === 'buy' ? "Confirmer l'achat" : 'Confirmer la vente'}
                message={pinPrompt ? `Saisissez votre code PIN Mongain pour ${pinPrompt.type === 'buy' ? 'acheter' : 'vendre'} du ${pinPrompt.asset}.` : ''}
                loading={actionLoading}
                onConfirm={handlePinConfirm}
                onCancel={() => setPinPrompt(null)}
                colors={COLORS}
            />
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>, isDark: boolean) => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    scroll: { padding: 24 },
    header: { marginBottom: 32, marginTop: 10 },
    title: { color: COLORS.textPrimary, fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', marginBottom: 8 },
    subtitle: { color: COLORS.textSecondary, fontSize: 16 },
    portfolioGlass: { padding: 30, borderRadius: 24, marginBottom: 40, borderBottomWidth: 4, borderBottomColor: '#A855F7', backgroundColor: isDark ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.05)', overflow: 'hidden' },
    portfolioLabel: { color: isDark ? 'rgba(255,255,255,0.5)' : COLORS.textSecondary, fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
    portfolioValue: { color: COLORS.textPrimary, fontSize: 40, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    sectionTitle: { color: COLORS.textPrimary, fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 20 },
    assetCard: { padding: 20, backgroundColor: COLORS.surface, borderRadius: 20, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
    assetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    assetName: { color: COLORS.textPrimary, fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    assetOwned: { color: COLORS.textSecondary, fontSize: 13, marginTop: 4 },
    assetPrice: { color: COLORS.textPrimary, fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 4 },
    actionRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    input: { flex: 1, backgroundColor: COLORS.background, padding: 12, borderRadius: 12, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, borderBottomWidth: 2, borderBottomColor: '#3B82F6' },
    btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 12, gap: 8, paddingHorizontal: 16 },
    btnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12 }
});

