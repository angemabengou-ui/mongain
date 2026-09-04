import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function PayScreen() {
    const { token, user } = useAuth();
    const [mode, setMode] = useState<'QR' | 'SCAN'>('QR');
    const [scannedUserId, setScannedUserId] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);

    // Mock QR generator animation
    const [rotation, setRotation] = useState(0);
    useEffect(() => {
        if (mode === 'QR') {
            const intv = setInterval(() => setRotation(r => (r + 1) % 4), 3000);
            return () => clearInterval(intv);
        }
    }, [mode]);

    const handleScanMock = async () => {
        if (!scannedUserId || !amount) return Alert.alert("Erreur", "L'ID et le montant sont requis.");
        if (!pin || pin.length !== 4) return Alert.alert("Erreur", "Le client doit saisir son code PIN à 4 chiffres pour autoriser le paiement.");
        setLoading(true);
        try {
            await request('POST', '/api/pay/qr-scan', { scannedCode: scannedUserId, amountXaf: amount, pin }, true);
            Alert.alert("Succès", `Encaissement de ${amount} XAF validé avec succès !`);
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
            <View style={styles.header}>
                <Text style={styles.title}>Mongain Pay</Text>
            </View>

            <View style={styles.tabContainer}>
                <TouchableOpacity style={[styles.tab, mode === 'QR' && styles.tabActive]} onPress={() => setMode('QR')}>
                    <Ionicons name="qr-code" size={20} color={mode === 'QR' ? "#fff" : "#94a3b8"} />
                    <Text style={[styles.tabText, mode === 'QR' && styles.tabTextActive]}>Mon Code</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, mode === 'SCAN' && styles.tabActive]} onPress={() => setMode('SCAN')}>
                    <Ionicons name="scan" size={20} color={mode === 'SCAN' ? "#fff" : "#94a3b8"} />
                    <Text style={[styles.tabText, mode === 'SCAN' && styles.tabTextActive]}>Scanner</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                {mode === 'QR' ? (
                    <View style={styles.qrView}>
                        <Text style={styles.subtitle}>Présentez ce code au marchand pour payer</Text>

                        <BlurView intensity={50} tint="dark" style={styles.qrBox}>
                            {/* Fake Animated QR Code Visual */}
                            <View style={[styles.qrMock, { transform: [{ rotate: `${rotation * 90}deg` }] }]}>
                                <View style={styles.qrCornerTopLeft} />
                                <View style={styles.qrCornerTopRight} />
                                <View style={styles.qrCornerBottomLeft} />
                                <View style={styles.qrCenterCore} />
                            </View>

                            <Text style={styles.qrFooter}>Actualisé automatiquement</Text>
                        </BlurView>

                        <Text style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 20 }}>
                            Identifiant d'encaissement natif : {user?.id?.substring(0, 8)}...
                        </Text>
                    </View>
                ) : (
                    <View style={styles.scanView}>
                        <Text style={styles.subtitle}>Côté Marchand : Encaissement physique</Text>

                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>Montant à encaisser (XAF)</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="ex: 15000"
                                placeholderTextColor="#64748b"
                                keyboardType="numeric"
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
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    header: { padding: 24, paddingBottom: 12 },
    title: { color: '#ffffff', fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    tabContainer: { flexDirection: 'row', paddingHorizontal: 24, marginBottom: 20 },
    tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'rgba(255,255,255,0.1)', flexDirection: 'row', justifyContent: 'center', gap: 8 },
    tabActive: { borderBottomColor: '#3B82F6' },
    tabText: { color: '#94a3b8', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    tabTextActive: { color: '#ffffff' },
    scroll: { padding: 24 },
    subtitle: { color: '#94a3b8', fontSize: 16, textAlign: 'center', marginBottom: 40 },

    // QR Gen Visuals
    qrView: { alignItems: 'center' },
    qrBox: { width: 300, height: 350, borderRadius: 24, padding: 30, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center' },
    qrFooter: { color: 'rgba(255,255,255,0.3)', marginTop: 40, fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    qrMock: { width: 200, height: 200, backgroundColor: '#fff', borderRadius: 16, padding: 20, position: 'relative' },
    qrCornerTopLeft: { position: 'absolute', top: 15, left: 15, width: 40, height: 40, borderWidth: 8, borderColor: '#000', borderRadius: 8 },
    qrCornerTopRight: { position: 'absolute', top: 15, right: 15, width: 40, height: 40, borderWidth: 8, borderColor: '#000', borderRadius: 8 },
    qrCornerBottomLeft: { position: 'absolute', bottom: 15, left: 15, width: 40, height: 40, borderWidth: 8, borderColor: '#000', borderRadius: 8 },
    qrCenterCore: { position: 'absolute', top: 70, left: 70, width: 60, height: 60, backgroundColor: '#000', borderRadius: 4 },

    // Scan View Visuals
    scanView: { alignItems: 'stretch' },
    inputGroup: { marginBottom: 24 },
    label: { color: '#94a3b8', marginBottom: 8, fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    input: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    actionBtn: { backgroundColor: '#3B82F6', borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 10 },
    actionBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' }
});

