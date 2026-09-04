import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { useAppTheme } from '../../constants/theme';
import { request } from '../../services/api';

export default function WaterScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [accountNumber, setAccountNumber] = useState('');
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const handleConfirm = () => {
        if (!accountNumber || accountNumber.length < 5) return Alert.alert('Erreur', 'Numéro de compteur invalide (min 5 chiffres).');
        if (!amount || Number(amount) <= 0) return Alert.alert('Erreur', 'Veuillez saisir un montant valide.');

        Alert.prompt(
            'Code PIN',
            `Confirmez le paiement de ${Number(amount).toLocaleString('fr-FR')} XAF pour le compteur d'eau SEEG N°${accountNumber}.`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Payer', onPress: (pin?: string) => executePayment(pin) }
            ],
            'secure-text'
        );
    };

    const executePayment = async (pin?: string) => {
        if (!pin) return Alert.alert('Erreur', 'Code PIN requis.');
        setLoading(true);
        try {
            const res = await request('POST', '/api/services/pay-bill', {
                service: 'SEEG',
                accountNumber,
                amount: Number(amount),
                pin
            }, true);
            Alert.alert('Succès', res.message || 'Facture réglée avec succès.');
            router.back();
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Paiement échoué.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Achat d'Eau (SEEG)" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
                    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Numéro de compteur (Edan)</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="Ex: 01429482..."
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="number-pad"
                                value={accountNumber}
                                onChangeText={setAccountNumber}
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <Text style={styles.label}>Montant de la recharge (XAF)</Text>
                            <TextInput
                                style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                                placeholder="10000"
                                placeholderTextColor={COLORS.textSecondary}
                                keyboardType="number-pad"
                                value={amount}
                                onChangeText={setAmount}
                            />
                        </View>

                        <View style={styles.infoBox}>
                            <Ionicons name="information-circle" size={24} color="#2563FF" />
                            <Text style={styles.infoText}>Le code token de recharge d'eau apparaîtra sur votre reçu juste après le paiement validé.</Text>
                        </View>

                    </ScrollView>

                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.submitBtn} onPress={handleConfirm} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Payer la facture d'eau</Text>}
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

    formGroup: { marginBottom: 20 },
    label: { fontSize: 13, fontFamily: 'Satoshi-SemiBold', color: '#666', marginBottom: 8, marginLeft: 4, fontWeight: 'bold' },
    input: { height: 56, borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold' },

    infoBox: { flexDirection: 'row', backgroundColor: '#2563FF15', padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 12 },
    infoText: { flex: 1, color: '#2563FF', fontSize: 13, marginLeft: 12, lineHeight: 18 },

    footer: { padding: 24, paddingBottom: 34, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    submitBtn: { backgroundColor: '#2563FF', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    submitText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
});
