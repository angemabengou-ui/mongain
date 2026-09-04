import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function CardsScreen() {
    const { token } = useAuth();
    const [cards, setCards] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [revealCvv, setRevealCvv] = useState<{ [key: string]: boolean }>({});
    const [actionLoading, setActionLoading] = useState(false);

    const fetchCards = async () => {
        try {
            const res = await request('GET', '/api/wallet/cards', {}, true) as any[];
            setCards(res || []);
        } catch (e: any) {
            // Un échec silencieux (juste console.warn) rendait un chargement en échec
            // indiscernable d'un compte sans aucune carte.
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Impossible de charger vos cartes.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token) fetchCards();
    }, [token]);

    const handleIssueCard = async () => {
        setActionLoading(true);
        try {
            await request('POST', '/api/wallet/cards/issue', {}, true);
            await fetchCards();
            Alert.alert("Succès", "Votre carte virtuelle a été émise avec succès.");
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Impossible d'émettre la carte.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleFund = (cardId: string) => {
        Alert.prompt(
            'Recharger la carte',
            'Montant à transférer de votre portefeuille vers cette carte (XAF) :',
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Suivant', onPress: (amount?: string) => promptPinForFund(cardId, amount) },
            ],
            'plain-text',
            '',
            'numeric',
        );
    };

    const promptPinForFund = (cardId: string, amount?: string) => {
        const parsed = parseFloat(amount || '');
        if (!parsed || parsed <= 0) return Alert.alert('Erreur', 'Montant invalide.');
        Alert.prompt(
            'Code PIN',
            'Confirmez ce rechargement avec votre code PIN Mongain.',
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Confirmer', onPress: (pin?: string) => executeFund(cardId, parsed, pin) },
            ],
            'secure-text',
        );
    };

    const executeFund = async (cardId: string, amount: number, pin?: string) => {
        if (!pin) return Alert.alert('Erreur', 'Code PIN requis.');
        setActionLoading(true);
        try {
            await request('POST', `/api/wallet/cards/${cardId}/fund`, { amount, pin }, true);
            await fetchCards();
            Alert.alert('Succès', 'Carte rechargée avec succès.');
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Rechargement impossible.');
        } finally {
            setActionLoading(false);
        }
    };

    const handleFreeze = async (id: string, isFrozen: boolean) => {
        setActionLoading(true);
        try {
            await request('PUT', `/api/wallet/cards/${id}/freeze`, {}, true);
            await fetchCards();
            Alert.alert(isFrozen ? "Débloquée" : "Bloquée", `La carte a été ${isFrozen ? "réactivée" : "suspendue"}.`);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <Text style={styles.title}>Mes Cartes</Text>
                    <Text style={styles.subtitle}>Payez en ligne partout dans le monde</Text>
                </View>

                {loading ? (
                    <ActivityIndicator size="large" color="#ffffff" style={{ marginTop: 40 }} />
                ) : cards.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="card-outline" color="rgba(255,255,255,0.4)" size={64} style={{ marginBottom: 16 }} />
                        <Text style={styles.emptyText}>Aucune carte virtuelle trouvée.</Text>
                        <TouchableOpacity style={styles.issueButton} onPress={handleIssueCard} disabled={actionLoading}>
                            <Text style={styles.issueButtonText}>{actionLoading ? "En cours..." : "Créer une Carte Virtuelle (Gratuit)"}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    cards.map((c, i) => {
                        const isFrozen = c.status === 'FROZEN';
                        // Distinct de FROZEN (auto-gel réversible par le titulaire) : le backend
                        // (cards.ts) refuse tout dégel d'une carte BLOCKED — décidé par le staff
                        // sécurité, jamais par le client. Avant ce correctif, seul `isFrozen`
                        // était vérifié : une carte BLOCKED s'affichait identique à une carte
                        // active (pas d'overlay, bouton "Geler" comme si c'était une action
                        // normale disponible), et l'utilisateur ne découvrait le blocage réel
                        // qu'en tapant l'action et recevant un 403 du serveur.
                        const isBlocked = c.status === 'BLOCKED';
                        return (
                            <View key={c.id || i} style={[styles.cardContainer, (isFrozen || isBlocked) && { opacity: 0.7 }]}>
                                <BlurView intensity={50} tint="dark" style={styles.cardGlass}>
                                    <View style={styles.cardHeader}>
                                        <Text style={styles.bankName}>MONGAIN VIRTUAL</Text>
                                        <Ionicons name="card" color="rgba(255,255,255,0.8)" size={24} />
                                    </View>

                                    <View style={styles.balanceRow}>
                                        <Text style={styles.balanceValue}>{c.balance?.toLocaleString()} XAF</Text>
                                    </View>

                                    <View style={styles.cardNumberRow}>
                                        <Text style={styles.cardNumber}>
                                            {c.cardNumber?.match(/.{1,4}/g)?.join(' ')}
                                        </Text>
                                    </View>

                                    <View style={styles.cardFooter}>
                                        <View>
                                            <Text style={styles.cardLabel}>EXP</Text>
                                            <Text style={styles.cardInfo}>{c.expiryDate}</Text>
                                        </View>
                                        <View style={{ alignItems: 'flex-end', flexDirection: 'row', gap: 10 }}>
                                            <View>
                                                <Text style={styles.cardLabel}>CVV</Text>
                                                <Text style={styles.cardInfo}>{revealCvv[c.id] ? c.cvv : '***'}</Text>
                                            </View>
                                            <TouchableOpacity onPress={() => setRevealCvv({ ...revealCvv, [c.id]: !revealCvv[c.id] })}>
                                                {revealCvv[c.id] ? <Ionicons name="eye-off" color="#fff" size={20} /> : <Ionicons name="eye" color="#fff" size={20} />}
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </BlurView>

                                {isBlocked ? (
                                    <View style={styles.frozenFilter}>
                                        <Ionicons name="shield-half" color="#fff" size={40} style={{ opacity: 0.8 }} />
                                        <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>BLOQUÉE PAR LA SÉCURITÉ</Text>
                                    </View>
                                ) : isFrozen && (
                                    <View style={styles.frozenFilter}>
                                        <Ionicons name="snow" color="#fff" size={40} style={{ opacity: 0.8 }} />
                                        <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>CARTE GELÉE</Text>
                                    </View>
                                )}

                                <View style={styles.actions}>
                                    <TouchableOpacity style={styles.actionBtn} onPress={() => handleFund(c.id)} disabled={actionLoading}>
                                        <Text style={styles.actionText}>Recharger</Text>
                                    </TouchableOpacity>
                                    {!isBlocked && (
                                        <TouchableOpacity style={[styles.actionBtn, isFrozen ? styles.actionBtnUnfreeze : styles.actionBtnDanger]} onPress={() => handleFreeze(c.id, isFrozen)} disabled={actionLoading}>
                                            <Text style={styles.actionText}>{isFrozen ? "Débloquer" : "Geler"}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    scroll: { padding: 24, paddingBottom: 60 },
    header: { marginBottom: 32, marginTop: 20 },
    title: { color: '#ffffff', fontSize: 32, fontFamily: 'Satoshi-SemiBold', fontWeight: '800', marginBottom: 8 },
    subtitle: { color: '#94a3b8', fontSize: 16 },
    emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 80 },
    emptyText: { color: '#94a3b8', fontSize: 16, marginBottom: 24 },
    issueButton: { backgroundColor: '#2563EB', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 12 },
    issueButtonText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16 },
    cardContainer: { marginBottom: 40, borderRadius: 20, overflow: 'hidden' },
    cardGlass: { padding: 24, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    bankName: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', letterSpacing: 2 },
    balanceRow: { marginBottom: 24 },
    balanceValue: { color: '#fff', fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' },
    cardNumberRow: { marginBottom: 32 },
    cardNumber: { color: '#fff', fontSize: 22, letterSpacing: 3, fontFamily: 'monospace' },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    cardLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 11, marginBottom: 4 },
    cardInfo: { color: '#fff', fontSize: 16, fontWeight: '600', fontFamily: 'monospace' },
    frozenFilter: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(30, 58, 138, 0.4)', justifyContent: 'center', alignItems: 'center', borderRadius: 20 },
    actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
    actionBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 14, borderRadius: 12, alignItems: 'center' },
    actionBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
    actionBtnUnfreeze: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
    actionText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '600', fontSize: 14 }
});

