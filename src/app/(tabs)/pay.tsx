import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ScreenHeader from '../../components/ui/ScreenHeader';
import { request } from '../../services/api';

// Encaissement marchand (le client autorise avec SON PIN, pas le marchand) — cet écran
// n'est plus dans le flux normal des onglets : l'onglet central de la tab bar (voir
// (tabs)/_layout.tsx) redirige désormais vers le scanner QR "je paie" (src/app/qr.tsx,
// pour le CLIENT qui scanne le code d'un marchand). On y accède maintenant uniquement
// depuis merchant-hub.tsx ("Encaisser un client"), le seul contexte où cette action a un
// sens. L'ancien onglet "Mon Code" (QR généré ici) est retiré : c'était un visuel fixe
// non scannable (pas un vrai QR code), doublon non-fonctionnel de /receive-qr qui, lui,
// génère de vrais QR codes (react-native-qrcode-svg) pour les deux encaissements
// distincts d'un marchand (paiement/retrait).
export default function PayScreen() {
    const router = useRouter();
    const [scannedUserId, setScannedUserId] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);

    const handleScanMock = async () => {
        if (!scannedUserId || !amount) return Alert.alert("Erreur", "L'ID et le montant sont requis.");
        if (!pin || pin.length !== 4) return Alert.alert("Erreur", "Le client doit saisir son code PIN à 4 chiffres pour autoriser le paiement.");
        const parsedAmount = Math.round(parseFloat(amount) || 0);
        if (parsedAmount <= 0) return Alert.alert("Erreur", "Montant invalide.");
        setLoading(true);
        try {
            await request('POST', '/api/pay/qr-scan', { scannedCode: scannedUserId, amountXaf: parsedAmount, pin }, true);
            Alert.alert("Succès", `Encaissement de ${parsedAmount.toLocaleString('fr-FR')} XAF validé avec succès !`);
            setScannedUserId('');
            setAmount('');
            setPin('');
        } catch (e: any) {
            Alert.alert("Échec", e.response?.data?.error || "Paiement refusé.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScreenHeader title="Encaisser un client" onBack={() => router.back()} />

            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.scanView}>
                    <Text style={styles.subtitle}>Encaissement physique</Text>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Montant à encaisser (XAF)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="ex: 15000"
                            placeholderTextColor="#64748b"
                            keyboardType="number-pad"
                            value={amount}
                            onChangeText={setAmount}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Scanner le QR Client (Mock = Saisir l'ID JWT)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="ID Client / Scanned Code"
                            placeholderTextColor="#64748b"
                            value={scannedUserId}
                            onChangeText={setScannedUserId}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Code PIN du client (saisi par le client, pas par vous)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="⬢⬢⬢⬢"
                            placeholderTextColor="#64748b"
                            keyboardType="numeric"
                            secureTextEntry
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                        />
                    </View>

                    <TouchableOpacity style={[styles.actionBtn, loading && { opacity: 0.7 }]} onPress={handleScanMock} disabled={loading}>
                        {loading ? <ActivityIndicator color="#fff" /> : (
                            <>
                                <Ionicons name="scan-circle" color="#fff" size={24} />
                                <Text style={styles.actionBtnText}>VALIDER L'ENCAISSEMENT</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    scroll: { padding: 24 },
    subtitle: { color: '#94a3b8', fontSize: 16, textAlign: 'center', marginBottom: 40 },
    scanView: { alignItems: 'stretch' },
    inputGroup: { marginBottom: 24 },
    label: { color: '#94a3b8', marginBottom: 8, fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    input: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    actionBtn: { backgroundColor: '#3B82F6', borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 10 },
    actionBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' }
});
