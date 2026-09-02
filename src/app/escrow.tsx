import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { API_URL } from '../../config';
import { apiFetch } from '../../services/api'; // Assumes proxy helper

export default function EscrowScreen() {
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'LIST' | 'CREATE'>('LIST');
    const [escrows, setEscrows] = useState({ bought: [], sold: [] });

    // Create Form
    const [phone, setPhone] = useState('');
    const [amount, setAmount] = useState('');
    const [desc, setDesc] = useState('');

    useEffect(() => {
        if (mode === 'LIST') loadEscrows();
    }, [mode]);

    const loadEscrows = async () => {
        setLoading(true);
        try {
            const res = await apiFetch(API_URL + '/api/escrow/my');
            setEscrows(res);
        } catch (e: any) {
            Alert.alert('Erreur', e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!phone || !amount || !desc) return Alert.alert('Erreur', 'Remplissez le formulaire de séquestre.');
        setLoading(true);
        try {
            const res = await apiFetch(API_URL + '/api/escrow/create', {
                method: 'POST',
                body: JSON.stringify({ sellerPhone: phone, amount: parseFloat(amount), description: desc })
            });
            Alert.alert('SÉCURISÉ 🔒', `Code de déblocage: ${res.releaseCode}. Ne le donnez qu'à la livraison !`);
            setMode('LIST');
        } catch (e: any) {
            Alert.alert('Erreur', e.message);
        } finally {
            setLoading(false);
        }
    };

    const renderItem = (item: any, isBuyer: boolean) => (
        <View key={item.id} style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={styles.ref}>🔒 Escrow • {item.amount} CFA</Text>
                <Text style={[styles.status, item.status === 'RELEASED' && { color: '#059669' }]}>{item.status}</Text>
            </View>
            <Text style={{ color: 'white', marginBottom: 4 }}>{item.itemDescription}</Text>
            <Text style={{ color: 'gray', fontSize: 13, marginBottom: 12 }}>
                {isBuyer ? `Marchand: ${item.seller.name || item.seller.phone}` : `Acheteur: ${item.buyer.name || item.buyer.phone}`}
            </Text>

            {isBuyer && item.status === 'LOCKED' && (
                <View style={styles.codeBox}>
                    <Text style={{ color: 'white', fontSize: 12 }}>CODE DE LIVRAISON (SECRET)</Text>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#60A5FA', letterSpacing: 3 }}>
                        {item.releaseCode}
                    </Text>
                </View>
            )}
            {!isBuyer && item.status === 'LOCKED' && (
                <TouchableOpacity style={styles.actionBtn} onPress={() => {
                    Alert.prompt('Débloquer Paiement', 'Saisissez le code à 6 chiffres donné par le client', [
                        { text: 'Annuler', style: 'cancel' },
                        {
                            text: 'Valider',
                            onPress: async (code) => {
                                try {
                                    await apiFetch(API_URL + '/api/escrow/release/' + item.id, {
                                        method: 'POST',
                                        body: JSON.stringify({ releaseCode: code })
                                    });
                                    Alert.alert('Succès', 'Fonds ajoutés à votre compte !');
                                    loadEscrows();
                                } catch (e: any) { Alert.alert('Erreur', e.message); }
                            }
                        }
                    ]);
                }}>
                    <Text style={styles.actionTxt}>Débloquer les Fonds</Text>
                </TouchableOpacity>
            )}
        </View>
    );

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
            <View style={styles.header}>
                <Ionicons name="shield-checkmark" size={32} color="#60A5FA" />
                <Text style={styles.title}>Caisse Escrow</Text>
            </View>
            <Text style={styles.subtitle}>Protégez vos achats. L'argent n'est versé au marchand qu'à livraison.</Text>

            {mode === 'LIST' ? (
                <>
                    <TouchableOpacity style={styles.createBtn} onPress={() => setMode('CREATE')}>
                        <Text style={styles.createTxt}>+ initier un Achat Sécurisé</Text>
                    </TouchableOpacity>

                    {loading ? <ActivityIndicator size="large" color="#60a5fa" style={{ marginTop: 50 }} /> : (
                        <View style={{ marginTop: 24 }}>
                            <Text style={styles.sectionTitle}>Mes Achats Protégés</Text>
                            {escrows.bought.map((i: any) => renderItem(i, true))}
                            {escrows.bought.length === 0 && <Text style={styles.empty}>Aucun achat en cours.</Text>}

                            <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Mes Ventes Sécurisées</Text>
                            {escrows.sold.map((i: any) => renderItem(i, false))}
                            {escrows.sold.length === 0 && <Text style={styles.empty}>Aucune vente en attente.</Text>}
                        </View>
                    )}
                </>
            ) : (
                <View style={styles.formCard}>
                    <Text style={styles.sectionTitle}>Nouvel Achat Sécurisé</Text>

                    <Text style={styles.label}>N° Téléphone du Vendeur (Marchand)</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={phone} onChangeText={setPhone} placeholder="074..." placeholderTextColor="#475569" />

                    <Text style={styles.label}>Montant de l'article (CFA)</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={amount} onChangeText={setAmount} placeholder="15000" placeholderTextColor="#475569" />

                    <Text style={styles.label}>Description de l'article</Text>
                    <TextInput style={styles.input} value={desc} onChangeText={setDesc} placeholder="Ex: iPhone 12 Pro Max" placeholderTextColor="#475569" />

                    <Text style={styles.feeWarning}>Note: Une commission de séquestre (2%) est prélevée pour protéger l'intégralité du montant jusqu'à conclusion.</Text>

                    <View style={{ flexDirection: 'row', marginTop: 30, gap: 12 }}>
                        <TouchableOpacity style={[styles.actionBtn, { flex: 1, backgroundColor: '#334155' }]} onPress={() => setMode('LIST')}>
                            <Text style={styles.actionTxt}>Annuler</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.actionBtn, { flex: 2 }]} onPress={handleCreate}>
                            <Text style={styles.actionTxt}>{loading ? 'Ouverture...' : 'Bloquer les Fonds'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    title: { fontSize: 26, fontWeight: 'bold', color: 'white', marginLeft: 12 },
    subtitle: { fontSize: 14, color: '#94a3b8', marginBottom: 24, lineHeight: 20 },
    createBtn: {
        backgroundColor: '#1d4ed8', padding: 18, borderRadius: 16, alignItems: 'center', marginVertical: 12,
        shadowColor: '#3b82f6', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }
    },
    createTxt: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#60a5fa' },
    ref: { color: 'white', fontWeight: '600', fontSize: 15 },
    status: { color: '#f59e0b', fontSize: 12, fontWeight: 'bold' },
    codeBox: { backgroundColor: '#0f172a', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#334155' },
    actionBtn: { backgroundColor: '#2563eb', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
    actionTxt: { color: 'white', fontWeight: 'bold' },
    sectionTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
    empty: { color: '#64748b', fontStyle: 'italic', marginBottom: 12 },
    formCard: { backgroundColor: '#1e293b', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#334155' },
    label: { color: '#cbd5e1', fontSize: 13, marginBottom: 8, fontWeight: '600' },
    input: { backgroundColor: '#0f172a', padding: 14, borderRadius: 10, color: 'white', marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
    feeWarning: { color: '#94a3b8', fontSize: 12, marginTop: 12, backgroundColor: '#334155', padding: 12, borderRadius: 8, overflow: 'hidden' }
});
