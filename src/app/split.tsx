import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { request } from '../services/api';

export default function SplitScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const [amountStr, setAmountStr] = useState('');
    const [phonesStr, setPhonesStr] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingSplits, setPendingSplits] = useState<any[]>([]);

    useEffect(() => {
        fetchPending();
    }, []);

    const fetchPending = async () => {
        try {
            const res = await request('GET', '/api/split/pending', {}, true);
            setPendingSplits(res.pending || []);
        } catch (e) {
            console.warn("Erreur fetch pending splits", e);
        }
    };

    const handleCreateSplit = async () => {
        if (!amountStr || !phonesStr) return Alert.alert("Erreur", "Veuillez remplir le montant et au moins un numéro.");

        const phones = phonesStr.split(',').map(p => p.trim()).filter(p => p);
        if (phones.length === 0) return Alert.alert("Erreur", "Aucun numéro valide.");

        setLoading(true);
        try {
            await request('POST', '/api/split/request', {
                targetPhones: phones,
                splitAmountPerPerson: amountStr
            }, true);
            Alert.alert("Succès", `Demande de ${amountStr} XAF envoyée à ${phones.length} contact(s) !`);
            setAmountStr('');
            setPhonesStr('');
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Echec de l'envoi");
        } finally {
            setLoading(false);
        }
    };

    const handlePaySplit = async (id: string, amount: number, name: string) => {
        Alert.alert(
            "Confirmer le paiement",
            `Voulez-vous vraiment transférer ${amount} XAF à ${name} ?`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Payer",
                    style: 'default',
                    onPress: async () => {
                        setLoading(true);
                        try {
                            await request('POST', `/api/split/pay/${id}`, {}, true);
                            Alert.alert("Payé !", "La dette a été remboursée.");
                            fetchPending();
                        } catch (e: any) {
                            Alert.alert("Erreur", e.response?.data?.error || "Le paiement a échoué.");
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
                    <Text style={styles.title}>Mongain Split</Text>
                </View>

                <ScrollView contentContainerStyle={styles.scroll}>

                    {/* EN ATTENTE DE PAIEMENT (Dettes de l'utilisateur) */}
                    {pendingSplits.length > 0 && (
                        <View style={styles.pendingSection}>
                            <View style={styles.sectionHeader}>
                                <Ionicons name="alert-circle" size={20} color="#EF4444" />
                                <Text style={styles.sectionTitle}>À rembourser</Text>
                            </View>

                            {pendingSplits.map(req => (
                                <View key={req.id} style={styles.pendingCard}>
                                    <View>
                                        <Text style={styles.pendingName}>{req.requester.name}</Text>
                                        <Text style={styles.pendingAmount}>{req.amount.toLocaleString()} XAF</Text>
                                    </View>
                                    <TouchableOpacity style={styles.payBtn} onPress={() => handlePaySplit(req.id, req.amount, req.requester.name)}>
                                        <Text style={styles.payBtnText}>Payer</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* CREATION D'UN SPLIT */}
                    <View style={styles.createBox}>
                        <View style={styles.createHeader}>
                            <Ionicons name="pie-chart" size={24} color="#6366f1" />
                            <Text style={styles.createTitle}>Diviser l'addition</Text>
                        </View>
                        <Text style={styles.createDesc}>Envoyez automatiquement des requêtes de paiement XAF par notification à vos amis.</Text>

                        <Text style={styles.label}>Montant demandé par personne (XAF)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="ex: 5000"
                            placeholderTextColor="#64748b"
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={setAmountStr}
                        />

                        <Text style={styles.label}>Numéros de téléphone (séparés par virgule)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="ex: +24177700001, +24177700002"
                            placeholderTextColor="#64748b"
                            value={phonesStr}
                            onChangeText={setPhonesStr}
                        />

                        <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.7 }]} onPress={handleCreateSplit} disabled={loading}>
                            {loading ? <ActivityIndicator color="#fff" /> : (
                                <>
                                    <Ionicons name="paper-plane" color="#fff" size={20} />
                                    <Text style={styles.submitBtnText}>Envoyer les requêtes</Text>
                                </>
                            )}
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
    title: { color: '#ffffff', fontSize: 24, fontWeight: '800' },

    scroll: { padding: 20 },

    pendingSection: { marginBottom: 32 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    sectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    pendingCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' },
    pendingName: { color: '#fff', fontSize: 16, fontWeight: '600' },
    pendingAmount: { color: '#EF4444', fontSize: 18, fontWeight: '900', marginTop: 4 },
    payBtn: { backgroundColor: '#EF4444', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
    payBtnText: { color: '#fff', fontWeight: 'bold' },

    createBox: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    createHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    createTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
    createDesc: { color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 20 },

    label: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginBottom: 8 },
    input: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    submitBtn: { backgroundColor: '#6366f1', borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
