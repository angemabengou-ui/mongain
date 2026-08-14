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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { apiRequestResetOTP } from '../../services/api';

export default function ForgotPinScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleRequestOTP = async () => {
        setError('');
        if (!phone) {
            setError('Veuillez entrer votre numéro de téléphone.');
            return;
        }
        setLoading(true);
        try {
            const formattedPhone = phone.startsWith('+') ? phone : `+241${phone.replace(/\\s+/g, '')}`;
            await apiRequestResetOTP(formattedPhone);
            // Redirige vers reset
            router.push({ pathname: '/auth/reset-pin' as any, params: { phone: formattedPhone } });
        } catch (e: any) {
            setError(e.message || "Une erreur s'est produite");
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                    </TouchableOpacity>

                    <View style={styles.header}>
                        <View style={styles.logo}>
                            <Ionicons name="lock-closed" size={36} color={COLORS.primary} />
                        </View>
                        <Text style={styles.appName}>Mot de passe oublié</Text>
                        <Text style={styles.tagline}>Entrez votre numéro pour recevoir un code par SMS</Text>
                    </View>

                    <View style={styles.card}>
                        {error ? (
                            <View style={styles.errorBox}>
                                <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                                <Text style={styles.errorText}>{error}</Text>
                            </View>
                        ) : null}

                        <Text style={styles.label}>Numéro de téléphone</Text>
                        <View style={styles.inputContainer}>
                            <Text style={styles.prefix}>+241</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="00 00 00 00"
                                keyboardType="phone-pad"
                                value={phone}
                                onChangeText={setPhone}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.btn, (!phone || loading) && styles.btnDisabled]}
                            onPress={handleRequestOTP}
                            disabled={!phone || loading}
                        >
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Envoyer le Code SMS</Text>
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
        appName: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
        tagline: { fontSize: 16, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: 20 },
        card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 5 },
        label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
        inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 16, marginBottom: 20, height: 56 },
        prefix: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginRight: 8, paddingRight: 8, borderRightWidth: 1, borderRightColor: COLORS.border },
        input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, height: '100%' },
        btn: { backgroundColor: COLORS.primary, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
        btnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
        btnText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
        errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: '#FECACA' },
        errorText: { color: COLORS.error, fontSize: 14, marginLeft: 8, flex: 1 }
    });
}
