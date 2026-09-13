import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenHeader from '../components/ui/ScreenHeader';
import { useAppTheme } from '../constants/theme';
import { apiGetMerchantAffiliations, apiRespondMerchantAffiliation, MerchantAffiliation } from '../services/api';

// Vue du marchand NORMAL qui reçoit une demande d'affiliation d'un marchand géant (mairie,
// impôts, grande entreprise) — voir MerchantAffiliation (backend/prisma/schema.prisma) et
// merchant-hub.tsx (point d'entrée "Demandes d'affiliation"). Le consentement est explicite :
// le lien reste PENDING tant que ce marchand n'a pas répondu ici, et seules les lignes
// ACCEPTED comptent dans les rapports de conformité du géant — accepter ne donne au géant
// AUCUN accès au solde ni aux fonds de ce marchand, uniquement un suivi de régularité.
const STATUS_LABELS: Record<string, string> = { PENDING: 'En attente', ACCEPTED: 'Acceptée', REJECTED: 'Refusée', REVOKED: 'Révoquée' };

function StatusPill({ status, colors }: { status: string; colors: ReturnType<typeof useAppTheme> }) {
    const map: Record<string, string> = { PENDING: colors.warning, ACCEPTED: colors.success, REJECTED: colors.error, REVOKED: colors.textSecondary };
    const color = map[status] || colors.textSecondary;
    return (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: color + '18' }}>
            <Text style={{ color, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{STATUS_LABELS[status] || status}</Text>
        </View>
    );
}

const COMPLIANCE_LABELS: Record<string, string> = { OK: 'À jour', LATE: 'En retard' };

// Badge distinct de StatusPill (statuts PENDING/ACCEPTED/REJECTED/REVOKED de l'affiliation
// elle-même) : celui-ci reflète la régularité des versements une fois l'affiliation ACCEPTED
// (voir complianceStatus, calculé côté serveur à partir de expectedFrequency — MerchantAffiliation,
// backend/prisma/schema.prisma). Logique dupliquée à l'identique de StatusPill plutôt que
// généralisée : les deux jeux de statuts (cycle de vie du lien vs conformité des versements)
// n'ont aucune valeur en commun et divergeraient au premier changement de l'un ou l'autre.
function ComplianceBadge({ status, colors }: { status: 'OK' | 'LATE'; colors: ReturnType<typeof useAppTheme> }) {
    const color = status === 'OK' ? colors.success : colors.warning;
    return (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: color + '18', marginLeft: 6 }}>
            <Text style={{ color, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{COMPLIANCE_LABELS[status] || status}</Text>
        </View>
    );
}

export default function MerchantAffiliationsScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [affiliations, setAffiliations] = useState<MerchantAffiliation[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    // Distinct de `affiliations.length === 0` : un marchand qui n'a VRAIMENT reçu aucune
    // demande et un échec réseau/serveur rendraient sinon le même écran "Aucune demande" —
    // voir family-detail.tsx (txLoadFailed) pour le même correctif, déjà appliqué ailleurs
    // cette session : pas de .catch(() => []) qui masquerait silencieusement une erreur.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [respondingId, setRespondingId] = useState<string | null>(null);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetMerchantAffiliations();
            setAffiliations(res || []);
            setLoadError(null);
        } catch (e: any) {
            setLoadError(e.response?.data?.error || e.message || "Impossible de charger vos demandes d'affiliation.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleRespond = (id: string, accept: boolean) => {
        // Fréquence fixée par le géant à la création de l'affiliation (expectedFrequency,
        // MerchantAffiliation — backend/prisma/schema.prisma) : affichée avant acceptation
        // pour que ce marchand sache à quel rythme de versement il s'engage. Absente pour un
        // refus (sans objet) ou si le géant n'en a précisé aucune.
        const affiliation = affiliations.find(a => a.id === id);
        const frequencyLine = accept && affiliation?.expectedFrequency === 'MONTHLY'
            ? "\n\nFréquence de versement attendue : mensuelle"
            : accept && affiliation?.expectedFrequency === 'WEEKLY'
                ? "\n\nFréquence de versement attendue : hebdomadaire"
                : '';
        Alert.alert(
            accept ? "Accepter cette affiliation ?" : "Refuser cette affiliation ?",
            (accept
                ? "Ce marchand géant pourra suivre la régularité de vos versements. Il n'obtient aucun accès à votre solde ni à vos fonds."
                : "Vous pouvez refuser cette demande sans aucune conséquence sur votre compte.") + frequencyLine,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: accept ? 'Accepter' : 'Refuser',
                    style: accept ? 'default' : 'destructive',
                    onPress: async () => {
                        setRespondingId(id);
                        try {
                            await apiRespondMerchantAffiliation(id, accept);
                            await load();
                        } catch (e: any) {
                            Alert.alert('Erreur', e.response?.data?.error || e.message || 'Action impossible.');
                        } finally {
                            setRespondingId(null);
                        }
                    },
                },
            ]
        );
    };

    const pending = affiliations.filter(a => a.status === 'PENDING');
    const resolved = affiliations.filter(a => a.status !== 'PENDING');

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title="Demandes d'affiliation" onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
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
                        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                    >
                        <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 20 }]}>
                            Un marchand géant (mairie, impôts, grande entreprise) souhaite suivre la régularité de vos versements. Cette affiliation ne lui donne aucun accès à votre solde ni à vos fonds.
                        </Text>

                        <Text style={styles.sectionTitle}>En attente ({pending.length})</Text>
                        {pending.length === 0 ? (
                            <Text style={styles.emptyText}>Aucune demande en attente.</Text>
                        ) : (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6, marginBottom: 8 }]}>
                                {pending.map(a => (
                                    <View key={a.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{a.giant.name}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2, fontFamily: 'Satoshi-Regular' }}>
                                                {new Date(a.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', gap: 8 }}>
                                            <TouchableOpacity
                                                disabled={respondingId === a.id}
                                                onPress={() => handleRespond(a.id, false)}
                                                style={[styles.smallBtn, { borderColor: COLORS.error }, respondingId === a.id && styles.disabled]}
                                            >
                                                <Text style={{ color: COLORS.error, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12.5 }}>Refuser</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                disabled={respondingId === a.id}
                                                onPress={() => handleRespond(a.id, true)}
                                                style={[styles.smallBtn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, respondingId === a.id && styles.disabled]}
                                            >
                                                {respondingId === a.id ? (
                                                    <ActivityIndicator size="small" color="#fff" />
                                                ) : (
                                                    <Text style={{ color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 12.5 }}>Accepter</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}

                        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Historique</Text>
                        {resolved.length === 0 ? (
                            <Text style={styles.emptyText}>Aucune affiliation traitée pour l'instant.</Text>
                        ) : (
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {resolved.map(a => (
                                    <View key={a.id} style={[styles.row, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>{a.giant.name}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2, fontFamily: 'Satoshi-Regular' }}>
                                                {new Date(a.respondedAt || a.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <StatusPill status={a.status} colors={COLORS} />
                                            {a.status === 'ACCEPTED' && a.complianceStatus && (
                                                <ComplianceBadge status={a.complianceStatus} colors={COLORS} />
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>
                )}
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    scrollContent: { padding: 20, paddingBottom: 40 },
    sectionTitle: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 12 },
    emptyText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: 'Satoshi-Regular', marginBottom: 8 },
    helper: { fontSize: 12.5, lineHeight: 18, fontFamily: 'Satoshi-Regular' },
    card: { borderRadius: 16, borderWidth: 1 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },
    retryBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12 },
    smallBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
    disabled: { opacity: 0.5 },
});
