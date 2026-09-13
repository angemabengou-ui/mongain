import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { request } from '../../services/api';

export default function CardsScreen() {
    const { token, user } = useAuth();
    const router = useRouter();
    // Filet de sécurité UX (pas la barrière de sécurité — le backend refuse déjà ces routes
    // pour un CHILD) : couvre un lien profond périmé, une notification, ou tout autre chemin
    // qui contournerait les boutons/onglet masqués côté navigation ((tabs)/index.tsx et
    // (tabs)/_layout.tsx).
    const isChild = user?.role === 'CHILD';
    // Marchand Géant — palier consultation-seule sur mobile (voir User.merchantTier,
    // (tabs)/index.tsx) : émettre/recharger une carte déplace de l'argent, même filet de
    // sécurité UX ci-dessous que pour un Compte Enfant.
    const isGiantMerchant = user?.merchantTier === 'GIANT';
    const [cards, setCards] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [revealCvv, setRevealCvv] = useState<{ [key: string]: boolean }>({});
    const [actionLoading, setActionLoading] = useState(false);
    // Remplace les deux Alert.prompt chaînés (montant puis PIN) de handleFund — Alert.prompt
    // n'existe que sur iOS ; sur Android c'est un no-op total (ni boîte, ni callback), donc
    // "Recharger" ne faisait strictement rien. Un seul modal avec les deux champs, plutôt que
    // deux prompts successifs, comme transfer-confirm.tsx (montant + PIN sur le même écran).
    const [fundingCardId, setFundingCardId] = useState<string | null>(null);
    const [fundAmount, setFundAmount] = useState('');
    const [fundPin, setFundPin] = useState('');

    // BUG CORRIGÉ ("carte créée mais rien n'apparaît") : cette fonction avalait sa propre
    // erreur (son propre Alert.alert, sans jamais la relancer), donc chaque appelant ci-dessous
    // (`await fetchCards()`) continuait comme si le rafraîchissement avait réussi et affichait
    // quand même son "Succès" — alors que la liste affichée restait celle d'AVANT l'action
    // (toujours vide au tout premier essai) si ce GET échouait pour une raison quelconque
    // (ex : réveil à froid Render, un hoquet réseau). Sur Android, deux Alert.alert appelés
    // coup sur coup peuvent en plus se chevaucher et ne laisser voir que le dernier — masquant
    // ainsi complètement l'alerte d'erreur pourtant déclenchée juste avant. Retourner un booléen
    // permet à l'appelant de ne PLUS afficher "Succès" quand ce rafraîchissement a réellement échoué.
    const fetchCards = async (): Promise<boolean> => {
        try {
            const res = await request('GET', '/api/wallet/cards', undefined, true) as any[];
            setCards(res || []);
            return true;
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || e.message || "Impossible de charger vos cartes.");
            return false;
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token && !isChild && !isGiantMerchant) fetchCards();
    }, [token, isChild, isGiantMerchant]);

    // Anti double-tap (même correctif que vault-detail.tsx : `disabled={actionLoading}` seul
    // ne protège pas contre deux appuis assez rapprochés pour lire `actionLoading` avant que le
    // premier `setActionLoading(true)` ne soit commité par React) — un double-tap émettait ici
    // deux cartes virtuelles distinctes pour un seul appui perçu.
    const issuingRef = React.useRef(false);

    const handleIssueCard = async () => {
        if (issuingRef.current) return;
        issuingRef.current = true;
        setActionLoading(true);
        try {
            await request('POST', '/api/wallet/cards/issue', {}, true);
            const refreshed = await fetchCards();
            if (refreshed) Alert.alert("Succès", "Votre carte virtuelle a été émise avec succès.");
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Impossible d'émettre la carte.");
        } finally {
            issuingRef.current = false;
            setActionLoading(false);
        }
    };

    const handleFund = (cardId: string) => {
        setFundAmount('');
        setFundPin('');
        setFundingCardId(cardId);
    };

    const executeFund = async () => {
        const parsed = Math.round(parseFloat(fundAmount) || 0);
        if (!parsed || parsed <= 0) return Alert.alert('Erreur', 'Montant invalide.');
        if (fundPin.length !== 4) return Alert.alert('Erreur', 'Code PIN à 4 chiffres requis.');
        setActionLoading(true);
        try {
            await request('POST', `/api/wallet/cards/${fundingCardId}/fund`, { amount: parsed, pin: fundPin }, true);
            const refreshed = await fetchCards();
            setFundingCardId(null);
            if (refreshed) Alert.alert('Succès', 'Carte rechargée avec succès.');
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
            const refreshed = await fetchCards();
            if (refreshed) Alert.alert(isFrozen ? "Débloquée" : "Bloquée", `La carte a été ${isFrozen ? "réactivée" : "suspendue"}.`);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Action impossible.");
        } finally {
            setActionLoading(false);
        }
    };

    if (isChild || isGiantMerchant) {
        return (
            <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <Ionicons name="lock-closed-outline" size={48} color="#94a3b8" style={{ marginBottom: 16 }} />
                <Text style={{ fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', color: '#ffffff', textAlign: 'center', marginBottom: 24 }}>
                    {isGiantMerchant ? "Cette fonctionnalité est réservée au portail web pour un compte marchand géant." : "Cette fonctionnalité n'est pas disponible pour les comptes enfant."}
                </Text>
                <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={{ backgroundColor: '#2563EB', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14 }}>
                    <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

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

            <Modal transparent animationType="fade" visible={!!fundingCardId} onRequestClose={() => setFundingCardId(null)}>
                <View style={styles.fundOverlay}>
                    <View style={styles.fundCard}>
                        <Text style={styles.fundTitle}>Recharger la carte</Text>
                        <Text style={styles.fundLabel}>Montant à transférer depuis votre portefeuille (XAF)</Text>
                        <TextInput
                            style={styles.fundInput}
                            placeholder="ex: 10000"
                            placeholderTextColor="#64748b"
                            keyboardType="number-pad"
                            value={fundAmount}
                            onChangeText={setFundAmount}
                        />
                        <Text style={styles.fundLabel}>Code PIN Mongain</Text>
                        <TextInput
                            style={[styles.fundInput, { textAlign: 'center', letterSpacing: 10, fontSize: 22 }]}
                            placeholder="⬢⬢⬢⬢"
                            placeholderTextColor="#64748b"
                            keyboardType="number-pad"
                            secureTextEntry
                            maxLength={4}
                            value={fundPin}
                            onChangeText={setFundPin}
                        />
                        <View style={styles.fundActions}>
                            <TouchableOpacity style={styles.fundBtnCancel} onPress={() => setFundingCardId(null)} disabled={actionLoading}>
                                <Text style={styles.fundBtnCancelText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.fundBtnConfirm, (actionLoading || !fundAmount || fundPin.length !== 4) && { opacity: 0.5 }]}
                                onPress={executeFund}
                                disabled={actionLoading || !fundAmount || fundPin.length !== 4}
                            >
                                {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.fundBtnConfirmText}>Confirmer</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
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
    frozenFilter: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(30, 58, 138, 0.4)', justifyContent: 'center', alignItems: 'center', borderRadius: 20 },
    actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
    actionBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', padding: 14, borderRadius: 12, alignItems: 'center' },
    actionBtnDanger: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
    actionBtnUnfreeze: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
    actionText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '600', fontSize: 14 },

    fundOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    fundCard: { width: '100%', maxWidth: 360, borderRadius: 20, padding: 24, backgroundColor: '#1E293B' },
    fundTitle: { color: '#fff', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 16, textAlign: 'center' },
    fundLabel: { color: '#94a3b8', fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginBottom: 8 },
    fundInput: { backgroundColor: 'rgba(0,0,0,0.3)', color: '#fff', padding: 14, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 16 },
    fundActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
    fundBtnCancel: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
    fundBtnCancelText: { color: '#94a3b8', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
    fundBtnConfirm: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563EB' },
    fundBtnConfirmText: { color: '#fff', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});

