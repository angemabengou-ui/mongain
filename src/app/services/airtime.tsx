import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import PinPromptModal from '../../components/ui/PinPromptModal';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { useAppTheme } from '../../constants/theme';
import { request } from '../../services/api';

export default function AirtimeScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [network, setNetwork] = useState<'AIRTEL' | 'MOOV'>('AIRTEL');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    // Remplace Alert.prompt (n'existe que sur iOS, no-op silencieux sur Android — voir
    // PinPromptModal).
    const [showPinPrompt, setShowPinPrompt] = useState(false);

    const handleConfirm = () => {
        if (!phoneNumber || phoneNumber.length < 8) return Alert.alert('Erreur', 'Numéro de téléphone invalide.');
        if (!amount || Number(amount) <= 0) return Alert.alert('Erreur', 'Veuillez saisir un montant valide.');
        setShowPinPrompt(true);
    };

    const executeTopup = async (pin: string) => {
        setShowPinPrompt(false);
        setLoading(true);
        try {
            const res = await request('POST', '/api/services/topup', {
                network,
                phoneNumber,
                amount: Number(amount),
                pin
            }, true);
            Alert.alert('Succès', res.message || 'Recharge effectuée avec succès.');
            router.back();
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'La recharge a échoué.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Recharge de Crédit" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                        <Text style={styles.label}>Sélectionnez l'opérateur</Text>
                        <View style={styles.networkSelector}>
                            <TouchableOpacity
                                style={[styles.networkBtn, network === 'AIRTEL' && styles.networkSelected]}
                                onPress={() => setNetwork('AIRTEL')}
                            >
                                <Ionicons name="radio" size={24} color={network === 'AIRTEL' ? '#fff' : COLORS.textSecondary} />
                                <Text style={[styles.networkBtnText, network === 'AIRTEL' && { color: '#fff' }]}>Airtel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.networkBtn, network === 'MOOV' && styles.networkSelected]}
                                onPress={() => setNetwork('MOOV')}
                            >
                                <Ionicons name="cellular" size={24} color={network === 'MOOV' ? '#fff' : COLORS.textSecondary} />
                                <Text style={[styles.networkBtnText, network === 'MOOV' && { color: '#fff' }]}>Moov</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Numéro de téléphone</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="077..."
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="phone-pad"
                                value={phoneNumber}
                                onChangeText={setPhoneNumber}
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Montant de la recharge (XAF)</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="2000"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="number-pad"
                                value={amount}
                                onChangeText={setAmount}
                            />
                        </View>

                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.submitBtn} onPress={handleConfirm} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Envoyer la recharge</Text>}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </View>

            <PinPromptModal
                visible={showPinPrompt}
                title="Code PIN"
                message={`Confirmez la recharge de ${Number(amount || 0).toLocaleString('fr-FR')} XAF sur le ${phoneNumber} (${network}).`}
                loading={loading}
                onConfirm={executeTopup}
                onCancel={() => setShowPinPrompt(false)}
                colors={COLORS}
            />
        </SafeAreaView>
    );
}

const getStyles = (COLORS: any) => StyleSheet.create({
    safeArea: { flex: 1 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
    scroll: { flexGrow: 1, padding: 24 },

    networkSelector: { flexDirection: 'row', gap: 16, marginBottom: 24 },
    networkBtn: { flex: 1, height: 80, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.surface },
    networkSelected: { backgroundColor: '#2563FF', borderColor: '#2563FF' },
    networkBtnText: { marginTop: 8, fontSize: 13, fontFamily: 'Satoshi-SemiBold', color: COLORS.textPrimary, fontWeight: 'bold' },

    formGroup: { marginBottom: 20 },
    label: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', color: '#666', marginBottom: 8, marginLeft: 4, fontWeight: 'bold' },
    input: { height: 56, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold' },

    footer: { padding: 24, paddingBottom: 34, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    submitBtn: { backgroundColor: '#2563FF', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    submitText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});
