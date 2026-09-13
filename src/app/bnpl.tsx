import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { request } from '../services/api';

// Repli identique à DEFAULT_BNPL_INTEREST côté serveur (backend/src/routes/bnpl.ts) — utilisé
// uniquement le temps que `settings` (AuthContext) charge, jamais comme valeur définitive.
const DEFAULT_BNPL_INTEREST = 0.05;

export default function BNPLScreen() {
    const [amount, setAmount] = useState('');
    const [months, setMonths] = useState(1);
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState<'BORROW' | 'REPAY'>('BORROW');

    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const router = useRouter();
    const { settings, user } = useAuth();
    const bnplInterest = settings?.bnplInterest ?? DEFAULT_BNPL_INTEREST;

    // Filet de sécurité UX (pas la barrière de sécurité — le backend refuse déjà ces routes
    // pour un CHILD) : couvre un lien profond périmé, une notification, ou tout autre chemin
    // qui contournerait les boutons/onglet masqués côté navigation ((tabs)/index.tsx et
    // (tabs)/_layout.tsx).
    const isChild = user?.role === 'CHILD';
    // Marchand Géant — palier consultation-seule sur mobile (voir User.merchantTier,
    // (tabs)/index.tsx) : souscrire/rembourser un BNPL déplace de l'argent, même filet de
    // sécurité UX ci-dessous que pour un Compte Enfant.
    const isGiantMerchant = user?.merchantTier === 'GIANT';

    // Le FCFA n'a aucune sous-unité — arrondi à l'entier avant envoi, et virgule acceptée en
    // saisie comme séparateur décimal (voir docs/AUTO_CRITIQUE_PROJET.md).
    const cleanAmount = () => Math.round(parseFloat(amount.replace(/\s/g, '').replace(',', '.')) || 0);

    const handleApply = async () => {
        if (!amount || !pin) return Alert.alert("Erreur", "Saisissez un montant et votre PIN.");
        setLoading(true);
        try {
            const res = await request('POST', '/api/bnpl/apply', { amountXaf: cleanAmount(), months, pin }, true) as { message: string };
            Alert.alert("Félicitations", res.message, [{ text: "Compris", onPress: () => router.back() }]);
        } catch (e: any) {
            Alert.alert("Refus", e.response?.data?.error || "Le crédit vous est refusé.");
        }
        setLoading(false);
    };

    const handleRepay = async () => {
        if (!amount || !pin) return Alert.alert("Erreur", "Saisissez un montant et votre PIN.");
        setLoading(true);
        try {
            const res = await request('POST', '/api/bnpl/repay', { amountXaf: cleanAmount(), pin }, true) as { message: string };
            Alert.alert("Remboursement Confirmé", res.message);
            setAmount('');
            setPin('');
        } catch (e: any) {
            Alert.alert("Échec", e.response?.data?.error || "Erreur lors du remboursement.");
        }
        setLoading(false);
    };

    const simFee = Math.round(cleanAmount() * bnplInterest);
    const simTotal = cleanAmount() + simFee;

    if (isChild || isGiantMerchant) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                <Ionicons name="lock-closed-outline" size={48} color={COLORS.textSecondary} style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 24 }}>
                    {isGiantMerchant ? "Cette fonctionnalité est réservée au portail web pour un compte marchand géant." : "Cette fonctionnalité n'est pas disponible pour les comptes enfant."}
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
                    <Ionicons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff' }}>Paiement x3</Text>
                <View style={{ width: 44 }} />
            </View>

            <View style={{ flex: 1, backgroundColor: COLORS.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 60) }}>

                    <View style={{ marginBottom: 24 }}>
                        <Text style={{ fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: COLORS.textPrimary }}>Mongain BNPL</Text>
                        <Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 4 }}>Achetez maintenant. Payez plus tard.</Text>
                    </View>

                    {/* Tabs */}
                    <View style={{ flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 16, padding: 6, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border }}>
                        <TouchableOpacity
                            onPress={() => setTab('BORROW')}
                            style={[{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 }, tab === 'BORROW' && { backgroundColor: COLORS.primary }]}
                        >
                            <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: tab === 'BORROW' ? '#FFF' : COLORS.textSecondary }}>Emprunter</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => setTab('REPAY')}
                            style={[{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 }, tab === 'REPAY' && { backgroundColor: '#10B981' }]}
                        >
                            <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: tab === 'REPAY' ? '#FFF' : COLORS.textSecondary }}>Rembourser</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Form */}
                    <View style={{ backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 }}>
                        <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>
                            {tab === 'BORROW' ? "Montant Désiré (FCFA)" : "Remboursement (FCFA)"}
                        </Text>
                        <TextInput
                            style={{ backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 18, fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 20, color: COLORS.textPrimary }}
                            placeholder="Ex: 25000"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            value={amount}
                            onChangeText={setAmount}
                        />

                        {tab === 'BORROW' && (
                            <>
                                <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>Amortissement (Mois)</Text>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
                                    {[1, 2, 3, 4].map((m) => (
                                        <TouchableOpacity
                                            key={m}
                                            onPress={() => setMonths(m)}
                                            style={[{ padding: 16, borderRadius: 12, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, width: '22%', alignItems: 'center' }, months === m && { backgroundColor: COLORS.primary + '15', borderWidth: 2, borderColor: COLORS.primary }]}
                                        >
                                            <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: months === m ? COLORS.primary : COLORS.textSecondary }}>{m}x</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>

                                {/* BNPL Summary */}
                                <View style={{ backgroundColor: COLORS.background, borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' }}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <Text style={{ color: COLORS.textSecondary }}>Avance Tiers</Text>
                                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary }}>{amount || '0'} F</Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <Text style={{ color: COLORS.textSecondary }}>Frais ({(bnplInterest * 100).toLocaleString('fr-FR')}%)</Text>
                                        <Text style={{ color: '#F43F5E', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>+ {simFee} F</Text>
                                    </View>
                                    <View style={{ height: 1, backgroundColor: COLORS.border, marginVertical: 8 }}></View>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: COLORS.textPrimary, fontSize: 16 }}>Dette Totale</Text>
                                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: COLORS.primary, fontSize: 16 }}>{simTotal} F</Text>
                                    </View>
                                </View>
                            </>
                        )}

                        <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>Votre code PIN</Text>
                        <TextInput
                            style={{ backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 18, fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 24, letterSpacing: 8, color: COLORS.textPrimary }}
                            placeholder="⬢⬢⬢⬢"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            secureTextEntry
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                        />

                        <TouchableOpacity
                            onPress={tab === 'BORROW' ? handleApply : handleRepay}
                            disabled={loading}
                            style={{ backgroundColor: tab === 'BORROW' ? COLORS.primary : '#10B981', borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: tab === 'BORROW' ? COLORS.primary : '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 }}
                        >
                            {loading ? <ActivityIndicator color="#FFF" /> : (
                                <Text style={{ color: '#FFF', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '900' }}>
                                    {tab === 'BORROW' ? "Débloquer les Fonds" : "Payer ma Dette"}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </View>
        </SafeAreaView>
    );
}

