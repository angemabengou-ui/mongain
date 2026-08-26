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
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiCreateTontine } from '../services/api';

export default function TontineCreateScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [name, setName] = useState('');
    const [contribution, setContribution] = useState('');
    const [frequency, setFrequency] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
    const [isPublic, setIsPublic] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleCreate = async () => {
        const amt = contribution.replace(/\s/g, '').replace(',', '.');
        if (!name.trim() || !amt || Number(amt) <= 0) {
            Alert.alert('Informations manquantes', 'Donnez un nom et un montant de cotisation valide.');
            return;
        }
        setLoading(true);
        try {
            await apiCreateTontine(name.trim(), Number(amt), frequency, isPublic);
            router.back();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de créer le club.');
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
                <Text style={styles.headerTitle}>Nouveau club</Text>
                <View style={{ width: 44 }} />
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Nom du club</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        placeholder="Ex : Tontine Famille"
                        placeholderTextColor={COLORS.textSecondary}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Cotisation par personne (FCFA)</Text>
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        placeholder="Ex : 10000"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="numeric"
                        value={contribution}
                        onChangeText={setContribution}
                    />

                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Fréquence des prélèvements</Text>
                    <View style={styles.toggleRow}>
                        <TouchableOpacity
                            style={[styles.toggleBtn, { borderColor: COLORS.border }, frequency === 'WEEKLY' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                            onPress={() => setFrequency('WEEKLY')}
                        >
                            <Text style={[styles.toggleText, { color: frequency === 'WEEKLY' ? COLORS.primary : COLORS.textSecondary }]}>Hebdomadaire</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleBtn, { borderColor: COLORS.border }, frequency === 'MONTHLY' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                            onPress={() => setFrequency('MONTHLY')}
                        >
                            <Text style={[styles.toggleText, { color: frequency === 'MONTHLY' ? COLORS.primary : COLORS.textSecondary }]}>Mensuelle</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={[styles.helper, { color: COLORS.textSecondary }]}>
                        Vous rejoignez automatiquement en premier de la liste. Invitez ensuite les autres membres depuis le club.
                    </Text>

                    <View style={[styles.publicRow, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 }}>Club public</Text>
                            <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 4 }]}>
                                Visible dans « Découvrir des tontines » — n'importe qui peut le rejoindre sans invitation. Laissez désactivé pour un club privé, sur invitation uniquement.
                            </Text>
                        </View>
                        <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: COLORS.primary }} />
                    </View>

                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: COLORS.primary }, (!name.trim() || !contribution || loading) && styles.submitBtnDisabled]}
                        onPress={handleCreate}
                        disabled={!name.trim() || !contribution || loading}
                    >
                        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Créer le club</Text>}
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

    toggleRow: { flexDirection: 'row', gap: 10 },
    toggleBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
    toggleText: { fontSize: 13.5, fontWeight: '700' },
    helper: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
    publicRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 24 },

    submitBtn: { marginTop: 32, paddingVertical: 17, borderRadius: 16, alignItems: 'center' },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
