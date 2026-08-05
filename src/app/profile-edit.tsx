import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiGetMe, apiUpdateProfile } from '../services/api';

export default function ProfileEditScreen() {
    const router = useRouter();
    const { user, setUser } = useAuth();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [name, setName] = useState(user?.name ?? '');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        if (name.trim().length < 2) {
            Alert.alert('Erreur', 'Le nom doit comporter au moins 2 caractères.');
            return;
        }

        setLoading(true);
        try {
            await apiUpdateProfile(name.trim());
            // Update auth context by re-fetching Me
            const me = await apiGetMe();
            setUser(me);
            Alert.alert('Succès', 'Vos informations ont été mises à jour.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de mettre à jour le profil');
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
                    <Text style={styles.headerTitle}>Modifier mon profil</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Form */}
                <View style={styles.formContainer}>
                    <Text style={styles.label}>Nom complet</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Votre nom"
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={styles.infoText}>
                        Votre numéro de téléphone ({user?.phone}) vous sert d'identifiant et ne peut pas être modifié.
                    </Text>

                    <TouchableOpacity
                        style={[styles.saveButton, (name.trim() === user?.name || name.trim().length === 0) && styles.disabledButton]}
                        onPress={handleSave}
                        disabled={loading || name.trim() === user?.name || name.trim().length === 0}
                    >
                        {loading ? (
                            <ActivityIndicator color={COLORS.surface} />
                        ) : (
                            <Text style={styles.saveButtonText}>Enregistrer</Text>
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
    label: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderWidth: 1, borderColor: COLORS.border,
        borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 16,
    },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary },
    infoText: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 32, lineHeight: 20 },
    saveButton: {
        backgroundColor: COLORS.primary, height: 56, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center',
    },
    disabledButton: { opacity: 0.5 },
    saveButtonText: { color: COLORS.surface, fontSize: 18, fontWeight: '700' }
});
