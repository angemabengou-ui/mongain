import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiCreateReclamation } from '../services/api';

export default function SupportScreen() {
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);

    const submitReclamation = async () => {
        if (!title.trim() || !description.trim()) {
            Alert.alert('Erreur', 'Veuillez remplir tous les champs.');
            return;
        }
        setLoading(true);
        try {
            await apiCreateReclamation(title, description);

            Alert.alert('Demande envoyée !', 'Notre équipe technique a reçu votre réclamation et va traiter votre dossier rapidement.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (err: any) {
            Alert.alert('Erreur', err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Support Client</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.container}>
                <View style={styles.iconContainer}>
                    <Ionicons name="chatbubbles" size={60} color={COLORS.primary} />
                </View>

                <Text style={styles.greeting}>Bonjour {user?.name?.split(' ')[0] || ''},</Text>
                <Text style={styles.subtext}>
                    Besoin d'aide avec une transaction bloquée ou une erreur système ? Décrivez votre problème ci-dessous, notre équipe réagit sous 24h.
                </Text>

                <View style={styles.inputCard}>
                    <Text style={styles.inputLabel}>Sujet de votre demande</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Ex: Transfert non reçu..."
                        placeholderTextColor={COLORS.textSecondary + '70'}
                        value={title}
                        onChangeText={setTitle}
                    />

                    <Text style={styles.inputLabel}>Détails explicatifs</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Décrivez précisément votre réclamation (montant, date, numéro concerné)..."
                        placeholderTextColor={COLORS.textSecondary + '70'}
                        value={description}
                        onChangeText={setDescription}
                        multiline
                        textAlignVertical="top"
                    />

                    <TouchableOpacity
                        style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                        activeOpacity={0.8}
                        onPress={submitReclamation}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color={COLORS.surface} />
                        ) : (
                            <>
                                <Text style={styles.submitBtnText}>Envoyer la réclamation</Text>
                                <Ionicons name="paper-plane" size={20} color={COLORS.surface} />
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: COLORS.surface,
        borderBottomWidth: 1,
        borderColor: '#2D1F4D',
    },
    backBtn: {
        width: 40, height: 40,
        borderRadius: 20,
        backgroundColor: COLORS.background,
        justifyContent: 'center', alignItems: 'center'
    },
    headerTitle: {
        flex: 1, textAlign: 'center',
        fontSize: 18, fontWeight: '700',
        color: COLORS.textPrimary,
    },
    container: {
        flex: 1,
        paddingTop: 30,
        paddingHorizontal: 24,
    },
    iconContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    greeting: {
        fontSize: 24,
        fontWeight: '800',
        color: COLORS.textPrimary,
        marginBottom: 8,
        textAlign: 'center',
    },
    subtext: {
        fontSize: 15,
        color: COLORS.textSecondary,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 30,
    },
    inputCard: {
        backgroundColor: COLORS.surface,
        borderRadius: 20,
        padding: 20,
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: COLORS.textSecondary,
        marginBottom: 8,
        marginTop: 15,
        textTransform: 'uppercase',
    },
    input: {
        backgroundColor: COLORS.background,
        borderWidth: 1,
        borderColor: '#2D1F4D',
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        color: COLORS.textPrimary,
    },
    textArea: {
        height: 120,
        paddingTop: 16,
    },
    submitBtn: {
        flexDirection: 'row',
        backgroundColor: COLORS.primary,
        borderRadius: 14,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 30,
        gap: 10,
    },
    submitBtnDisabled: {
        opacity: 0.7,
    },
    submitBtnText: {
        color: COLORS.surface,
        fontSize: 16,
        fontWeight: '700',
    },
});
