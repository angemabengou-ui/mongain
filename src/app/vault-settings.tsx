import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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
import { apiGetVaultDetails, apiUpdateVaultRoles, apiUpdateVaultSettings } from '../services/api';

const ROLE_TOGGLES: { key: 'isAdmin' | 'isInitiator' | 'isValidator' | 'isTreasurer'; label: string }[] = [
    { key: 'isAdmin', label: 'Président' },
    { key: 'isInitiator', label: 'Secrétaire' },
    { key: 'isValidator', label: 'Commissaire' },
    { key: 'isTreasurer', label: 'Trésorier' },
];

// Réglages avancés qu'on touche rarement, une fois la caisse en place — extraits de
// vault-detail.tsx pour que l'écran principal reste concentré sur ce qu'on fait souvent
// (déposer, demander/approuver un retrait, voir qui est dans la caisse). Accessible
// uniquement au Président via l'icône engrenage.
export default function VaultSettingsScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [vault, setVault] = useState<any>(null);
    const [myRole, setMyRole] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const [thresholdLoading, setThresholdLoading] = useState(false);
    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [roleUpdateLoading, setRoleUpdateLoading] = useState<string | null>(null);

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [savingInfo, setSavingInfo] = useState(false);

    const load = useCallback(async () => {
        if (!id) return;
        try {
            const res = await apiGetVaultDetails(id);
            if (res.success) {
                setVault(res.data);
                setMyRole(res.role);
                setName(res.data.name);
                setDescription(res.data.description || '');
            }
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger les réglages.');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const validatorCount = (vault?.members || []).filter((m: any) => m.isValidator).length;

    const handleSaveInfo = async () => {
        if (!name.trim()) {
            Alert.alert('Nom requis', 'Le nom de la caisse ne peut pas être vide.');
            return;
        }
        setSavingInfo(true);
        try {
            await apiUpdateVaultSettings(id, { name: name.trim(), description: description.trim() });
            Alert.alert('Enregistré', 'Les informations de la caisse ont été mises à jour.');
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible d\'enregistrer.');
        } finally {
            setSavingInfo(false);
        }
    };

    const adjustThreshold = async (delta: number) => {
        if (!vault) return;
        const next = vault.requiredApprovals + delta;
        if (next < 1) return;
        setThresholdLoading(true);
        try {
            await apiUpdateVaultSettings(id, { requiredApprovals: next });
            setVault({ ...vault, requiredApprovals: next });
        } catch (e: any) {
            Alert.alert('Échec', e.message || "Impossible d'ajuster le seuil.");
        } finally {
            setThresholdLoading(false);
        }
    };

    const handleToggleRole = async (member: any, key: 'isAdmin' | 'isInitiator' | 'isValidator' | 'isTreasurer') => {
        if (member.userId === user?.id && key === 'isAdmin' && member.isAdmin) {
            Alert.alert('Action impossible', 'Vous ne pouvez pas retirer votre propre rôle de Président — désignez d\'abord quelqu\'un d\'autre.');
            return;
        }
        setRoleUpdateLoading(member.id);
        const next = { isAdmin: member.isAdmin, isInitiator: member.isInitiator, isValidator: member.isValidator, isTreasurer: member.isTreasurer };
        next[key] = !next[key];
        try {
            await apiUpdateVaultRoles(id, {
                targetUserId: member.userId,
                ...next,
                isRequiredValidator: member.isRequiredValidator,
            });
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de modifier ce rôle.');
        } finally {
            setRoleUpdateLoading(null);
        }
    };

    const handleToggleRequiredValidator = async (member: any) => {
        setRoleUpdateLoading(member.id);
        try {
            await apiUpdateVaultRoles(id, {
                targetUserId: member.userId,
                isAdmin: member.isAdmin,
                isInitiator: member.isInitiator,
                isValidator: member.isValidator,
                isTreasurer: member.isTreasurer,
                isRequiredValidator: !member.isRequiredValidator,
            });
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || "Impossible de modifier l'obligation de validation.");
        } finally {
            setRoleUpdateLoading(null);
        }
    };

    if (loading || !vault) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    if (!myRole?.isAdmin) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
                <ScreenHeader title="Paramètres" onBack={() => router.back()} />
                <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                    <View style={styles.centerFill}>
                        <Text style={{ color: COLORS.textSecondary, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
                            Seul le Président de la caisse peut accéder à ces réglages.
                        </Text>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader title={`Paramètres — ${vault.name}`} onBack={() => router.back()} />

            <View style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                    <SectionHeading colors={COLORS} title="Informations générales" marginTop={0} />
                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.label, { color: COLORS.textSecondary }]}>Nom de la caisse</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                            value={name}
                            onChangeText={setName}
                            autoCapitalize="sentences"
                        />
                        <Text style={[styles.label, { color: COLORS.textSecondary }]}>Description (optionnel)</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, height: 80, textAlignVertical: 'top', paddingTop: 12, marginBottom: 14 }]}
                            value={description}
                            onChangeText={setDescription}
                            multiline
                        />
                        <TouchableOpacity
                            style={[styles.saveBtn, { backgroundColor: COLORS.primary }, savingInfo && styles.disabled]}
                            onPress={handleSaveInfo}
                            disabled={savingInfo}
                        >
                            {savingInfo ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}
                        </TouchableOpacity>
                    </View>

                    <SectionHeading colors={COLORS} title="Seuil d'approbation" />
                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 14 }]}>
                            Combien de commissaires doivent approuver un retrait avant qu'il ne soit exécuté.
                        </Text>
                        <View style={styles.stepperRow}>
                            <TouchableOpacity
                                style={[styles.stepperBtn, { borderColor: COLORS.border }, (thresholdLoading || vault.requiredApprovals <= 1) && styles.disabled]}
                                onPress={() => adjustThreshold(-1)}
                                disabled={thresholdLoading || vault.requiredApprovals <= 1}
                            >
                                <Ionicons name="remove" size={20} color={COLORS.textPrimary} />
                            </TouchableOpacity>
                            <View style={styles.stepperValue}>
                                {thresholdLoading ? <ActivityIndicator color={COLORS.primary} /> : <Text style={{ color: COLORS.textPrimary, fontSize: 22, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' }}>{vault.requiredApprovals}</Text>}
                            </View>
                            <TouchableOpacity
                                style={[styles.stepperBtn, { borderColor: COLORS.border }, thresholdLoading && styles.disabled]}
                                onPress={() => adjustThreshold(1)}
                                disabled={thresholdLoading}
                            >
                                <Ionicons name="add" size={20} color={COLORS.textPrimary} />
                            </TouchableOpacity>
                        </View>
                        <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 12 }]}>
                            {validatorCount} commissaire{validatorCount > 1 ? 's' : ''} désigné{validatorCount > 1 ? 's' : ''} dans cette caisse.
                            {vault.requiredApprovals > validatorCount ? ' Le seuil actuel dépasse ce nombre : aucun retrait ne pourra aboutir tant que vous ne réduirez pas le seuil ou n\'ajouterez pas de commissaires.' : ''}
                        </Text>
                    </View>

                    <SectionHeading colors={COLORS} title={`Rôles des membres (${vault.members.length})`} />
                    <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 12 }]}>
                        Touchez un membre pour changer ses rôles.
                    </Text>

                    <View style={{ gap: 10 }}>
                        {vault.members.map((m: any) => {
                            const isOpen = editingMemberId === m.id;
                            const isBusy = roleUpdateLoading === m.id;
                            return (
                                <View key={m.id} style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 0 }]}>
                                    <TouchableOpacity
                                        style={styles.memberHeader}
                                        onPress={() => setEditingMemberId(isOpen ? null : m.id)}
                                        activeOpacity={0.7}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' }}>
                                                {m.user.name}{m.userId === user?.id ? ' (Vous)' : ''}
                                            </Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{m.user.phone}</Text>
                                        </View>
                                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={COLORS.textSecondary} />
                                    </TouchableOpacity>

                                    {isOpen && (
                                        <View style={[styles.memberEditPanel, { borderColor: COLORS.border }]}>
                                            {isBusy && <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 10 }} />}
                                            <View style={styles.chipRow}>
                                                {ROLE_TOGGLES.map((rt) => {
                                                    const active = !!m[rt.key];
                                                    return (
                                                        <TouchableOpacity
                                                            key={rt.key}
                                                            style={[
                                                                styles.chip,
                                                                { borderColor: active ? COLORS.primary : COLORS.border },
                                                                active && { backgroundColor: COLORS.primary + '15' },
                                                            ]}
                                                            onPress={() => handleToggleRole(m, rt.key)}
                                                            disabled={isBusy}
                                                        >
                                                            <Text style={{ color: active ? COLORS.primary : COLORS.textSecondary, fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>{rt.label}</Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>

                                            {m.isValidator && (
                                                <View style={styles.requiredRow}>
                                                    <Text style={{ color: COLORS.textPrimary, fontSize: 13, flex: 1 }}>Validation obligatoire pour tout retrait</Text>
                                                    <Switch
                                                        value={!!m.isRequiredValidator}
                                                        onValueChange={() => handleToggleRequiredValidator(m)}
                                                        disabled={isBusy}
                                                        trackColor={{ false: COLORS.border, true: COLORS.primary + '80' }}
                                                        thumbColor={m.isRequiredValidator ? COLORS.primary : '#f4f3f4'}
                                                    />
                                                </View>
                                            )}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10 },
    helper: { fontSize: 12.5, lineHeight: 18 },
    disabled: { opacity: 0.4 },

    label: { fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', marginBottom: 8 },
    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 16 },
    saveBtn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
    saveBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 14 },

    stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
    stepperBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
    stepperValue: { minWidth: 60, alignItems: 'center' },

    memberHeader: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    memberEditPanel: { borderTopWidth: 1, padding: 14, paddingTop: 12 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
    requiredRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.2)' },
});

