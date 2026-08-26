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
import { apiCreateVault } from '../services/api';

// Le seuil d'approbations (combien de commissaires doivent valider un retrait) n'est
// plus demandé ici — un nouvel utilisateur ne sait pas encore ce que ça signifie ni
// combien de membres rejoindront sa caisse. Le backend démarre à 1 (le créateur peut
// agir seul) par défaut ; réglable ensuite depuis les Paramètres de la caisse une fois
// que d'autres membres l'ont rejointe.
export default function VaultCreateScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);

    const handleCreate = async () => {
        if (!name.trim()) {
            Alert.alert('Nom requis', 'Donnez un nom à votre caisse (ex : Caisse Mariage).');
            return;
        }
        setLoading(true);
        try {
            await apiCreateVault({ name: name.trim(), description: description.trim() || undefined });
            router.back();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de créer la caisse.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                    <Ionicons name="close" size={26} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Nouvelle caisse</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Nom de la caisse</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        placeholder="Ex : Caisse Mariage"
                        placeholderTextColor={COLORS.textSecondary}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="sentences"
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Description (optionnel)</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border, height: 90, textAlignVertical: 'top', paddingTop: 14 }]}
                        placeholder="À quoi servira cette caisse ?"
                        placeholderTextColor={COLORS.textSecondary}
                        value={description}
                        onChangeText={setDescription}
                        multiline
                    />

                    <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '10' }]}>
                        <Ionicons name="information-circle" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                        <Text style={[styles.infoText, { color: COLORS.textSecondary }]}>
                            Vous serez seul décideur au départ. Une fois d'autres membres ajoutés, réglez depuis les Paramètres de la caisse combien doivent valider chaque retrait.
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: COLORS.primary }, (!name.trim() || loading) && styles.submitBtnDisabled]}
                        onPress={handleCreate}
                        disabled={!name.trim() || loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Créer la caisse</Text>}
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
    backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 24, paddingBottom: 60 },

    label: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 18 },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 54, fontSize: 15 },

    infoBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 14, padding: 14, marginTop: 24 },
    infoText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

    submitBtn: { marginTop: 32, paddingVertical: 17, borderRadius: 16, alignItems: 'center' },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
