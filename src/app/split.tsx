import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useRef, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { request } from '../services/api';

export default function SplitScreen() {
    const router = useRouter();
    const { user } = useAuth();
    const [amountStr, setAmountStr] = useState('');
    const [phonesStr, setPhonesStr] = useState('');
    const [loading, setLoading] = useState(false);
    const [pendingSplits, setPendingSplits] = useState<any[]>([]);
    // Id de la demande en cours de règlement, pour révéler son champ PIN inline — Alert.prompt
    // (utilisé jusqu'ici) n'existe que sur iOS : sur Android, react-native.Alert.prompt est un
    // no-op total (aucune boîte de dialogue, aucun callback), donc "Payer" ne faisait
    // strictement rien, sans la moindre erreur. Même schéma PIN que transfer-confirm.tsx
    // (TextInput dédié, pas de dépendance à une API native limitée à une seule plateforme).
    const [payingSplit, setPayingSplit] = useState<{ id: string; amount: number; name: string } | null>(null);
    const [payPin, setPayPin] = useState('');
    const creatingSplitRef = useRef(false);
    const payingSplitRef = useRef(false);

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
        if (creatingSplitRef.current) return;
        if (!amountStr || !phonesStr) return Alert.alert("Erreur", "Veuillez remplir le montant et au moins un numéro.");

        // Un montant "0", négatif ou non numérique passait jusqu'ici tel quel jusqu'au
        // serveur (qui le rejette, mais sans que l'utilisateur ait été prévenu avant de
        // taper "Envoyer") — même validation que les autres écrans de mouvement de fonds.
        const parsedAmount = Number(amountStr.trim().replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return Alert.alert("Erreur", "Le montant par personne doit être un nombre positif.");
        }

        const phones = phonesStr.split(',').map(p => p.trim()).filter(p => p);
        if (phones.length === 0) return Alert.alert("Erreur", "Aucun numéro valide.");

        creatingSplitRef.current = true;
        setLoading(true);
        try {
            await request('POST', '/api/split/request', {
                targetPhones: phones,
                splitAmountPerPerson: parsedAmount
            }, true);
            Alert.alert("Succès", `Demande de ${amountStr} XAF envoyée à ${phones.length} contact(s) !`);
            setAmountStr('');
            setPhonesStr('');
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Echec de l'envoi");
        } finally {
            creatingSplitRef.current = false;
            setLoading(false);
        }
    };

    const handlePaySplit = (id: string, amount: number, name: string) => {
        setPayPin('');
        setPayingSplit({ id, amount, name });
    };

    const executePaySplit = async () => {
        if (payingSplitRef.current || !payingSplit) return;
        if (!payPin || payPin.length !== 4) return Alert.alert("Erreur", "Code PIN à 4 chiffres requis.");
        payingSplitRef.current = true;
        setLoading(true);
        try {
            await request('POST', `/api/split/pay/${payingSplit.id}`, { pin: payPin }, true);
            Alert.alert("Payé !", "La dette a été remboursée.");
            setPayingSplit(null);
            setPayPin('');
            fetchPending();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Le paiement a échoué.");
        } finally {
            payingSplitRef.current = false;
            setLoading(false);
        }
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

            <Modal transparent animationType="fade" visible={!!payingSplit} onRequestClose={() => setPayingSplit(null)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Code PIN</Text>
                        <Text style={styles.modalSubtitle}>
                            Confirmez le remboursement de {payingSplit?.amount.toLocaleString()} XAF à {payingSplit?.name} avec votre code PIN Mongain.
                        </Text>
                        <TextInput
                            style={styles.modalPinInput}
                            keyboardType="number-pad"
                            secureTextEntry
                            maxLength={4}
                            value={payPin}
                            onChangeText={setPayPin}
                            placeholder="••••"
                            placeholderTextColor="#64748b"
                            autoFocus
                        />
                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setPayingSplit(null)} disabled={loading}>
                                <Text style={styles.modalBtnCancelText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalBtn, styles.modalBtnConfirm]} onPress={executePaySplit} disabled={loading || payPin.length !== 4}>
                                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnConfirmText}>Payer</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16 },
    backBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12 },
    title: { color: '#ffffff', fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },

    scroll: { padding: 20 },

    pendingSection: { marginBottom: 32 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    sectionTitle: { color: '#fff', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    pendingCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.2)' },
    pendingName: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    pendingAmount: { color: '#EF4444', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '900', marginTop: 4 },
    payBtn: { backgroundColor: '#EF4444', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
    payBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    createBox: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    createHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
    createTitle: { color: '#fff', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    createDesc: { color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 20 },

    label: { color: '#cbd5e1', fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginBottom: 8 },
    input: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    submitBtn: { backgroundColor: '#6366f1', borderRadius: 16, padding: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 10 },
    submitBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalCard: { backgroundColor: '#1E293B', borderRadius: 24, padding: 24, width: '100%', maxWidth: 400, alignItems: 'center' },
    modalTitle: { color: '#F8FAFC', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 8, textAlign: 'center' },
    modalSubtitle: { color: '#94A3B8', fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
    modalPinInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', width: '100%', padding: 16, borderRadius: 12, fontSize: 24, textAlign: 'center', letterSpacing: 10, marginBottom: 20, fontWeight: '700' },
    modalButtons: { flexDirection: 'row', gap: 12, width: '100%' },
    modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    modalBtnCancel: { backgroundColor: 'rgba(255,255,255,0.1)' },
    modalBtnCancelText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    modalBtnConfirm: { backgroundColor: '#6366f1' },
    modalBtnConfirmText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});

