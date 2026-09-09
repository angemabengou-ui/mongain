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
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getChildAccent } from '../constants/childAccent';
import { useAppTheme } from '../constants/theme';
import { apiRegisterChild, apiRequestChildOtp } from '../services/api';

// Assistant en 2 étapes, même state machine que auth/register.tsx (téléphone → OTP puis
// infos + PIN) — l'enfant a un vrai numéro de téléphone et son propre PIN (décision validée :
// "L'enfant a sa propre connexion"), donc ce flux ressemble volontairement à une inscription
// normale plutôt qu'à un simple formulaire de profil.
export default function FamilyCreateScreen() {
    const insets = useSafeAreaInsets();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    const [step, setStep] = useState<1 | 2>(1);

    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [gender, setGender] = useState<'MALE' | 'FEMALE' | undefined>(undefined);
    const [otpCode, setOtpCode] = useState('');
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [showPin, setShowPin] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const accent = getChildAccent(gender);

    const handleRequestOtp = async () => {
        setError('');
        if (!phone || phone.length < 8) {
            setError('Numéro de téléphone invalide.');
            return;
        }
        setLoading(true);
        try {
            const formattedPhone = phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`;
            await apiRequestChildOtp(formattedPhone);
            setStep(2);
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Erreur de connexion.');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        setError('');
        if (!name || !otpCode || !pin || !confirmPin) {
            setError('Veuillez remplir tous les champs obligatoires.');
            return;
        }
        if (otpCode.length !== 4) {
            setError('Le code de vérification SMS doit comporter 4 chiffres.');
            return;
        }
        if (pin.length !== 4 || !/^\d+$/.test(pin)) {
            setError('Le code PIN doit comporter exactement 4 chiffres.');
            return;
        }
        if (pin !== confirmPin) {
            setError('Les deux codes PIN ne correspondent pas.');
            return;
        }

        setLoading(true);
        try {
            const formattedPhone = phone.startsWith('+') ? phone : `+241${phone.replace(/\s+/g, '')}`;
            await apiRegisterChild(name, formattedPhone, pin, otpCode, gender);
            router.replace('/family-hub');
        } catch (e: any) {
            setError(e.response?.data?.error || e.message || 'Erreur lors de la création.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity onPress={() => step === 2 ? setStep(1) : router.back()} style={styles.backBtn}>
                            <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                        </TouchableOpacity>
                        <Text style={[styles.title, { color: COLORS.textPrimary }]}>
                            {step === 1 ? 'Nouveau compte enfant' : 'Informations de l\'enfant'}
                        </Text>
                    </View>

                    {error ? (
                        <View style={[styles.errorBox, { backgroundColor: COLORS.error + '15' }]}>
                            <Ionicons name="alert-circle-outline" size={18} color={COLORS.error} />
                            <Text style={[styles.errorText, { color: COLORS.error }]}>{error}</Text>
                        </View>
                    ) : null}

                    {step === 1 ? (
                        <>
                            <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                                Votre enfant aura son propre numéro de téléphone et son propre code PIN pour se connecter.
                            </Text>
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Numéro de téléphone de l'enfant</Text>
                                <View style={[styles.inputContainer, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                                    <Ionicons name="call-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                    <Text style={[styles.prefix, { color: COLORS.textSecondary, borderColor: COLORS.border }]}>+241</Text>
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary }]}
                                        placeholder="Ex: 77 00 00 00"
                                        placeholderTextColor={COLORS.textSecondary}
                                        keyboardType="phone-pad"
                                        value={phone}
                                        onChangeText={setPhone}
                                    />
                                </View>
                            </View>

                            <TouchableOpacity
                                style={[styles.submitBtn, { backgroundColor: COLORS.primary }, loading && { opacity: 0.7 }]}
                                onPress={handleRequestOtp}
                                disabled={loading}
                            >
                                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Vérifier ce numéro</Text>}
                            </TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <Text style={{ color: COLORS.textSecondary, marginBottom: 16, fontSize: 13, lineHeight: 20 }}>
                                Un code de vérification SMS a été envoyé au <Text style={{ fontFamily: 'Satoshi-SemiBold', fontWeight: '700', color: COLORS.textPrimary }}>+241 {phone}</Text>.
                            </Text>

                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code SMS reçu</Text>
                                <View style={[styles.inputContainer, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                                    <Ionicons name="chatbubble-ellipses-outline" size={20} color={COLORS.primary} style={styles.inputIcon} />
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary }]}
                                        placeholder="Entrez 4 chiffres"
                                        placeholderTextColor={COLORS.textSecondary}
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        value={otpCode}
                                        onChangeText={setOtpCode}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Prénom et nom de l'enfant</Text>
                                <View style={[styles.inputContainer, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                                    <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary }]}
                                        placeholder="Ex: Junior Dupont"
                                        placeholderTextColor={COLORS.textSecondary}
                                        value={name}
                                        onChangeText={setName}
                                    />
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Sexe (personnalise la couleur de son profil)</Text>
                                <View style={styles.genderRow}>
                                    {(['MALE', 'FEMALE'] as const).map((g) => {
                                        const gAccent = getChildAccent(g);
                                        const selected = gender === g;
                                        return (
                                            <TouchableOpacity
                                                key={g}
                                                style={[
                                                    styles.genderBtn,
                                                    { borderColor: selected ? gAccent.color : COLORS.border, backgroundColor: selected ? gAccent.tint : COLORS.surface },
                                                ]}
                                                onPress={() => setGender(g)}
                                            >
                                                <View style={[styles.genderDot, { backgroundColor: gAccent.color }]} />
                                                <Text style={[styles.genderLabel, { color: selected ? gAccent.color : COLORS.textSecondary }]}>{gAccent.label}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN de l'enfant</Text>
                                <View style={[styles.inputContainer, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                                    <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary }]}
                                        placeholder="4 chiffres"
                                        placeholderTextColor={COLORS.textSecondary}
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        secureTextEntry={!showPin}
                                        value={pin}
                                        onChangeText={setPin}
                                    />
                                    <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                        <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Confirmer le code PIN</Text>
                                <View style={[styles.inputContainer, { borderColor: COLORS.border, backgroundColor: COLORS.surface }]}>
                                    <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary }]}
                                        placeholder="Répétez le code"
                                        placeholderTextColor={COLORS.textSecondary}
                                        keyboardType="number-pad"
                                        maxLength={4}
                                        secureTextEntry={!showPin}
                                        value={confirmPin}
                                        onChangeText={setConfirmPin}
                                    />
                                </View>
                            </View>

                            <TouchableOpacity
                                style={[styles.submitBtn, { backgroundColor: accent.color }, loading && { opacity: 0.7 }]}
                                onPress={handleCreate}
                                disabled={loading}
                            >
                                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Créer le compte</Text>}
                            </TouchableOpacity>
                        </>
                    )}
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    flex: { flex: 1 },
    scroll: { padding: 20, paddingBottom: 40 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
    backBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    title: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', flex: 1 },

    errorBox: { flexDirection: 'row', padding: 12, borderRadius: 12, marginBottom: 16, alignItems: 'center' },
    errorText: { fontSize: 13, marginLeft: 8, flex: 1 },
    helper: { fontSize: 13.5, lineHeight: 20, marginBottom: 20 },

    inputGroup: { marginBottom: 18 },
    label: { fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, minHeight: 56, paddingHorizontal: 16 },
    inputIcon: { marginRight: 12 },
    prefix: { fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginRight: 8, borderRightWidth: 1, paddingRight: 8 },
    input: { flex: 1, height: 56, fontSize: 16 },
    eyeBtn: { padding: 8, marginRight: -8 },

    genderRow: { flexDirection: 'row', gap: 12 },
    genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, gap: 8 },
    genderDot: { width: 10, height: 10, borderRadius: 5 },
    genderLabel: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },

    submitBtn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    submitBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});
