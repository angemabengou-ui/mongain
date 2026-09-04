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
import { useAuth } from '../context/AuthContext';
import { apiUpdatePin } from '../services/api';
import { disableBiometricPin } from '../services/biometrics';

export default function PinChangeScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { logout } = useAuth();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [oldPin, setOldPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        if (newPin !== confirmPin) {
            Alert.alert('Erreur', 'Les nouveaux codes PIN ne correspondent pas.');
            return;
        }

        if (newPin.length !== 4) {
            Alert.alert('Erreur', 'Le nouveau PIN doit comporter 4 chiffres.');
            return;
        }

        setLoading(true);
        try {
            await apiUpdatePin(oldPin, newPin);
            // Le PIN mis en cache pour le déverrouillage biométrique est désormais obsolète.
            await disableBiometricPin();
            // Le serveur révoque la session en cours dès que le PIN change (mesure de
            // sécurité : couper l'accès à quiconque détenait déjà un token valide). Sans
            // déconnexion explicite ici, l'app restait sur cet écran avec un token déjà
            // mort — le prochain appel authentifié échouait avec une erreur "Session
            // expirée" surprenante, sans rapport apparent avec le changement de PIN qui
            // venait pourtant de réussir.
            Alert.alert(
                'Code PIN mis à jour',
                'Pour votre sécurité, veuillez vous reconnecter avec votre nouveau code.',
                [{ text: 'OK', onPress: () => logout() }]
            );
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de mettre à jour le code PIN');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['top']}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>

                {/* Header Top Section */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={26} color="#ffffff" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Sécurité & PIN</Text>
                    <View style={{ width: 40 }} />
                </View>

                <View style={styles.headerSpacer}>
                    <Ionicons name="shield-checkmark" size={64} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.headerSubtitle}>Protégez votre portefeuille</Text>
                </View>

                {/* Main Card */}
                <ScrollView
                    contentContainerStyle={[styles.card, { paddingBottom: Math.max(insets.bottom, 20) + 40 }]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    <Text style={styles.title}>Mise à jour du code PIN</Text>

                    <Text style={styles.label}>Ancien code PIN</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={oldPin}
                            onChangeText={setOldPin}
                            placeholder="Ancien PIN (4 chiffres)"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            secureTextEntry
                            maxLength={4}
                        />
                    </View>

                    <Text style={styles.label}>Nouveau code PIN</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="key-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={newPin}
                            onChangeText={setNewPin}
                            placeholder="Nouveau PIN (4 chiffres)"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            secureTextEntry
                            maxLength={4}
                        />
                    </View>

                    <Text style={styles.label}>Confirmez le nouveau PIN</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={confirmPin}
                            onChangeText={setConfirmPin}
                            placeholder="Confirmer nouveau PIN"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            secureTextEntry
                            maxLength={4}
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.saveButton, (!oldPin || !newPin || !confirmPin) && styles.disabledButton]}
                        onPress={handleSave}
                        disabled={loading || !oldPin || !newPin || !confirmPin}
                    >
                        {loading ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.saveButtonText}>Valider la modification</Text>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.primary },
    flex: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.primary,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { color: '#ffffff', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    headerSpacer: {
        alignItems: 'center', justifyContent: 'center',
        paddingVertical: 28, backgroundColor: COLORS.primary, marginBottom: 16
    },
    headerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 15, marginTop: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    card: {
        flexGrow: 1, backgroundColor: COLORS.background,
        borderTopLeftRadius: 36, borderTopRightRadius: 36,
        padding: 28, paddingTop: 32
    },
    title: { fontSize: 24, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 28 },
    label: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textSecondary, marginBottom: 8, marginTop: 4 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderWidth: 1, borderColor: COLORS.border,
        borderRadius: 16, paddingHorizontal: 16, height: 58, marginBottom: 20,
    },
    input: { flex: 1, fontSize: 18, letterSpacing: 4, color: COLORS.textPrimary, height: '100%', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    saveButton: {
        backgroundColor: COLORS.primary, height: 58, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center', marginTop: 16,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 6,
    },
    disabledButton: { opacity: 0.5, elevation: 0, shadowOpacity: 0 },
    saveButtonText: { color: '#fff', fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }
});
