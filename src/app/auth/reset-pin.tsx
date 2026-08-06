import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { apiResetPIN } from '../../services/api';

export default function ResetPinScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { phone } = useLocalSearchParams<{ phone: string }>();

    const [otp, setOtp] = useState('');
    const [newPin, setNewPin] = useState('');
    const [showPin, setShowPin] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleReset = async () => {
        setError('');
        if (!otp || !newPin) {
            setError('Veuillez remplir tous les champs.');
            return;
        }
        if (newPin.length !== 4) {
            setError('Le nouveau code PIN doit comporter 4 chiffres.');
            return;
        }
        setLoading(true);
        try {
            await apiResetPIN(phone || '', otp, newPin);
            setSuccess(true);
        } catch (e: any) {
            setError(e.message || "Code incorrect ou expiré.");
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center' }]}>
                <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
                <Text style={[styles.appName, { marginTop: 20 }]}>Code réinitialisé !</Text>
                <Text style={styles.tagline}>Votre nouveau Code PIN est maintenant actif.</Text>
                <TouchableOpacity
                    style={[styles.btn, { marginTop: 40, width: '80%' }]}
                    onPress={() => router.replace('/auth/login')}
                >
                    <Text style={styles.btnText}>Retour à la connexion</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <View style={styles.logo}>
                            <Ionicons name="shield-checkmark" size={36} color={COLORS.primary} />
                        </View>
                        <Text style={styles.appName}>Nouveau Code PIN</Text>
                        <Text style={styles.tagline}>Saisissez le code SMS reçu par le {phone}</Text>
                    </View>

                    <View style={styles.card}>
                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <Text style={styles.label}>Code SMS (OTP)</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="4 chiffres"
                                keyboardType="number-pad"
                                maxLength={4}
                                value={otp}
                                onChangeText={setOtp}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Nouveau Code PIN</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••"
                                keyboardType="number-pad"
                                secureTextEntry={!showPin}
                                maxLength={4}
                                value={newPin}
                                onChangeText={setNewPin}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                            <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeIcon}>
                                <Ionicons name={showPin ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={[styles.btn, (!otp || !newPin || loading) && styles.btnDisabled]}
                            onPress={handleReset}
                            disabled={!otp || !newPin || loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Valider</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function getStyles(COLORS: any) {
    return StyleSheet.create({
        safeArea: { flex: 1, backgroundColor: COLORS.background },
        flex: { flex: 1 },
        scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
        backButton: { position: 'absolute', top: 16, left: 16, zIndex: 10, padding: 8 },
        header: { alignItems: 'center', marginBottom: 40, marginTop: 40 },
        logo: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#E0F7FA', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
        appName: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
        tagline: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: 20 },
        card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 5 },
        label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
        inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, marginBottom: 20, height: 56 },
        inputIcon: { marginRight: 12 },
        input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, height: '100%', letterSpacing: 2 },
        eyeIcon: { padding: 8 },
        btn: { backgroundColor: COLORS.primary, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
        btnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
        btnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
        errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: '#FECACA' },
        errorText: { color: COLORS.error, fontSize: 14, marginLeft: 8, flex: 1 }
    });
}
