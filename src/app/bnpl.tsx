import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

    const router = useRouter();
    const { settings } = useAuth();
    // Le taux était codé en dur à 5% ici alors que le serveur (bnpl.ts) le lit depuis
    // SystemSettings.bnplInterest, réglable par un admin — un changement de ce taux en
    // production laissait cet écran afficher un aperçu de frais/dette totale entièrement
    // faux (celui de l'ancien taux), sans jamais correspondre au contrat réellement créé
    // côté serveur.
    const bnplInterest = settings?.bnplInterest ?? DEFAULT_BNPL_INTEREST;

    const handleApply = async () => {
        if (!amount || !pin) return Alert.alert("Erreur", "Saisissez un montant et votre PIN.");
        setLoading(true);
        try {
            const res = await request('POST', '/api/bnpl/apply', { amountXaf: amount, months, pin }, true) as { message: string };
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
            const res = await request('POST', '/api/bnpl/repay', { amountXaf: amount, pin }, true) as { message: string };
            Alert.alert("Remboursement Confirmé", res.message);
            setAmount('');
            setPin('');
        } catch (e: any) {
            Alert.alert("Échec", e.response?.data?.error || "Erreur lors du remboursement.");
        }
        setLoading(false);
    };

    const simFee = parseFloat(amount || '0') * bnplInterest;
    const simTotal = parseFloat(amount || '0') + simFee;

    return (
        <ScrollView style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
            <View style={{ backgroundColor: '#1E1B4B', paddingTop: 60, paddingBottom: 40, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
                <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
                    <Ionicons name="arrow-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={{ fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: '#FFF' }}>Mongain BNPL</Text>
                <Text style={{ fontSize: 16, color: '#A5B4FC', marginTop: 4 }}>Achetez maintenant. Payez plus tard.</Text>
            </View>

            <View style={{ padding: 20, marginTop: -20 }}>
                {/* Tabs */}
                <View style={{ flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 6, marginBottom: 24, elevation: 2, shadowOpacity: 0.05 }}>
                    <TouchableOpacity
                        onPress={() => setTab('BORROW')}
                        style={[{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 }, tab === 'BORROW' && { backgroundColor: '#4F46E5' }]}
                    >
                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: tab === 'BORROW' ? '#FFF' : '#64748B' }}>Emprunter</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setTab('REPAY')}
                        style={[{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 }, tab === 'REPAY' && { backgroundColor: '#059669' }]}
                    >
                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: tab === 'REPAY' ? '#FFF' : '#64748B' }}>Rembourser</Text>
                    </TouchableOpacity>
                </View>

                {/* Form */}
                <View style={{ backgroundColor: '#FFF', borderRadius: 24, padding: 24, elevation: 2, shadowOpacity: 0.05, shadowRadius: 10 }}>
                    <Text style={{ color: '#1E293B', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>
                        {tab === 'BORROW' ? "Montant Désiré (FCFA)" : "Remboursement (FCFA)"}
                    </Text>
                    <TextInput
                        style={{ backgroundColor: '#F1F5F9', borderRadius: 16, padding: 18, fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 20, color: '#0F172A' }}
                        placeholder="Ex: 25000"
                        keyboardType="numeric"
                        value={amount}
                        onChangeText={setAmount}
                    />

                    {tab === 'BORROW' && (
                        <>
                            <Text style={{ color: '#1E293B', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>Amortissement (Mois)</Text>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
                                {[1, 2, 3, 4].map((m) => (
                                    <TouchableOpacity
                                        key={m}
                                        onPress={() => setMonths(m)}
                                        style={[{ padding: 16, borderRadius: 12, backgroundColor: '#F1F5F9', width: '22%', alignItems: 'center' }, months === m && { backgroundColor: '#E0E7FF', borderWidth: 2, borderColor: '#4F46E5' }]}
                                    >
                                        <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: months === m ? '#4F46E5' : '#64748B' }}>{m}x</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* BNPL Summary */}
                            <View style={{ backgroundColor: '#F8FAFC', borderRadius: 16, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: '#E2E8F0', borderStyle: 'dashed' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <Text style={{ color: '#64748B' }}>Avance Tiers</Text>
                                    <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#1E293B' }}>{amount || '0'} F</Text>
                                </View>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <Text style={{ color: '#64748B' }}>Frais ({(bnplInterest * 100).toLocaleString('fr-FR')}%)</Text>
                                    <Text style={{ color: '#F43F5E', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>+ {simFee} F</Text>
                                </View>
                                <View style={{ height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 }}></View>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                                    <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: '#1E293B', fontSize: 16 }}>Dette Totale</Text>
                                    <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: '900', color: '#4F46E5', fontSize: 16 }}>{simTotal} F</Text>
                                </View>
                            </View>
                        </>
                    )}

                    <Text style={{ color: '#1E293B', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8, fontSize: 15 }}>Votre code PIN</Text>
                    <TextInput
                        style={{ backgroundColor: '#F1F5F9', borderRadius: 16, padding: 18, fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 24, letterSpacing: 8, color: '#0F172A' }}
                        placeholder="⬢⬢⬢⬢"
                        keyboardType="numeric"
                        secureTextEntry
                        maxLength={4}
                        value={pin}
                        onChangeText={setPin}
                    />

                    <TouchableOpacity
                        onPress={tab === 'BORROW' ? handleApply : handleRepay}
                        disabled={loading}
                        style={{ backgroundColor: tab === 'BORROW' ? '#4F46E5' : '#059669', borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: tab === 'BORROW' ? '#4F46E5' : '#059669', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4 }}
                    >
                        {loading ? <ActivityIndicator color="#FFF" /> : (
                            <Text style={{ color: '#FFF', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '900' }}>
                                {tab === 'BORROW' ? "Débloquer les Fonds" : "Payer ma Dette"}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </ScrollView>
    );
}

