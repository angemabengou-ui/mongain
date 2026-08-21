import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
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
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiRequestOtp } from '../../services/api';

export default function RegisterScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { register } = useAuth();

    useEffect(() => {
        setTimeout(async () => {
            await SplashScreen.hideAsync().catch(() => { });
        }, 100);
    }, []);

    const [step, setStep] = useState<1 | 2>(1);

    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleRequestOtp = async () => {
        setError('');
        if (!phone) {
            setError('Veuillez fournir votre numéro de téléphone.');
            return;
        }
        if (phone.length < 8) {
            setError('Numéro de téléphone invalide.');
            return;
        }

        setLoading(true);
        try {
            const formattedPhone = phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`;
            await apiRequestOtp(formattedPhone);
            setStep(2);
        } catch (e: any) {
            setError(e.message || "Erreur de connexion.");
        } finally {
            setLoading(false);
        }
    };

    const handleRegister = async () => {
        setError('');
        if (!otpCode || !name || !username || !pin || !confirmPin) {
            setError('Veuillez remplir tous les champs obligatoires.');
            return;
        }
        if (otpCode.length !== 4) {
            setError('Le code de vérification SMS doit comporter 4 chiffres.');
            return;
        }
        if (pin.length !== 4 || !/^\d+$/.test(pin)) {
            setError('Le code PIN de sécurité doit comporter exactement 4 chiffres.');
            return;
        }
        if (pin !== confirmPin) {
            setError('Les deux codes PIN de sécurité ne correspondent pas.');
            return;
        }

        setLoading(true);
        try {
            const formattedPhone = phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`;
            await register(name, username, formattedPhone, pin, otpCode);
            router.replace('/');
        } catch (e: any) {
            setError(e.message || "Erreur lors de la création.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => step === 2 ? setStep(1) : router.back()} style={styles.backBtn}>
                            <Ionicons name="arrow-back" size={24} color="#fff" />
                        </TouchableOpacity>
                        <View style={styles.logo}>
                            <Ionicons name="wallet" size={32} color={COLORS.primary} />
                        </View>
                        <Text style={styles.appName}>Mongain</Text>
                        <Text style={styles.tagline}>Sécurité Anti-Fraude Garantie</Text>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.title}>{step === 1 ? 'Nouveau compte' : 'Vos informations'}</Text>

                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        {step === 1 ? (
                            <>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Numéro de téléphone</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="call-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: COLORS.textSecondary, marginRight: 8, borderRightWidth: 1, borderColor: COLORS.border, paddingRight: 8 }}>+241</Text>
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Ex: 77 00 00 00"
                                            placeholderTextColor="#94a3b8"
                                            keyboardType="phone-pad"
                                            value={phone}
                                            onChangeText={setPhone}
                                        />
                                    </View>
                                </View>

                                <TouchableOpacity
                                    style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                                    onPress={handleRequestOtp}
                                    disabled={loading}
                                >
                                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Vérifier mon Numéro</Text>}
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <Text style={{ color: COLORS.textSecondary, marginBottom: 16, fontSize: 13, lineHeight: 20 }}>
                                    Un code de vérification SMS a été envoyé au <Text style={{ fontWeight: '700', color: COLORS.textPrimary }}>+241 {phone}</Text>.
                                </Text>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Code SMS Reçu</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} style={styles.inputIcon} />
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Entrez 4 chiffres"
                                            placeholderTextColor="#94a3b8"
                                            keyboardType="number-pad"
                                            maxLength={4}
                                            value={otpCode}
                                            onChangeText={setOtpCode}
                                        />
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Nom complet (Pour votre profil)</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Ex: Jean Dupont"
                                            placeholderTextColor="#94a3b8"
                                            value={name}
                                            onChangeText={setName}
                                        />
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Créer un Pseudo Unique (@alias)</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="at-circle-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Ex: jean01 (sans espaces)"
                                            placeholderTextColor="#94a3b8"
                                            autoCapitalize="none"
                                            value={username}
                                            onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
                                        />
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Nouveau Code PIN de sécurité</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput
                                            style={styles.input}
                                            placeholder="4 chiffres (Ex: 1234)"
                                            placeholderTextColor="#94a3b8"
                                            keyboardType="number-pad"
                                            maxLength={4}
                                            secureTextEntry={!showPin}
                                            value={pin}
                                            onChangeText={setPin}
                                        />
                                        <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                            <Ionicons name={showPin ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Confirmer le Code PIN</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput
                                            style={styles.input}
                                            placeholder="Répétez le code"
                                            placeholderTextColor="#94a3b8"
                                            keyboardType="number-pad"
                                            maxLength={4}
                                            secureTextEntry={!showPin}
                                            value={confirmPin}
                                            onChangeText={setConfirmPin}
                                        />
                                    </View>
                                </View>

                                <TouchableOpacity
                                    style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                                    onPress={handleRegister}
                                    disabled={loading}
                                >
                                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Validation Finale</Text>}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>

                    {step === 1 && (
                        <View style={styles.footer}>
                            <Text style={styles.footerText}>Vous avez déjà un compte ?</Text>
                            <TouchableOpacity onPress={() => router.replace('/auth/login')}>
                                <Text style={styles.footerLink}>Connectez-vous</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: any) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
    header: { alignItems: 'center', marginBottom: 40, marginTop: 40 },
    backBtn: { position: 'absolute', left: 0, top: 0, padding: 8 },
    logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(29, 197, 233, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    appName: { fontSize: 32, fontWeight: '800', color: '#fff', marginBottom: 8, letterSpacing: -0.5 },
    tagline: { fontSize: 16, color: COLORS.textSecondary, fontWeight: '500' },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 5 },
    title: { fontSize: 24, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 24 },
    errorBox: { flexDirection: 'row', backgroundColor: 'rgba(225, 29, 72, 0.1)', padding: 12, borderRadius: 12, marginBottom: 20, alignItems: 'center' },
    errorText: { color: COLORS.error, fontSize: 13, marginLeft: 8, flex: 1, fontWeight: '500' },
    inputGroup: { marginBottom: 20 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, minHeight: 56, paddingHorizontal: 16 },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, height: 56, fontSize: 16, color: COLORS.textPrimary, fontWeight: '500' },
    eyeBtn: { padding: 8, marginRight: -8 },
    submitBtn: { backgroundColor: COLORS.primary, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 12, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8 },
    submitBtnDisabled: { opacity: 0.7 },
    submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 32, gap: 8 },
    footerText: { color: COLORS.textSecondary, fontSize: 15 },
    footerLink: { color: COLORS.primary, fontWeight: '700', fontSize: 15 },
});
