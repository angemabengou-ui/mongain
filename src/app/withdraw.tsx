import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiGenerateWithdrawCode, apiGetBalance } from '../services/api';

function formatCountdown(seconds: number) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

export default function WithdrawScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [showAmountModal, setShowAmountModal] = useState(false);
    const [codeAmount, setCodeAmount] = useState('');
    const [generating, setGenerating] = useState(false);

    const [showCode, setShowCode] = useState(false);
    const [token, setToken] = useState('000 000');
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const [remainingSeconds, setRemainingSeconds] = useState(0);

    const [balance, setBalance] = useState(user?.wallet?.balance || 0);
    const [balanceStale, setBalanceStale] = useState(false);

    useFocusEffect(
        useCallback(() => {
            apiGetBalance().then(res => {
                if (res && res.balance !== undefined) {
                    setBalance(res.balance);
                    setBalanceStale(false);
                }
            }).catch(() => setBalanceStale(true));
        }, [])
    );

    useEffect(() => {
        if (!showCode || !expiresAt) return;
        const tick = () => setRemainingSeconds(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [showCode, expiresAt]);

    // L'écran "Code Secret Généré" n'est qu'un rendu conditionnel sur cette même route, pas
    // un vrai <Modal>/une entrée de navigation séparée — sans cette interception, le bouton
    // Retour matériel Android quittait directement tout l'écran withdraw (au lieu de d'abord
    // fermer cette vue, comme le bouton "Fermer"), et le code — pourtant toujours valide côté
    // serveur pendant plusieurs minutes — devenait irrécupérable depuis l'app.
    useEffect(() => {
        if (!showCode) return;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            setShowCode(false);
            return true;
        });
        return () => sub.remove();
    }, [showCode]);

    const confirmGenerateCode = async () => {
        const amount = parseFloat(codeAmount.replace(/\s/g, '').replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
            Alert.alert('Montant invalide', 'Veuillez entrer un montant valide supérieur à 0.');
            return;
        }
        setGenerating(true);
        try {
            const res = await apiGenerateWithdrawCode(amount);
            const expiresAtMs = new Date(res.expiresAt).getTime();
            setToken(res.code.slice(0, 3) + ' ' + res.code.slice(3, 6));
            setExpiresAt(expiresAtMs);
            // Calculé tout de suite plutôt que laissé à 0 (valeur initiale du state) en
            // attendant le useEffect [showCode, expiresAt] : sans ça, le tout premier rendu
            // après un code fraîchement généré affichait "— — —" / "CODE EXPIRÉ" pendant une
            // frame, avant que l'effet ne corrige la valeur au tick suivant.
            setRemainingSeconds(Math.max(0, Math.round((expiresAtMs - Date.now()) / 1000)));
            setShowAmountModal(false);
            setCodeAmount('');
            setShowCode(true);
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de générer le code.');
        } finally {
            setGenerating(false);
        }
    };

    if (showAmountModal) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
                    <Text style={styles.codeGenTitle}>Montant à retirer</Text>
                    <Text style={[styles.codeGenSubtitle, { textAlign: 'center', marginTop: 12, marginBottom: 24 }]}>
                        Ce montant sera débité de votre solde une fois le retrait validé par l'agent.
                    </Text>
                    <View style={[styles.inputBox, { borderColor: '#10B981' }]}>
                        <Text style={styles.currencyLabel}>FCFA</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="0"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            value={codeAmount}
                            onChangeText={setCodeAmount}
                            autoFocus
                        />
                    </View>
                    <TouchableOpacity style={[styles.btn, { marginTop: 32 }]} onPress={confirmGenerateCode} disabled={generating}>
                        {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Générer le code</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={{ marginTop: 16, alignItems: 'center' }} onPress={() => { setShowAmountModal(false); setCodeAmount(''); }} disabled={generating}>
                        <Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>Annuler</Text>
                    </TouchableOpacity>
                    {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
            </SafeAreaView>
        );
    }

    if (showCode) {
        const expired = remainingSeconds <= 0;
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <View style={[styles.iconWrap, { backgroundColor: '#10B98115', padding: 24, borderRadius: 50, marginBottom: 24, width: 100, height: 100 }]}>
                    <Ionicons name="lock-closed" size={50} color="#10B981" />
                </View>
                <Text style={styles.codeGenTitle}>Code Secret Généré</Text>
                <Text style={[styles.codeGenSubtitle, { textAlign: 'center', marginTop: 12, paddingHorizontal: 20 }]}>
                    Veuillez communiquer ce code à 6 chiffres à votre Agent Mongain pour valider le retrait.
                </Text>

                <View style={styles.codeContainer}>
                    <Text style={styles.codeText}>{expired ? '— — —' : token}</Text>
                </View>

                <Text style={[styles.codeGenSubtitle, { color: '#EF4444', fontWeight: 'bold' }]}>
                    {expired ? 'CODE EXPIRÉ' : `EXPIRATION DANS ${formatCountdown(remainingSeconds)}`}
                </Text>

                <TouchableOpacity style={[styles.btn, { width: '100%', marginTop: 60 }]} onPress={() => setShowCode(false)}>
                    <Text style={styles.btnText}>Fermer</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Retrait</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView contentContainerStyle={styles.container}>
                <View style={styles.balanceSection}>
                    <Text style={styles.balanceLabel}>Solde Retirable</Text>
                    <Text style={styles.balanceAmount}>{balance.toLocaleString('fr-FR')} FCFA</Text>
                    {balanceStale && (
                        <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 4 }}>
                            Solde peut-être obsolète — vérifiez votre connexion.
                        </Text>
                    )}
                </View>

                <Text style={styles.sectionHeader}>PAR CODE QR</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity style={styles.listItem} onPress={() => router.push('/qr?mode=scanOnly&intent=withdraw')}>
                        <View style={[styles.listIcon, { backgroundColor: '#F59E0B15' }]}>
                            <Ionicons name="scan" size={24} color="#F59E0B" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Scanner pour retirer</Text>
                            <Text style={styles.listDesc}>Saisissez vous-même le montant à retirer.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeader}>PAR CODE SECRET</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity style={styles.listItem} onPress={() => setShowAmountModal(true)}>
                        <View style={[styles.listIcon, { backgroundColor: '#10B98115' }]}>
                            <Ionicons name="lock-closed" size={24} color="#10B981" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Générer un Code (Guichet)</Text>
                            <Text style={styles.listDesc}>Donnez votre numéro et le code généré au caissier.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeader}>PORTEFEUILLES MOBILES ET BANQUES</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity onPress={() => router.push({ pathname: '/withdraw-form', params: { method: 'AIRTEL' } })} style={styles.listItem}>
                        <View style={[styles.listIcon, { backgroundColor: '#EF444415' }]}>
                            <Ionicons name="phone-portrait" size={24} color="#EF4444" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Vers Airtel Money</Text>
                            <Text style={styles.listDesc}>Virement automatisé</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => router.push({ pathname: '/withdraw-form', params: { method: 'MOOV' } })} style={[styles.listItem, styles.lastListItem]}>
                        <View style={[styles.listIcon, { backgroundColor: '#3B82F615' }]}>
                            <Ionicons name="phone-portrait-outline" size={24} color="#3B82F6" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Vers Moov Africa</Text>
                            <Text style={styles.listDesc}>Virement automatisé</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.background },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
    container: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60 },

    balanceSection: { alignItems: 'center', marginVertical: 32 },
    balanceLabel: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
    balanceAmount: { fontSize: 44, fontWeight: '900', color: COLORS.textPrimary, marginVertical: 8, letterSpacing: -1 },

    sectionHeader: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginTop: 24, marginBottom: 12, marginLeft: 16, letterSpacing: 0.5 },

    listContainer: { backgroundColor: COLORS.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
    listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    lastListItem: { borderBottomWidth: 0 },
    listIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    listTextWrap: { flex: 1, marginRight: 8 },
    listTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
    listDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },

    inputBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: 15, paddingHorizontal: 20, height: 70, width: '100%', backgroundColor: COLORS.surface },
    currencyLabel: { fontSize: 20, fontWeight: 'bold', marginRight: 15, color: COLORS.textPrimary },
    input: { flex: 1, fontSize: 32, fontWeight: 'bold', textAlign: 'right', color: COLORS.textPrimary },

    iconWrap: { justifyContent: 'center', alignItems: 'center' },
    codeGenTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
    codeGenSubtitle: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
    codeContainer: { paddingHorizontal: 40, paddingVertical: 20, borderRadius: 20, marginVertical: 32, borderWidth: 2, borderColor: '#10B981', backgroundColor: '#10B98110' },
    codeText: { fontSize: 48, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 5 },
    btn: { backgroundColor: '#10B981', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' }
});
