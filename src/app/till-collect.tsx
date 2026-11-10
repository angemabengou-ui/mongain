import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiTillCollect, deleteTillToken } from '../services/api';

// Écran d'encaissement en session GUICHET (MerchantTill) — reprend le même flux que
// (tabs)/pay.tsx : le client montre son QR (code = son ID Mongain) ou le saisit lui-même, et
// autorise TOUJOURS avec SON PROPRE code PIN (jamais celui du guichet). Côté serveur,
// POST /api/till/collect (auth: 'till', voir apiTillCollect/services/api.ts) délègue
// entièrement à executeQrCollection (backend/src/routes/pay.ts), la même fonction que
// /api/pay/qr-scan — même contrat exact de champs (scannedCode/amountXaf/pin, PIN toujours
// requis, jamais de mode "sans PIN"), seule l'authentification diffère. SEUL écran
// accessible tant qu'une session guichet est active — voir le garde-fou dans _layout.tsx
// (RootLayoutNav) qui y renvoie systématiquement, quelle que soit la route visée, tant que
// getTillToken() renvoie un token. Le bouton de déconnexion ci-dessous (en-tête) est le seul
// moyen normal de quitter cet écran — il purge ce token puis renvoie vers till-login.tsx.
export default function TillCollectScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [scannedCode, setScannedCode] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [loggingOut, setLoggingOut] = useState(false);

    const resetForm = () => {
        setScannedCode('');
        setAmount('');
        setPin('');
    };

    const submitCollect = async (payload: { scannedCode: string; amountXaf: number; pin: string }) => {
        setLoading(true);
        try {
            await apiTillCollect(payload.scannedCode, payload.amountXaf, payload.pin);
            Alert.alert('Encaissement réussi', `${payload.amountXaf.toLocaleString('fr-FR')} FCFA encaissés avec succès.`);
            resetForm();
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || "Échec de l'encaissement.");
        } finally {
            setLoading(false);
        }
    };

    const handleCollect = () => {
        setError('');
        const trimmedCode = scannedCode.trim();
        if (!trimmedCode) {
            setError('Scannez ou saisissez le code du client.');
            return;
        }
        // FCFA = toujours un entier, jamais de décimales (voir docs/AUTO_CRITIQUE_PROJET.md).
        const amountXaf = Math.round(parseFloat(amount.replace(/\s/g, '').replace(',', '.')) || 0);
        if (amountXaf <= 0) {
            setError('Montant invalide.');
            return;
        }
        if (pin.length !== 4) {
            setError('Le client doit saisir son code PIN à 4 chiffres pour autoriser le paiement.');
            return;
        }

        Alert.alert(
            "Confirmer l'encaissement",
            `Encaisser ${amountXaf.toLocaleString('fr-FR')} FCFA auprès de ce client ?`,
            [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Confirmer', onPress: () => submitCollect({ scannedCode: trimmedCode, amountXaf, pin }) },
            ]
        );
    };

    const handleLogout = () => {
        Alert.alert(
            'Déconnexion du guichet',
            'Voulez-vous fermer cette session guichet ?',
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Se déconnecter',
                    style: 'destructive',
                    onPress: async () => {
                        setLoggingOut(true);
                        try {
                            await deleteTillToken();
                        } finally {
                            router.replace('/till-login');
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <View style={styles.headerIconBadge}>
                    <Ionicons name="storefront-outline" size={20} color="#fff" />
                </View>
                <Text style={styles.headerTitle} numberOfLines={1}>Encaissement Guichet</Text>
                <TouchableOpacity style={styles.headerBtn} onPress={handleLogout} disabled={loggingOut} accessibilityLabel="Déconnexion du guichet">
                    {loggingOut ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="log-out-outline" size={24} color="#fff" />}
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                        Scannez ou saisissez le code du client, indiquez le montant, puis faites-lui saisir son code PIN pour autoriser le paiement. Le paiement crédite directement le compte du commerce.
                    </Text>

                    {error ? (
                        <View style={[styles.errorBox, { backgroundColor: COLORS.error + '20' }]}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={[styles.errorText, { color: COLORS.error }]}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code client (scanné ou saisi)</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, backgroundColor: COLORS.surface }]}
                        placeholder="Code / ID client"
                        placeholderTextColor={COLORS.textSecondary}
                        autoCapitalize="none"
                        value={scannedCode}
                        onChangeText={setScannedCode}
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Montant à encaisser (FCFA)</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, backgroundColor: COLORS.surface }]}
                        placeholder="ex : 5000"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="number-pad"
                        value={amount}
                        onChangeText={setAmount}
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN du client (saisi par le client, pas par vous)</Text>
                    <View style={[styles.pinRow, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                        <TextInput
                            style={[styles.pinInput, { color: COLORS.textPrimary }]}
                            placeholder="⬢⬢⬢⬢"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            secureTextEntry
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.btn, { backgroundColor: COLORS.primary }, loading && styles.disabled]}
                        onPress={handleCollect}
                        disabled={loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Valider l'encaissement</Text>}
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
    headerIconBadge: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
    headerBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff', flex: 1, textAlign: 'center', marginHorizontal: 8 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scroll: { padding: 20, paddingBottom: 40 },
    helper: { fontSize: 12.5, lineHeight: 18, fontFamily: 'Satoshi-Regular', marginBottom: 20 },
    errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginBottom: 16, gap: 8 },
    errorText: { fontSize: 13, fontFamily: 'Satoshi-Regular', flex: 1 },
    label: { fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 52, fontSize: 15, marginBottom: 16, fontFamily: 'Satoshi-Regular' },
    pinRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 52, marginBottom: 24 },
    pinInput: { flex: 1, fontSize: 16, fontFamily: 'Satoshi-Regular', height: '100%' },
    btn: { height: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    btnText: { color: '#fff', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    disabled: { opacity: 0.6 },
});
