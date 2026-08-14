import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

export default function VerifyLoginOtpScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { phone } = useLocalSearchParams();
    const { verifyLoginOtp } = useAuth();

    const [otpCode, setOtpCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleVerify = async () => {
        setError('');
        if (!otpCode || otpCode.length !== 4) {
            setError('Veuillez entrer le code à 4 chiffres.');
            return;
        }

        setLoading(true);
        try {
            await verifyLoginOtp(phone as string, otpCode);
            router.replace('/');
        } catch (e: any) {
            setError(e.message || 'Code invalide ou expiré.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={28} color="#fff" />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Vérification de sécurité</Text>
                    </View>

                    <View style={styles.card}>
                        <View style={styles.iconWrap}>
                            <Ionicons name="shield-checkmark" size={48} color={COLORS.primary} />
                        </View>
                        <Text style={styles.title}>Double Authentification</Text>
                        <Text style={styles.subtitle}>
                            Un code de sécurité à 4 chiffres vous a été envoyé par SMS au <Text style={{ fontWeight: '700', color: COLORS.textPrimary }}>{phone}</Text>.
                        </Text>

                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <Text style={styles.label}>Code reçu par SMS</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="keypad-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••"
                                keyboardType="number-pad"
                                maxLength={4}
                                value={otpCode}
                                onChangeText={setOtpCode}
                                placeholderTextColor={COLORS.textSecondary}
                                autoFocus
                            />
                        </View>

                        <TouchableOpacity style={styles.btn} onPress={handleVerify} disabled={loading || otpCode.length !== 4}>
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Valider et se connecter</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, padding: 24, justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    backButton: { marginRight: 16 },
    headerTitle: { fontSize: 22, fontWeight: '800', color: '#fff' },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 8 },
    iconWrap: { alignSelf: 'center', marginBottom: 16, backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50 },
    title: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8, textAlign: 'center' },
    subtitle: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 32, textAlign: 'center', lineHeight: 22 },
    errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', borderRadius: 12, padding: 12, marginBottom: 16 },
    errorText: { color: COLORS.error, fontSize: 14, marginLeft: 8, flex: 1 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, fontSize: 20, color: COLORS.textPrimary, fontWeight: '700', letterSpacing: 4 },
    btn: { backgroundColor: COLORS.primary, height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
