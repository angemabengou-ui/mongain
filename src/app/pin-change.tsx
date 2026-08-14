import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiUpdatePin } from '../services/api';

export default function PinChangeScreen() {
    const router = useRouter();
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
            const res = await apiUpdatePin(oldPin, newPin);
            Alert.alert('Succès', res.message, [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de mettre à jour le code PIN');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Sécurité & PIN</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Form */}
                <View style={styles.formContainer}>
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
                            <ActivityIndicator color={COLORS.surface} />
                        ) : (
                            <Text style={styles.saveButtonText}>Mettre à jour le PIN</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        borderBottomWidth: 1, borderBottomColor: COLORS.border,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '600' },
    formContainer: { padding: 24, flex: 1 },
    label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderWidth: 1, borderColor: COLORS.border,
        borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 24,
    },
    input: { flex: 1, fontSize: 18, letterSpacing: 4, color: COLORS.textPrimary },
    saveButton: {
        backgroundColor: COLORS.primary, height: 56, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center', marginTop: 12
    },
    disabledButton: { opacity: 0.5 },
    saveButtonText: { color: COLORS.surface, fontSize: 18, fontWeight: '700' }
});
