import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { BASE_URL } from '../../services/api';

export default function ForgotPinScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { login } = useAuth(); // Actually just set the token directly or re-fetch

    const [step, setStep] = useState<1 | 2>(1);
    const [phone, setPhone] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleRequestOtp = async () => {
        setError('');
        if (!phone || phone.length < 8) {
            setError('Numéro de téléphone invalide.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${BASE_URL}/api/auth/request-reset-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

            setStep(2);
        } catch (e: any) {
            setError(e.message || "Erreur de connexion.");
        } finally {
            setLoading(false);
        }
    };

    const handleResetPin = async () => {
        setError('');
        if (!otpCode || !newPin || !confirmPin) {
            setError('Veuillez remplir tous les champs.');
            return;
        }
        if (newPin !== confirmPin) {
            setError('Les deux codes PIN de sécurité ne correspondent pas.');
            return;
        }
        if (newPin.length !== 4) {
            setError('Le PIN doit comporter 4 chiffres.');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`${BASE_URL}/api/auth/reset-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, otpCode, newPin })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur de réinitialisation');

            // Force redirect to login so they can log back in with their new pin!
            alert("Succès! Votre code PIN a été réinitialisé.");
            router.replace('/auth/login');
        } catch (e: any) {
            setError(e.message || "Erreur.");
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
                            <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                        </TouchableOpacity>
                        <View style={styles.logo}>
                            <Ionicons name="lock-open" size={32} color={COLORS.primary} />
                        </View>
                        <Text style={styles.appName}>Réinitialisation</Text>
                        <Text style={styles.tagline}>Récupérez l'accès à votre compte</Text>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.title}>{step === 1 ? 'Identifiez-vous' : 'Création du nouveau PIN'}</Text>

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
                                        <TextInput
                                            style={styles.input}
                                            placeholder="+241 77 XX XX XX"
                                            placeholderTextColor="#94a3b8"
                                            keyboardType="phone-pad"
                                            value={phone}
                                            onChangeText={setPhone}
                                        />
                                    </View>
                                </View>

                                <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleRequestOtp} disabled={loading}>
                                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Envoyer SMS de sécurité</Text>}
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Code recu par SMS</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} style={styles.inputIcon} />
                                        <TextInput style={styles.input} placeholder="4 chiffres reçus" keyboardType="number-pad" maxLength={4} value={otpCode} onChangeText={setOtpCode} />
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Nouveau Code PIN</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput style={styles.input} placeholder="4 chiffres (Ex: 1234)" keyboardType="number-pad" secureTextEntry={!showPin} maxLength={4} value={newPin} onChangeText={setNewPin} />
                                        <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                            <Ionicons name={showPin ? "eye-off-outline" : "eye-outline"} size={20} color={COLORS.textSecondary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Confirmer le Nouveau Code PIN</Text>
                                    <View style={styles.inputContainer}>
                                        <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                        <TextInput style={styles.input} placeholder="Répétez le code" keyboardType="number-pad" secureTextEntry={!showPin} maxLength={4} value={confirmPin} onChangeText={setConfirmPin} />
                                    </View>
                                </View>

                                <TouchableOpacity style={[styles.submitBtn, loading && styles.submitBtnDisabled]} onPress={handleResetPin} disabled={loading}>
                                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Réinitialiser et Sécuriser</Text>}
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: any) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 60 },
    header: { alignItems: 'center', marginBottom: 40 },
    backBtn: { position: 'absolute', left: 0, top: 0, padding: 8, backgroundColor: 'rgba(255,255,255,0.8)', borderRadius: 20 },
    logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(29, 197, 233, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    appName: { fontSize: 32, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8 },
    tagline: { fontSize: 16, color: COLORS.textSecondary, fontWeight: '500' },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, elevation: 5 },
    title: { fontSize: 24, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 24 },
    errorBox: { flexDirection: 'row', backgroundColor: 'rgba(225, 29, 72, 0.1)', padding: 12, borderRadius: 12, marginBottom: 20, alignItems: 'center' },
    errorText: { color: COLORS.error, fontSize: 13, marginLeft: 8, flex: 1, fontWeight: '500' },
    inputGroup: { marginBottom: 20 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, minHeight: 56, paddingHorizontal: 16 },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, height: 56, fontSize: 16, color: COLORS.textPrimary, fontWeight: '500' },
    eyeBtn: { padding: 8, marginRight: -8 },
    submitBtn: { backgroundColor: '#F59E0B', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 12, elevation: 8 },
    submitBtnDisabled: { opacity: 0.7 },
    submitBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' }
});
