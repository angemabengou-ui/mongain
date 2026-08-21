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
import { useAuth } from '../../context/AuthContext';

import { useAppTheme } from '../../constants/theme';
export default function LoginScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { login } = useAuth();

    useEffect(() => {
        // Hide splash screen when on login screen
        setTimeout(async () => {
            await SplashScreen.hideAsync().catch(() => { });
        }, 100);
    }, []);

    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleLogin = async () => {
        setError('');
        if (!phone || !pin) {
            setError('Veuillez remplir tous les champs.');
            return;
        }
        setLoading(true);
        try {
            // Determine if the input is a pseudo or a phone
            const isPhone = /^[0-9\s+]+$/.test(phone);
            const formattedPhone = isPhone
                ? (phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`)
                : phone.trim().toLowerCase(); // username (pseudo)

            const res = await login(formattedPhone, pin);

            if (res?.requireOtp) {
                router.push({ pathname: '/auth/verify-login-otp', params: { phone: formattedPhone } });
            } else if (res?.success) {
                router.replace('/');
            } else {
                setError('Erreur inattendue de connexion.');
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    {/* Header */}
                    <View style={styles.header}>
                        <View style={styles.logo}>
                            <Ionicons name="wallet" size={36} color={COLORS.primary} />
                        </View>
                        <Text style={styles.appName}>Mongain</Text>
                        <Text style={styles.tagline}>L'argent mobile au Gabon</Text>
                    </View>

                    {/* Formulaire */}
                    <View style={styles.card}>
                        <Text style={styles.title}>Connexion</Text>

                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <Text style={styles.label}>Numéro, E-mail ou Pseudo</Text>
                        <View style={[styles.inputContainer, { paddingLeft: 16 }]}>
                            <Ionicons name="person-circle-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
                            <TextInput
                                style={[styles.input, { flex: 1 }]}
                                placeholder="Numéro Mobile, @pseudo ou E-mail"
                                keyboardType="default"
                                autoCapitalize="none"
                                value={phone}
                                onChangeText={setPhone}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Code PIN (4 chiffres)</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••"
                                keyboardType="number-pad"
                                secureTextEntry={!showPin}
                                maxLength={4}
                                value={pin}
                                onChangeText={setPin}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                            <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Se connecter</Text>
                            )}
                        </TouchableOpacity>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
                            <TouchableOpacity onPress={() => router.push('/auth/forgot-pin')}>
                                <Text style={{ color: '#F59E0B', fontSize: 14, fontWeight: '700' }}>Code PIN oublié ?</Text>
                            </TouchableOpacity>

                            <TouchableOpacity onPress={() => router.push('/auth/register')}>
                                <Text style={styles.linkText}>
                                    Ou <Text style={styles.linkBold}>Créer un compte</Text>
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    flex: { flex: 1 },
    scroll: { flexGrow: 1 },
    header: {
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 40,
    },
    logo: {
        width: 72,
        height: 72,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    appName: {
        color: '#fff',
        fontSize: 32,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    tagline: {
        color: 'rgba(255,255,255,0.75)',
        fontSize: 15,
        marginTop: 4,
    },
    card: {
        flex: 1,
        backgroundColor: COLORS.background,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 28,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: COLORS.textPrimary,
        marginBottom: 24,
    },
    errorBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.error + '20',
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        gap: 8,
    },
    errorText: { color: COLORS.error, fontSize: 14, flex: 1 },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: COLORS.textSecondary,
        marginBottom: 8,
        marginTop: 4,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderRadius: 16,
        paddingHorizontal: 16,
        height: 56,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: COLORS.border,
    },
    prefix: {
        fontSize: 15,
        fontWeight: '600',
        color: COLORS.textSecondary,
        marginRight: 12,
        borderRightWidth: 1,
        borderRightColor: COLORS.border,
        paddingRight: 12,
    },
    inputIcon: { marginRight: 8 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, height: '100%' },
    eyeBtn: { padding: 4 },
    btn: {
        backgroundColor: COLORS.primary,
        height: 56,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
        elevation: 6,
    },
    btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
    linkBtn: { marginTop: 20, alignItems: 'center' },
    linkText: { color: COLORS.textSecondary, fontSize: 14 },
    linkBold: { color: COLORS.primary, fontWeight: '700' },
});
