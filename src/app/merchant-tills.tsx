import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import { apiCreateMerchantTill, apiDeleteMerchantTill, apiGetMerchantTills, MerchantTill } from '../services/api';

// Gestion des guichets (MerchantTill) d'un marchand — un guichet est un login dédié
// (téléphone + PIN propres, PAS un compte Mongain) pour un point d'encaissement physique
// (ex : un caissier). Tout encaissement fait depuis un guichet (voir till-collect.tsx, via
// la session distincte ouverte sur till-login.tsx) crédite directement le wallet DE CE
// marchand, jamais un wallet séparé. Cet écran se pilote avec la session NORMALE du
// marchand (AuthContext) — jamais avec une session guichet.
export default function MerchantTillsScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [tills, setTills] = useState<MerchantTill[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // Distinct de tills.length === 0 : voir merchant-affiliations.tsx (loadError), même
    // correctif — un marchand sans AUCUN guichet et un échec réseau afficheraient sinon le
    // même écran "Aucun guichet", sans que l'un ou l'autre ne soit distinguable.
    const [loadError, setLoadError] = useState<string | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [pin, setPin] = useState('');
    const [pinConfirm, setPinConfirm] = useState('');
    const [creating, setCreating] = useState(false);

    const [deletingId, setDeletingId] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetMerchantTills();
            setTills(res || []);
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e.response?.data?.error || e.message || 'Impossible de charger vos guichets.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const resetForm = () => {
        setName('');
        setPhone('');
        setPin('');
        setPinConfirm('');
    };

    const handleCreate = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            Alert.alert('Nom requis', 'Indiquez un nom pour identifier ce guichet (ex : "Caisse 1").');
            return;
        }
        if (!phone.trim()) {
            Alert.alert('Téléphone requis', 'Indiquez le numéro de téléphone dédié à ce guichet.');
            return;
        }
        if (!/^\d{4}$/.test(pin)) {
            Alert.alert('Code PIN invalide', 'Le code PIN du guichet doit comporter exactement 4 chiffres.');
            return;
        }
        if (pin !== pinConfirm) {
            Alert.alert('Les codes PIN ne correspondent pas', 'Vérifiez la confirmation du code PIN.');
            return;
        }

        // Même normalisation que auth/login.tsx : un guichet reçoit un numéro local sans
        // indicatif dans la grande majorité des cas.
        const trimmedPhone = phone.trim();
        const isPhone = /^[0-9\s+]+$/.test(trimmedPhone);
        const formattedPhone = isPhone
            ? (trimmedPhone.startsWith('+') ? trimmedPhone : `+241${trimmedPhone.replace(/\s+/g, '')}`)
            : trimmedPhone;

        setCreating(true);
        try {
            await apiCreateMerchantTill(trimmedName, formattedPhone, pin);
            resetForm();
            setShowForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de la création', e.response?.data?.error || e.message || 'Une erreur est survenue.');
        } finally {
            setCreating(false);
        }
    };

    const handleDeactivate = (till: MerchantTill) => {
        Alert.alert(
            'Désactiver ce guichet ?',
            `"${till.name}" ne pourra plus se connecter ni encaisser.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Désactiver',
                    style: 'destructive',
                    onPress: async () => {
                        setDeletingId(till.id);
                        try {
                            await apiDeleteMerchantTill(till.id);
                            load();
                        } catch (e: any) {
                            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Action impossible.');
                        } finally {
                            setDeletingId(null);
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Mes guichets" onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                {loading ? (
                    <View style={styles.centerFill}>
                        <ActivityIndicator color={COLORS.primary} size="large" />
                    </View>
                ) : loadError ? (
                    <View style={styles.centerFill}>
                        <Ionicons name="alert-circle-outline" size={40} color={COLORS.error} style={{ marginBottom: 12 }} />
                        <Text style={{ color: COLORS.textPrimary, textAlign: 'center', marginBottom: 16, fontFamily: 'Satoshi-Regular' }}>{loadError}</Text>
                        <TouchableOpacity onPress={() => load()} style={[styles.retryBtn, { backgroundColor: COLORS.primary }]}>
                            <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Réessayer</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                    >
                        <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 16 }]}>
                            Un guichet permet à un caissier d'encaisser vos clients depuis son propre téléphone, avec son propre code PIN, sans accéder au reste de votre compte. Tout encaissement crédite directement votre solde.
                        </Text>

                        <SectionHeading
                            colors={COLORS}
                            title="Nouveau guichet"
                            marginBottom={0}
                            actionIcon={showForm ? 'chevron-up' : 'chevron-down'}
                            onAction={() => setShowForm(!showForm)}
                        />

                        {showForm && (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, marginTop: 12, marginBottom: 8 }]}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Nom du guichet</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                    placeholder="ex : Caisse 1"
                                    placeholderTextColor={COLORS.textSecondary}
                                    value={name}
                                    onChangeText={setName}
                                />
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Téléphone du guichet</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                    placeholder="ex : 077000000"
                                    placeholderTextColor={COLORS.textSecondary}
                                    keyboardType="phone-pad"
                                    value={phone}
                                    onChangeText={setPhone}
                                />
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Code PIN (4 chiffres)</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                    placeholder="⬢⬢⬢⬢"
                                    placeholderTextColor={COLORS.textSecondary}
                                    keyboardType="number-pad"
                                    secureTextEntry
                                    maxLength={4}
                                    value={pin}
                                    onChangeText={setPin}
                                />
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Confirmer le code PIN</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, marginBottom: 4 }]}
                                    placeholder="⬢⬢⬢⬢"
                                    placeholderTextColor={COLORS.textSecondary}
                                    keyboardType="number-pad"
                                    secureTextEntry
                                    maxLength={4}
                                    value={pinConfirm}
                                    onChangeText={setPinConfirm}
                                />

                                <TouchableOpacity
                                    style={[styles.inlineBtnFull, { backgroundColor: COLORS.primary }, creating && styles.disabled]}
                                    onPress={handleCreate}
                                    disabled={creating}
                                >
                                    {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineBtnText}>Créer le guichet</Text>}
                                </TouchableOpacity>
                            </View>
                        )}

                        <SectionHeading colors={COLORS} title={`Guichets (${tills.length})`} marginTop={22} />
                        {tills.length === 0 ? (
                            <Text style={[styles.emptyText, { color: COLORS.textSecondary }]}>Aucun guichet pour l'instant.</Text>
                        ) : (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {tills.map(t => (
                                    <View key={t.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{t.name}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2, fontFamily: 'Satoshi-Regular' }}>{t.phone}</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: (t.isActive ? COLORS.success : COLORS.textSecondary) + '18' }}>
                                                <Text style={{ color: t.isActive ? COLORS.success : COLORS.textSecondary, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>
                                                    {t.isActive ? 'Actif' : 'Inactif'}
                                                </Text>
                                            </View>
                                            {t.isActive && (
                                                <TouchableOpacity
                                                    disabled={deletingId === t.id}
                                                    onPress={() => handleDeactivate(t)}
                                                    style={[styles.smallBtn, { borderColor: COLORS.error }, deletingId === t.id && styles.disabled]}
                                                >
                                                    {deletingId === t.id ? (
                                                        <ActivityIndicator size="small" color={COLORS.error} />
                                                    ) : (
                                                        <Text style={{ color: COLORS.error, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12.5 }}>Désactiver</Text>
                                                    )}
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>
                )}
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },

    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 14, fontFamily: 'Satoshi-Regular' },
    label: { fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8 },
    helper: { fontSize: 12.5, lineHeight: 18, fontFamily: 'Satoshi-Regular' },
    emptyText: { fontSize: 13, fontFamily: 'Satoshi-Regular', marginBottom: 8 },

    smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
    retryBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },

    inlineBtnFull: { marginTop: 6, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    inlineBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 14 },
    disabled: { opacity: 0.5 },
});
