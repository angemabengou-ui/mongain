import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { request } from '../services/api';

export default function BillersScreen() {
    const [provider, setProvider] = useState<'SEEG' | 'CANAL'>('SEEG');
    const [reference, setReference] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);

    const router = useRouter();

    const handlePayment = async () => {
        if (!reference || !amount || !pin) {
            return Alert.alert("Erreur", "Veuillez remplir tous les champs !");
        }
        setLoading(true);
        try {
            const res = await request('POST', '/api/billers/pay', {
                provider, reference, amountXaf: amount, pin
            }, true) as { success: boolean, message: string };

            Alert.alert("Succès", res.message, [{ text: "Génial", onPress: () => router.back() }]);
        } catch (error: any) {
            Alert.alert("Échec du paiement", error.response?.data?.error || "Vérifiez vos données de facturation.");
        }
        setLoading(false);
    };

    return (
        <ScrollView style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
            <View style={{ backgroundColor: '#059669', paddingTop: 60, paddingBottom: 30, paddingHorizontal: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
                <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 16 }}>
                    <Ionicons name="arrow-back" size={28} color="#FFF" />
                </TouchableOpacity>
                <Text style={{ fontSize: 26, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#FFF' }}>Payer une Facture</Text>
                <Text style={{ fontSize: 15, color: '#D1FAE5', marginTop: 4, fontFamily: 'Satoshi-Regular' }}>Payez SEEG et Canal+ via Mongain</Text>
            </View>

            <View style={{ padding: 20 }}>
                {/* Provider Selector */}
                <Text style={{ fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>Fournisseurs</Text>
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                    <TouchableOpacity
                        onPress={() => setProvider('SEEG')}
                        style={[{ flex: 1, backgroundColor: '#FFF', padding: 16, borderRadius: 16, alignItems: 'center', shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 }, provider === 'SEEG' && { borderWidth: 2, borderColor: '#059669' }]}
                    >
                        <Ionicons name="flash" size={32} color={provider === 'SEEG' ? '#059669' : '#94A3B8'} />
                        <Text style={{ marginTop: 8, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: provider === 'SEEG' ? '#059669' : '#64748b' }}>SEEG (EDAN)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={() => setProvider('CANAL')}
                        style={[{ flex: 1, backgroundColor: '#FFF', padding: 16, borderRadius: 16, alignItems: 'center', shadowOpacity: 0.05, shadowRadius: 10, elevation: 1 }, provider === 'CANAL' && { borderWidth: 2, borderColor: '#3B82F6' }]}
                    >
                        <Ionicons name="tv" size={32} color={provider === 'CANAL' ? '#3B82F6' : '#94A3B8'} />
                        <Text style={{ marginTop: 8, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: provider === 'CANAL' ? '#3B82F6' : '#64748b' }}>CANAL+</Text>
                    </TouchableOpacity>
                </View>

                {/* Form */}
                <View style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 20, elevation: 2, shadowOpacity: 0.05, shadowRadius: 10 }}>
                    <Text style={{ color: '#1A1A1A', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 6 }}>Numéro {provider === 'SEEG' ? "Compteur" : "Abonné"}</Text>
                    <TextInput
                        style={{ backgroundColor: '#F1F5F9', borderRadius: 12, padding: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 16 }}
                        placeholder={`Saisissez le N° ${provider}`}
                        keyboardType="default"
                        value={reference}
                        onChangeText={setReference}
                    />

                    <Text style={{ color: '#1A1A1A', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 6 }}>Montant (FCFA)</Text>
                    <TextInput
                        style={{ backgroundColor: '#F1F5F9', borderRadius: 12, padding: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 16 }}
                        placeholder="Ex: 5000"
                        keyboardType="numeric"
                        value={amount}
                        onChangeText={setAmount}
                    />

                    <Text style={{ color: '#1A1A1A', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 6 }}>Code PIN Mongain</Text>
                    <TextInput
                        style={{ backgroundColor: '#F1F5F9', borderRadius: 12, padding: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 24, letterSpacing: 8 }}
                        placeholder="••••"
                        keyboardType="numeric"
                        secureTextEntry
                        maxLength={4}
                        value={pin}
                        onChangeText={setPin}
                    />

                    <TouchableOpacity
                        onPress={handlePayment}
                        disabled={loading}
                        style={{ backgroundColor: provider === 'SEEG' ? '#059669' : '#3B82F6', borderRadius: 12, padding: 18, alignItems: 'center' }}
                    >
                        {loading ? <ActivityIndicator color="#FFF" /> : (
                            <Text style={{ color: '#FFF', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Valider le Paiement</Text>
                        )}
                    </TouchableOpacity>
                </View>

            </View>
        </ScrollView>
    );
}
