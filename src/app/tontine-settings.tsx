import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiCancelTontine, apiGetTontineDetails, apiUpdateTontineSettings } from '../services/api';

// Réglages qu'on touche rarement, extraits de tontine-detail.tsx pour les mêmes raisons que
// vault-settings.tsx : l'écran principal reste concentré sur l'usage courant (cotiser,
// suivre son tour), pas sur la configuration. Le nom et le statut public restent modifiables
// à tout moment ; la cotisation et la fréquence se figent dès que le premier cycle a tourné
// (voir tontine.ts, PUT /settings) — changer ces deux-là en cours de route créerait une
// vraie incohérence entre membres, pas juste une gêne cosmétique.
export default function TontineSettingsScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [group, setGroup] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [name, setName] = useState('');
    const [contribution, setContribution] = useState('');
    const [frequency, setFrequency] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
    const [isPublic, setIsPublic] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const res = await apiGetTontineDetails(id);
            if (res.success) {
                setGroup(res.data);
                setName(res.data.name);
                setContribution(String(res.data.contribution));
                setFrequency(res.data.frequency);
                setIsPublic(!!res.data.isPublic);
            }
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger les réglages.');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const hasStarted = (group?.cycles || []).length > 0;
    const isCreator = group?.creatorId === user?.id;

    const handleSave = async () => {
        if (!name.trim()) {
            Alert.alert('Nom requis', 'Donnez un nom au club.');
            return;
        }
        const amt = contribution.replace(/\s/g, '').replace(',', '.');
        if (!hasStarted && (!amt || Number(amt) <= 0)) {
            Alert.alert('Cotisation invalide', 'Indiquez un montant de cotisation valide.');
            return;
        }
        setSaving(true);
        try {
            await apiUpdateTontineSettings(id, {
                name: name.trim(),
                isPublic,
                ...(hasStarted ? {} : { contribution: Number(amt), frequency }),
            });
            Alert.alert('Enregistré', 'Les paramètres du club ont été mis à jour.');
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible d\'enregistrer.');
        } finally {
            setSaving(false);
        }
    };

    const handleCancel = () => {
        Alert.alert(
            'Dissoudre ce club',
            `Cette action est définitive. Plus aucune cotisation ne sera prélevée ni cagnotte versée pour « ${group.name} ». Les ${(group.participants || []).filter((p: any) => p.status === 'ACTIVE').length} membres actifs seront prévenus.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Dissoudre', style: 'destructive', onPress: async () => {
                        try {
                            await apiCancelTontine(id);
                            router.back();
                        } catch (e: any) {
                            Alert.alert('Impossible de dissoudre', e.message || 'Une erreur est survenue.');
                        }
                    }
                },
            ]
        );
    };

    if (loading || !group) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    if (!isCreator) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <ScreenHeader title="Paramètres" onBack={() => router.back()} />
                <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                    <View style={styles.centerFill}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
                            Seul le créateur du club peut accéder à ces réglages.
                        </Text>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <ScreenHeader title={`Paramètres — ${group.name}`} onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

                    <SectionHeading colors={COLORS} title="Nom du club" marginTop={0} />
                    <TextInput
                        style={[styles.input, { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border }]}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="sentences"
                    />

                    <SectionHeading colors={COLORS} title="Cotisation & fréquence" />
                    {hasStarted && (
                        <View style={[styles.lockedBox, { backgroundColor: COLORS.warning + '12' }]}>
                            <Ionicons name="lock-closed" size={16} color={COLORS.warning} style={{ marginRight: 8 }} />
                            <Text style={[styles.lockedText, { color: COLORS.warning }]}>
                                Figées dès le premier cycle exécuté — les changer en cours de route pénaliserait injustement certains membres par rapport à d'autres.
                            </Text>
                        </View>
                    )}
                    <TextInput
                        style={[
                            styles.input,
                            { color: COLORS.textPrimary, backgroundColor: COLORS.surface, borderColor: COLORS.border },
                            hasStarted && styles.inputDisabled,
                        ]}
                        placeholder="Montant en FCFA"
                        placeholderTextColor={COLORS.textSecondary}
                        keyboardType="numeric"
                        value={contribution}
                        onChangeText={setContribution}
                        editable={!hasStarted}
                    />
                    <View style={styles.toggleRow}>
                        <TouchableOpacity
                            style={[styles.toggleBtn, { borderColor: COLORS.border }, frequency === 'WEEKLY' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }, hasStarted && styles.inputDisabled]}
                            onPress={() => !hasStarted && setFrequency('WEEKLY')}
                            disabled={hasStarted}
                        >
                            <Text style={[styles.toggleText, { color: frequency === 'WEEKLY' ? COLORS.primary : COLORS.textSecondary }]}>Hebdomadaire</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleBtn, { borderColor: COLORS.border }, frequency === 'MONTHLY' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }, hasStarted && styles.inputDisabled]}
                            onPress={() => !hasStarted && setFrequency('MONTHLY')}
                            disabled={hasStarted}
                        >
                            <Text style={[styles.toggleText, { color: frequency === 'MONTHLY' ? COLORS.primary : COLORS.textSecondary }]}>Mensuelle</Text>
                        </TouchableOpacity>
                    </View>

                    <SectionHeading colors={COLORS} title="Visibilité" />
                    <View style={[styles.publicRow, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 }}>Club public</Text>
                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>
                                Visible dans « Découvrir des tontines » — n'importe qui peut le rejoindre sans invitation.
                            </Text>
                        </View>
                        <Switch value={isPublic} onValueChange={setIsPublic} trackColor={{ true: COLORS.primary }} />
                    </View>

                    <TouchableOpacity
                        style={[styles.submitBtn, { backgroundColor: COLORS.primary }, saving && styles.submitBtnDisabled]}
                        onPress={handleSave}
                        disabled={saving}
                    >
                        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Enregistrer</Text>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.dissolveBtn} onPress={handleCancel}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.error} />
                        <Text style={[styles.dissolveBtnText, { color: COLORS.error }]}>Dissoudre ce club</Text>
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, height: 54, fontSize: 15, marginBottom: 14 },
    inputDisabled: { opacity: 0.5 },

    lockedBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, padding: 12, marginBottom: 12 },
    lockedText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

    toggleRow: { flexDirection: 'row', gap: 10 },
    toggleBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
    toggleText: { fontSize: 13.5, fontWeight: '700' },

    publicRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: 16 },

    submitBtn: { marginTop: 32, paddingVertical: 17, borderRadius: 16, alignItems: 'center' },
    submitBtnDisabled: { opacity: 0.5 },
    submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    dissolveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, paddingVertical: 14 },
    dissolveBtnText: { fontSize: 14, fontWeight: '700' },
});
