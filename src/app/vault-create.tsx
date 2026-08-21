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

export default function VaultCreateScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [requiredApprovals, setRequiredApprovals] = useState(1);
    const [loading, setLoading] = useState(false);

    const handleCreate = async () => {
        if (!name.trim()) {
            Alert.alert('Nom requis', 'Donnez un nom à votre caisse (ex : Caisse Mariage).');
            return;
        }
        setLoading(true);
        try {
            await apiCreateVault({ name: name.trim(), description: description.trim() || undefined, requiredApprovals });
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

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Approbations requises pour un retrait</Text>
                    <View style={[styles.stepper, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <TouchableOpacity
                            style={styles.stepperBtn}
                            onPress={() => setRequiredApprovals(Math.max(1, requiredApprovals - 1))}
                        >
                            <Ionicons name="remove" size={20} color={COLORS.primary} />
                        </TouchableOpacity>
                        <Text style={[styles.stepperValue, { color: COLORS.textPrimary }]}>{requiredApprovals}</Text>
                        <TouchableOpacity
                            style={styles.stepperBtn}
                            onPress={() => setRequiredApprovals(Math.min(10, requiredApprovals + 1))}
                        >
                            <Ionicons name="add" size={20} color={COLORS.primary} />
                        </TouchableOpacity>
                    </View>
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                        {requiredApprovals === 1
                            ? "Vous pourrez approuver seul tout retrait, envois directs compris — pratique pour démarrer. Relevez ce nombre plus tard une fois d'autres commissaires ajoutés."
                            : `Tout retrait, envois directs compris, devra être approuvé par ${requiredApprovals} commissaires désignés avant d'être exécuté.`}
                    </Text>

                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: COLORS.primary }, (!name.trim() || loading) && styles.submitBtnDisabled]}
                        onPress={handleCreate}
                        disabled={!name.trim() || loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Créer la caisse</Text>}
                    </TouchableOpacity>
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
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

    stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14, paddingVertical: 8, gap: 28 },
    stepperBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
    stepperValue: { fontSize: 22, fontWeight: '800', minWidth: 30, textAlign: 'center' },
    helper: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },

    submitBtn: { marginTop: 32, paddingVertical: 17, borderRadius: 16, alignItems: 'center' },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
