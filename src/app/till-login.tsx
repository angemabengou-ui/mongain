import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
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
import { apiTillLogin, saveTillToken } from '../services/api';

// Connexion GUICHET (MerchantTill) — téléphone + PIN dédiés au guichet, PAS le compte
// Mongain du marchand. Volontairement indépendant d'AuthContext : n'appelle jamais
// login()/useAuth() (voir saveTillToken, services/api.ts) — le token obtenu est stocké
// sous une clé distincte (mongain_till_token) et coexiste avec une éventuelle session
// utilisateur normale déjà ouverte sur le même appareil. Une fois connecté, le garde-fou
// de _layout.tsx redirige automatiquement vers till-collect.tsx et bloque le reste de
// l'app tant que cette session guichet reste active.
export default function TillLoginScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async () => {
        setError('');
        if (!phone || !pin) {
            setError('Veuillez remplir le téléphone et le code PIN du guichet.');
            return;
        }
        if (!/^\d{4}$/.test(pin)) {
            setError('Le code PIN doit comporter exactement 4 chiffres.');
            return;
        }
        setLoading(true);
        try {
            // Même normalisation que auth/login.tsx.
            const isPhone = /^[0-9\s+]+$/.test(phone);
            const formattedPhone = isPhone
                ? (phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`)
                : phone.trim();

            const res = await apiTillLogin(formattedPhone, pin);
            if (!res?.token) {
                setError('Identifiants de guichet incorrects.');
                return;
            }
            await saveTillToken(res.token);
            router.replace('/till-collect');
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Connexion au guichet impossible.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Connexion Guichet</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                        Réservé aux caissiers : connectez-vous avec le téléphone et le code PIN propres à ce guichet, pas votre compte Mongain habituel.
                    </Text>

                    {error ? (
                        <View style={[styles.errorBox, { backgroundColor: COLORS.error + '20' }]}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={[styles.errorText, { color: COLORS.error }]}>{error}</Text>
                        </View>
                    ) : null}

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Téléphone du guichet</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, backgroundColor: COLORS.surface }]}
                        placeholder="ex : 077000000"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="phone-pad"
                        autoCapitalize="none"
                        value={phone}
                        onChangeText={setPhone}
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN du guichet</Text>
                    <View style={[styles.pinRow, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                        <TextInput
                            style={[styles.pinInput, { color: COLORS.textPrimary }]}
                            placeholder="⬢⬢⬢⬢"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="number-pad"
                            secureTextEntry={!showPin}
                            maxLength={4}
                            value={pin}
                            onChangeText={setPin}
                        />
                        <TouchableOpacity onPress={() => setShowPin(!showPin)}>
                            <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={[styles.btn, { backgroundColor: COLORS.primary }, loading && styles.disabled]}
                        onPress={handleLogin}
                        disabled={loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Se connecter au guichet</Text>}
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
