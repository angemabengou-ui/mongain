import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
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
import { apiGenerateGatewayKey, apiGetGatewayKeys, apiRotateGatewayKey, apiUpdateGatewayKey, ApiIntegration } from '../services/api';

// Mongain Connect (clés API / webhooks marchand) — self-service : un marchand normal peut
// brancher son propre site web à Mongain (ex : recevoir automatiquement la confirmation d'un
// paiement) sans intervention du staff. `secret`/`webhookSigningSecret` ne sont renvoyés
// qu'UNE SEULE FOIS par le serveur (génération ou rotation, voir apiGenerateGatewayKey/
// apiRotateGatewayKey, services/api.ts) — au-delà de cet appel, seul un hash est conservé
// côté serveur, ils redeviennent irrécupérables. `revealed` ci-dessous porte cette valeur
// UNIQUEMENT en mémoire locale (jamais persistée) le temps que le marchand la copie.
export default function MerchantApiKeysScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [integrations, setIntegrations] = useState<ApiIntegration[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // Distinct de integrations.length === 0 : voir merchant-tills.tsx (loadError), même
    // correctif — un marchand sans AUCUNE intégration et un échec réseau afficheraient sinon
    // le même écran "Aucune intégration", sans que l'un ou l'autre ne soit distinguable.
    const [loadError, setLoadError] = useState<string | null>(null);

    const [showForm, setShowForm] = useState(false);
    const [appName, setAppName] = useState('');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [creating, setCreating] = useState(false);

    const [revealed, setRevealed] = useState<{ secret: string; webhookSigningSecret: string } | null>(null);
    const [rotatingId, setRotatingId] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetGatewayKeys();
            setIntegrations(res || []);
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e.response?.data?.error || e.message || 'Impossible de charger vos intégrations.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const resetForm = () => {
        setAppName('');
        setWebhookUrl('');
    };

    const handleCreate = async () => {
        const trimmedName = appName.trim();
        if (!trimmedName) {
            Alert.alert('Nom requis', 'Indiquez un nom pour identifier cette intégration (ex : "Mon site web").');
            return;
        }
        setCreating(true);
        try {
            const res = await apiGenerateGatewayKey(trimmedName, webhookUrl.trim() || undefined);
            resetForm();
            setShowForm(false);
            setRevealed({ secret: res.secret, webhookSigningSecret: res.webhookSigningSecret });
            load();
        } catch (e: any) {
            Alert.alert('Échec de la création', e.response?.data?.error || e.message || 'Une erreur est survenue.');
        } finally {
            setCreating(false);
        }
    };

    const handleRotate = (integration: ApiIntegration) => {
        Alert.alert(
            'Régénérer les clés ?',
            `L'ancien secret de "${integration.appName}" cessera immédiatement de fonctionner. Toute intégration déjà branchée devra être mise à jour avec les nouvelles clés.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Régénérer',
                    style: 'destructive',
                    onPress: async () => {
                        setRotatingId(integration.id);
                        try {
                            const res = await apiRotateGatewayKey(integration.id);
                            setRevealed({ secret: res.secret, webhookSigningSecret: res.webhookSigningSecret });
                        } catch (e: any) {
                            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Action impossible.');
                        } finally {
                            setRotatingId(null);
                        }
                    },
                },
            ]
        );
    };

    const handleToggleActive = async (integration: ApiIntegration) => {
        setTogglingId(integration.id);
        try {
            await apiUpdateGatewayKey(integration.id, { isActive: !integration.isActive });
            load();
        } catch (e: any) {
            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Action impossible.');
        } finally {
            setTogglingId(null);
        }
    };

    const copyToClipboard = async (label: string, value: string) => {
        await Clipboard.setStringAsync(value);
        Alert.alert('Copié', `${label} copié dans le presse-papiers.`);
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Intégration API" onBack={() => router.back()} />

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
                            Permet à votre site web de recevoir automatiquement une confirmation quand un client vous paie.
                        </Text>

                        {revealed && (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.warning, borderWidth: 2, marginBottom: 20 }]}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <Ionicons name="warning" size={20} color={COLORS.warning} />
                                    <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', flex: 1 }}>
                                        À copier maintenant : ne sera plus jamais affiché
                                    </Text>
                                </View>

                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Clé secrète</Text>
                                <View style={[styles.secretRow, { borderColor: COLORS.border }]}>
                                    <Text style={[styles.secretText, { color: COLORS.textPrimary }]} numberOfLines={1}>{revealed.secret}</Text>
                                    <TouchableOpacity onPress={() => copyToClipboard('La clé secrète', revealed.secret)} accessibilityLabel="Copier la clé secrète">
                                        <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
                                    </TouchableOpacity>
                                </View>

                                <Text style={[styles.label, { color: COLORS.textSecondary, marginTop: 12 }]}>Secret de signature webhook</Text>
                                <View style={[styles.secretRow, { borderColor: COLORS.border }]}>
                                    <Text style={[styles.secretText, { color: COLORS.textPrimary }]} numberOfLines={1}>{revealed.webhookSigningSecret}</Text>
                                    <TouchableOpacity onPress={() => copyToClipboard('Le secret de signature', revealed.webhookSigningSecret)} accessibilityLabel="Copier le secret de signature webhook">
                                        <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
                                    </TouchableOpacity>
                                </View>

                                <TouchableOpacity
                                    style={[styles.inlineBtnFull, { backgroundColor: COLORS.primary, marginTop: 16 }]}
                                    onPress={() => setRevealed(null)}
                                >
                                    <Text style={styles.inlineBtnText}>J'ai copié mes clés</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <SectionHeading
                            colors={COLORS}
                            title="Nouvelle intégration"
                            marginBottom={0}
                            actionIcon={showForm ? 'chevron-up' : 'chevron-down'}
                            onAction={() => setShowForm(!showForm)}
                        />

                        {showForm && (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, marginTop: 12, marginBottom: 8 }]}>
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>Nom de l'application</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                    placeholder="ex : Mon site web"
                                    placeholderTextColor={COLORS.textSecondary}
                                    value={appName}
                                    onChangeText={setAppName}
                                />
                                <Text style={[styles.label, { color: COLORS.textSecondary }]}>URL du webhook (optionnel)</Text>
                                <TextInput
                                    style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, marginBottom: 4 }]}
                                    placeholder="https://monsite.com/webhooks/mongain"
                                    placeholderTextColor={COLORS.textSecondary}
                                    autoCapitalize="none"
                                    keyboardType="url"
                                    value={webhookUrl}
                                    onChangeText={setWebhookUrl}
                                />

                                <TouchableOpacity
                                    style={[styles.inlineBtnFull, { backgroundColor: COLORS.primary }, creating && styles.disabled]}
                                    onPress={handleCreate}
                                    disabled={creating}
                                >
                                    {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineBtnText}>Créer l'intégration</Text>}
                                </TouchableOpacity>
                            </View>
                        )}

                        <SectionHeading colors={COLORS} title={`Intégrations (${integrations.length})`} marginTop={22} />
                        {integrations.length === 0 ? (
                            <Text style={[styles.emptyText, { color: COLORS.textSecondary }]}>Aucune intégration pour l'instant.</Text>
                        ) : (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {integrations.map(it => (
                                    <View key={it.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1, marginRight: 8 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{it.appName}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2, fontFamily: 'Satoshi-Regular' }} numberOfLines={1}>
                                                {it.webhookUrl || 'Aucune URL de webhook'}
                                            </Text>
                                            {/* Raccourci d'affichage best-effort — voir ApiIntegration.recentDeliveriesCount,
                                                services/api.ts : masqué (pas de faux "0") tant que le serveur ne l'inclut pas. */}
                                            {typeof it.recentDeliveriesCount === 'number' && (
                                                <Text style={{ color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2, fontFamily: 'Satoshi-Regular' }}>
                                                    {it.recentDeliveriesCount} livraison{it.recentDeliveriesCount === 1 ? '' : 's'} récente{it.recentDeliveriesCount === 1 ? '' : 's'}
                                                </Text>
                                            )}
                                            <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
                                                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: (it.isActive ? COLORS.success : COLORS.textSecondary) + '18' }}>
                                                    <Text style={{ color: it.isActive ? COLORS.success : COLORS.textSecondary, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>
                                                        {it.isActive ? 'Actif' : 'Inactif'}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                        <View style={{ alignItems: 'flex-end', gap: 8 }}>
                                            <TouchableOpacity
                                                disabled={togglingId === it.id}
                                                onPress={() => handleToggleActive(it)}
                                                style={[styles.smallBtn, { borderColor: COLORS.border }, togglingId === it.id && styles.disabled]}
                                            >
                                                {togglingId === it.id ? (
                                                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                                                ) : (
                                                    <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12 }}>
                                                        {it.isActive ? 'Désactiver' : 'Activer'}
                                                    </Text>
                                                )}
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                disabled={rotatingId === it.id}
                                                onPress={() => handleRotate(it)}
                                                style={[styles.smallBtn, { borderColor: COLORS.error }, rotatingId === it.id && styles.disabled]}
                                            >
                                                {rotatingId === it.id ? (
                                                    <ActivityIndicator size="small" color={COLORS.error} />
                                                ) : (
                                                    <Text style={{ color: COLORS.error, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12 }}>Régénérer</Text>
                                                )}
                                            </TouchableOpacity>
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
    row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },

    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 14, fontFamily: 'Satoshi-Regular' },
    label: { fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 8 },
    helper: { fontSize: 12.5, lineHeight: 18, fontFamily: 'Satoshi-Regular' },
    emptyText: { fontSize: 13, fontFamily: 'Satoshi-Regular', marginBottom: 8 },

    secretRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, gap: 10 },
    secretText: { flex: 1, fontSize: 13, fontFamily: 'Satoshi-Regular' },

    smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
    retryBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },

    inlineBtnFull: { marginTop: 6, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    inlineBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 14 },
    disabled: { opacity: 0.5 },
});
