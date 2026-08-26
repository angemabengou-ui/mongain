import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import BalanceCard from '../components/ui/BalanceCard';
import InlineInviteForm from '../components/ui/InlineInviteForm';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
    apiApproveVault,
    apiDepositVault,
    apiGetMyVouchers,
    apiGetVaultDetails,
    apiInviteVault,
    apiLeaveVault,
    apiLookupUser,
    apiUpdateVaultRoles,
    apiUpdateVaultSettings,
    apiWithdrawRequestVault,
} from '../services/api';

// Un membre peut cumuler plusieurs rôles (le Président a les quatre par défaut à
// la création) — chaque bascule est indépendante des autres. Commissaire (isValidator)
// se gère depuis la carte « Approbations requises » ci-dessous, à côté du nombre requis,
// pas ici — les deux réglages sont liés et doivent rester visibles ensemble.
const ROLE_TOGGLES: { key: 'isAdmin' | 'isInitiator' | 'isTreasurer'; label: string }[] = [
    { key: 'isAdmin', label: 'Président' },
    { key: 'isInitiator', label: 'Secrétaire' },
    { key: 'isTreasurer', label: 'Trésorier' },
];

// Rôles applicatifs (isAdmin/isInitiator/isValidator/isTreasurer) inchangés côté
// backend — seuls les libellés changent, pour parler le vocabulaire d'un bureau
// d'association gabonais plutôt que des noms de champs techniques.
function roleBadges(m: any) {
    const badges = [];
    if (m.isAdmin) badges.push('Président');
    if (m.isInitiator) badges.push('Secrétaire');
    if (m.isValidator) badges.push('Commissaire');
    if (m.isTreasurer) badges.push('Trésorier');
    return badges;
}

export default function VaultDetailScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [vault, setVault] = useState<any>(null);
    const [myRole, setMyRole] = useState<any>(null);
    const [myVouchers, setMyVouchers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [depositAmount, setDepositAmount] = useState('');
    const [depositLoading, setDepositLoading] = useState(false);

    const [showWithdrawForm, setShowWithdrawForm] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    // TRANSFER — envoi direct à n'importe quel numéro Mongain — est le cas le
    // plus courant en pratique (payer un prestataire, un fournisseur), d'où le
    // choix par défaut.
    const [withdrawDest, setWithdrawDest] = useState<'TRANSFER' | 'TREASURER' | 'VOUCHER'>('TRANSFER');
    const [selectedTreasurerId, setSelectedTreasurerId] = useState<string | null>(null);
    const [transferPhone, setTransferPhone] = useState('');
    const [transferRecipient, setTransferRecipient] = useState<{ name: string; phone: string } | null>(null);
    const [transferLookupLoading, setTransferLookupLoading] = useState(false);
    const [withdrawReason, setWithdrawReason] = useState('');
    const [withdrawLoading, setWithdrawLoading] = useState(false);

    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [roleUpdateLoading, setRoleUpdateLoading] = useState(false);

    const [showInviteForm, setShowInviteForm] = useState(false);

    const [thresholdLoading, setThresholdLoading] = useState(false);

    // Vérifie le numéro saisi et affiche le nom du destinataire avant l'envoi —
    // même logique de confiance que src/app/transfer.tsx pour un transfert P2P
    // classique. Anti-rebond léger pour ne pas interroger le serveur à chaque
    // frappe.
    useEffect(() => {
        setTransferRecipient(null);
        const digits = transferPhone.replace(/\s/g, '');
        if (digits.length < 8) return;
        const handle = setTimeout(async () => {
            setTransferLookupLoading(true);
            try {
                const formatted = digits.startsWith('+') ? digits : `+241${digits.startsWith('0') ? digits.substring(1) : digits}`;
                const found = await apiLookupUser(formatted);
                setTransferRecipient({ name: found.name, phone: formatted });
            } catch {
                setTransferRecipient(null);
            } finally {
                setTransferLookupLoading(false);
            }
        }, 400);
        return () => clearTimeout(handle);
    }, [transferPhone]);

    const load = useCallback(async (isRefresh = false) => {
        if (!id) return;
        if (isRefresh) setRefreshing(true);
        try {
            const [detailRes, vouchersRes] = await Promise.all([
                apiGetVaultDetails(id),
                apiGetMyVouchers().catch(() => ({ data: [] })),
            ]);
            if (detailRes.success) {
                setVault(detailRes.data);
                setMyRole(detailRes.role);
            }
            setMyVouchers((vouchersRes.data || []).filter((v: any) => v.vaultId === id));
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger la caisse.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    // Refs synchrones anti double-tap (voir transfer-confirm.tsx pour le détail) : deux appuis
    // rapides peuvent tous deux lire `depositLoading`/`withdrawLoading` avant que le premier
    // `setLoading(true)` n'ait été commité par React — le backend n'étant pas idempotent sur
    // ces deux actions, un double-tap pouvait produire un double dépôt/double demande.
    const depositSubmittingRef = useRef(false);
    const withdrawSubmittingRef = useRef(false);

    const handleDeposit = async () => {
        if (depositSubmittingRef.current) return;
        const amt = depositAmount.replace(/\s/g, '').replace(',', '.');
        if (!amt || Number(amt) <= 0) return;
        depositSubmittingRef.current = true;
        setDepositLoading(true);
        try {
            await apiDepositVault(id, amt);
            setDepositAmount('');
            load();
        } catch (e: any) {
            Alert.alert('Échec du dépôt', e.message || 'Une erreur est survenue.');
        } finally {
            depositSubmittingRef.current = false;
            setDepositLoading(false);
        }
    };

    const treasurers = (vault?.members || []).filter((m: any) => m.isTreasurer);

    const handleWithdrawRequest = async () => {
        if (withdrawSubmittingRef.current) return;
        const amt = withdrawAmount.replace(/\s/g, '').replace(',', '.');
        if (!amt || Number(amt) <= 0) return;
        if (!withdrawReason.trim() || withdrawReason.trim().length < 3) {
            Alert.alert('Motif requis', 'Précisez pourquoi ce retrait est demandé (au moins 3 caractères) — les commissaires en ont besoin pour approuver en connaissance de cause.');
            return;
        }
        if (withdrawDest === 'TREASURER' && !selectedTreasurerId) {
            Alert.alert('Trésorier requis', 'Choisissez le trésorier qui recevra les fonds.');
            return;
        }
        if (withdrawDest === 'TRANSFER' && !transferRecipient) {
            Alert.alert('Destinataire introuvable', 'Saisissez un numéro Mongain valide pour l\'envoi direct.');
            return;
        }
        withdrawSubmittingRef.current = true;
        setWithdrawLoading(true);
        try {
            await apiWithdrawRequestVault(id, {
                amount: amt,
                destinationType: withdrawDest,
                destinationId: withdrawDest === 'TREASURER' ? selectedTreasurerId! : undefined,
                destinationPhone: withdrawDest === 'TRANSFER' ? transferRecipient!.phone : undefined,
                reason: withdrawReason.trim(),
            });
            setWithdrawAmount('');
            setWithdrawReason('');
            setTransferPhone('');
            setTransferRecipient(null);
            setShowWithdrawForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de la demande', e.message || 'Une erreur est survenue.');
        } finally {
            withdrawSubmittingRef.current = false;
            setWithdrawLoading(false);
        }
    };

    const handleToggleRole = async (member: any, key: 'isAdmin' | 'isInitiator' | 'isValidator' | 'isTreasurer' | 'isRequiredValidator') => {
        setRoleUpdateLoading(true);
        try {
            await apiUpdateVaultRoles(id, {
                targetUserId: member.userId,
                isAdmin: key === 'isAdmin' ? !member.isAdmin : !!member.isAdmin,
                isInitiator: key === 'isInitiator' ? !member.isInitiator : !!member.isInitiator,
                isValidator: key === 'isValidator' ? !member.isValidator : !!member.isValidator,
                isTreasurer: key === 'isTreasurer' ? !member.isTreasurer : !!member.isTreasurer,
                isRequiredValidator: key === 'isRequiredValidator' ? !member.isRequiredValidator : !!member.isRequiredValidator,
            });
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de modifier ce rôle.');
        } finally {
            setRoleUpdateLoading(false);
        }
    };

    const handleInvite = async (formattedPhone: string) => {
        try {
            await apiInviteVault(id, formattedPhone);
            setShowInviteForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de l\'invitation', e.message || 'Une erreur est survenue.');
        }
    };

    const handleApprove = async (txId: string) => {
        try {
            const res = await apiApproveVault(id, txId);
            Alert.alert(res.data?.executed ? 'Retrait exécuté' : 'Approuvé', res.message);
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible d\'approuver.');
        }
    };

    const handleLeave = () => {
        Alert.alert(
            'Quitter la caisse',
            `Voulez-vous vraiment quitter « ${vault.name} » ?`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Quitter', style: 'destructive', onPress: async () => {
                        try {
                            await apiLeaveVault(id);
                            router.back();
                        } catch (e: any) {
                            Alert.alert('Impossible de quitter', e.message || 'Une erreur est survenue.');
                        }
                    }
                },
            ]
        );
    };

    const adjustThreshold = async (delta: number) => {
        const next = Math.max(1, (vault?.requiredApprovals || 1) + delta);
        setThresholdLoading(true);
        try {
            await apiUpdateVaultSettings(id, { requiredApprovals: next });
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de modifier le seuil.');
        } finally {
            setThresholdLoading(false);
        }
    };

    if (loading || !vault) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    const pendingTx = vault.transactions.filter((t: any) => t.status === 'PENDING');
    const historyTx = vault.transactions.filter((t: any) => t.status !== 'PENDING');

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]}>
            <ScreenHeader title={vault.name} onBack={() => router.back()} />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                >

                    <BalanceCard colors={COLORS} label="Solde de la caisse" amount={`${vault.balance.toLocaleString('fr-FR')} FCFA`} description={vault.description || undefined} />

                    {/* Dépôt */}
                    <SectionHeading colors={COLORS} title="Déposer" />
                    <View style={[styles.inlineForm, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                        <TextInput
                            style={[styles.inlineInput, { color: COLORS.textPrimary }]}
                            placeholder="Montant en FCFA"
                            placeholderTextColor={COLORS.textSecondary}
                            keyboardType="numeric"
                            value={depositAmount}
                            onChangeText={setDepositAmount}
                        />
                        <TouchableOpacity
                            style={[styles.inlineBtn, { backgroundColor: COLORS.primary }, (!depositAmount || depositLoading) && styles.disabled]}
                            onPress={handleDeposit}
                            disabled={!depositAmount || depositLoading}
                        >
                            {depositLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.inlineBtnText}>Déposer</Text>}
                        </TouchableOpacity>
                    </View>

                    {/* Demande de retrait */}
                    {myRole?.isInitiator && (
                        <>
                            <SectionHeading
                                colors={COLORS}
                                title="Demander un retrait"
                                marginTop={22}
                                marginBottom={0}
                                actionIcon={showWithdrawForm ? 'chevron-up' : 'chevron-down'}
                                onAction={() => setShowWithdrawForm(!showWithdrawForm)}
                            />

                            {showWithdrawForm && (
                                <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                                        placeholder="Montant en FCFA"
                                        placeholderTextColor={COLORS.textSecondary}
                                        keyboardType="numeric"
                                        value={withdrawAmount}
                                        onChangeText={setWithdrawAmount}
                                    />

                                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Destination</Text>
                                    <View style={styles.toggleRow}>
                                        <TouchableOpacity
                                            style={[styles.toggleBtn, { borderColor: COLORS.border }, withdrawDest === 'TRANSFER' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                            onPress={() => setWithdrawDest('TRANSFER')}
                                        >
                                            <Text style={[styles.toggleText, { color: withdrawDest === 'TRANSFER' ? COLORS.primary : COLORS.textSecondary }]}>Envoi direct</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.toggleBtn, { borderColor: COLORS.border }, withdrawDest === 'TREASURER' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                            onPress={() => setWithdrawDest('TREASURER')}
                                        >
                                            <Text style={[styles.toggleText, { color: withdrawDest === 'TREASURER' ? COLORS.primary : COLORS.textSecondary }]}>Trésorier</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.toggleBtn, { borderColor: COLORS.border }, withdrawDest === 'VOUCHER' && { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary }]}
                                            onPress={() => setWithdrawDest('VOUCHER')}
                                        >
                                            <Text style={[styles.toggleText, { color: withdrawDest === 'VOUCHER' ? COLORS.primary : COLORS.textSecondary }]}>Bon</Text>
                                        </TouchableOpacity>
                                    </View>

                                    {withdrawDest === 'TRANSFER' && (
                                        <View style={{ marginBottom: 4 }}>
                                            <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderColor: COLORS.border }]}>
                                                <TextInput
                                                    style={{ flex: 1, color: COLORS.textPrimary, fontSize: 15 }}
                                                    placeholder="Numéro du destinataire (ex : 074...)"
                                                    placeholderTextColor={COLORS.textSecondary}
                                                    keyboardType="phone-pad"
                                                    value={transferPhone}
                                                    onChangeText={setTransferPhone}
                                                />
                                                {transferLookupLoading && <ActivityIndicator size="small" color={COLORS.primary} />}
                                            </View>
                                            {transferRecipient ? (
                                                <View style={styles.recipientFound}>
                                                    <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                                                    <Text style={{ color: COLORS.success, fontSize: 13, fontWeight: '600', marginLeft: 6 }}>{transferRecipient.name}</Text>
                                                </View>
                                            ) : transferPhone.replace(/\s/g, '').length >= 8 && !transferLookupLoading ? (
                                                <Text style={[styles.helper, { color: COLORS.error, marginTop: 6 }]}>Aucun compte Mongain trouvé avec ce numéro.</Text>
                                            ) : (
                                                <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 6 }]}>Le montant sera envoyé directement à ce compte une fois le retrait approuvé.</Text>
                                            )}
                                        </View>
                                    )}

                                    {withdrawDest === 'TREASURER' && (
                                        treasurers.length === 0 ? (
                                            <Text style={[styles.helper, { color: COLORS.textSecondary }]}>Aucun trésorier désigné — attribuez ce rôle à un membre plus bas, ou choisissez « Bon physique ».</Text>
                                        ) : (
                                            <View style={{ gap: 8, marginTop: 4 }}>
                                                {treasurers.map((m: any) => (
                                                    <TouchableOpacity
                                                        key={m.id}
                                                        style={[styles.memberPick, { borderColor: selectedTreasurerId === m.userId ? COLORS.primary : COLORS.border }]}
                                                        onPress={() => setSelectedTreasurerId(m.userId)}
                                                    >
                                                        <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{m.user.name}</Text>
                                                        {selectedTreasurerId === m.userId && <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />}
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )
                                    )}

                                    <Text style={[styles.label, { color: COLORS.textSecondary }]}>Motif du retrait</Text>
                                    <TextInput
                                        style={[styles.input, { color: COLORS.textPrimary, borderColor: COLORS.border, marginBottom: 4 }]}
                                        placeholder="Ex : Acompte traiteur mariage"
                                        placeholderTextColor={COLORS.textSecondary}
                                        value={withdrawReason}
                                        onChangeText={setWithdrawReason}
                                    />
                                    <Text style={[styles.helper, { color: COLORS.textSecondary, marginBottom: 4 }]}>Visible par les commissaires — ils en ont besoin pour juger avant d'approuver.</Text>

                                    <TouchableOpacity
                                        style={[styles.inlineBtnFull, { backgroundColor: COLORS.primary }, (!withdrawAmount || !withdrawReason.trim() || withdrawLoading) && styles.disabled]}
                                        onPress={handleWithdrawRequest}
                                        disabled={!withdrawAmount || !withdrawReason.trim() || withdrawLoading}
                                    >
                                        {withdrawLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineBtnText}>Envoyer la demande</Text>}
                                    </TouchableOpacity>
                                </View>
                            )}
                        </>
                    )}

                    {/* Retraits en attente */}
                    {pendingTx.length > 0 && (
                        <>
                            <SectionHeading colors={COLORS} title="En attente d'approbation" />
                            {pendingTx.map((tx: any) => {
                                // Lire l'instantané figé par le serveur à la création de la demande
                                // (requiredApprovalsSnapshot/requiredValidatorIdsSnapshot,
                                // routes/vault.ts) plutôt que recalculer depuis les membres
                                // ACTUELS de la caisse — sinon un changement de composition après
                                // coup (départ d'un commissaire, ajustement du seuil) affiche un
                                // quorum "atteint" ici alors que le serveur, qui applique le même
                                // instantané, refuse toujours d'exécuter le retrait (ou l'inverse).
                                const required = tx.requiredApprovalsSnapshot ?? Math.max(1, Math.min(vault.requiredApprovals, (vault.members || []).filter((m: any) => m.isValidator).length || 1));
                                const iApproved = tx.approvals.some((a: any) => a.userId === user?.id);
                                const approvedIds = tx.approvals.map((a: any) => a.userId);
                                const missingRequired = tx.requiredValidatorIdsSnapshot
                                    ? (vault.members || []).filter((m: any) => tx.requiredValidatorIdsSnapshot.includes(m.userId) && !approvedIds.includes(m.userId))
                                    : (vault.members || []).filter((m: any) => m.isRequiredValidator && !approvedIds.includes(m.userId));
                                return (
                                    <View key={tx.id} style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                                        <View style={styles.cardRow}>
                                            <View>
                                                <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>{tx.amount.toLocaleString('fr-FR')} FCFA</Text>
                                                <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>Demandé par {tx.requestedBy.name}</Text>
                                            </View>
                                            <Text style={{ color: COLORS.primary, fontWeight: '700', fontSize: 13 }}>{tx.approvals.length}/{required}</Text>
                                        </View>
                                        {tx.reason && (
                                            <Text style={{ color: COLORS.textPrimary, fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>« {tx.reason} »</Text>
                                        )}
                                        {missingRequired.length > 0 && (
                                            <Text style={{ color: COLORS.error, fontSize: 12, marginTop: 8, fontWeight: '600' }}>
                                                En attente de la validation obligatoire de : {missingRequired.map((m: any) => m.user.name).join(', ')}
                                            </Text>
                                        )}
                                        {tx.destinationType === 'TRANSFER' && (
                                            <View style={[styles.transferTag, { backgroundColor: COLORS.error + '15' }]}>
                                                <Ionicons name="arrow-redo-outline" size={13} color={COLORS.error} />
                                                <Text style={{ color: COLORS.error, fontSize: 11.5, fontWeight: '700', marginLeft: 4 }}>Envoi direct vers un tiers</Text>
                                            </View>
                                        )}
                                        {myRole?.isValidator && !iApproved && (
                                            <TouchableOpacity style={[styles.approveBtn, { backgroundColor: COLORS.primary }]} onPress={() => handleApprove(tx.id)}>
                                                <Text style={styles.inlineBtnText}>Approuver</Text>
                                            </TouchableOpacity>
                                        )}
                                        {iApproved && <Text style={{ color: COLORS.success, fontSize: 12.5, marginTop: 8, fontWeight: '600' }}>Vous avez déjà approuvé</Text>}
                                    </View>
                                );
                            })}
                        </>
                    )}

                    {/* Mes bons actifs pour cette caisse — jusqu'ici uniquement visibles/dépensables
                        depuis transfer-confirm.tsx, aucune trace d'eux ici alors qu'ils proviennent
                        justement de cette caisse. */}
                    {myVouchers.length > 0 && (
                        <>
                            <SectionHeading colors={COLORS} title={`Mes bons actifs (${myVouchers.length})`} />
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {myVouchers.map((v: any) => (
                                    <View key={v.id} style={[styles.memberRow, { borderColor: COLORS.border }]}>
                                        <View>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '700' }}>{v.amount.toLocaleString('fr-FR')} FCFA</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                                                Émis le {new Date(v.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </Text>
                                        </View>
                                        <Ionicons name="ticket-outline" size={20} color={COLORS.primary} />
                                    </View>
                                ))}
                            </View>
                            <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 8 }]}>Dépensez un bon depuis un paiement (numéro du marchand + code PIN).</Text>
                        </>
                    )}

                    {/* Seuil d'approbation (Président uniquement) */}
                    {myRole?.isAdmin && (
                        <>
                            <SectionHeading colors={COLORS} title="Approbations requises pour un retrait" />
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                                <View style={styles.cardRow}>
                                    <Text style={{ color: COLORS.textSecondary, flex: 1 }}>Nombre de commissaires devant valider</Text>
                                    <View style={styles.stepperSmall}>
                                        <TouchableOpacity onPress={() => adjustThreshold(-1)} disabled={thresholdLoading}>
                                            <Ionicons name="remove-circle-outline" size={26} color={COLORS.primary} />
                                        </TouchableOpacity>
                                        <Text style={{ color: COLORS.textPrimary, fontWeight: '800', fontSize: 17, marginHorizontal: 12 }}>{vault.requiredApprovals}</Text>
                                        <TouchableOpacity onPress={() => adjustThreshold(1)} disabled={thresholdLoading}>
                                            <Ionicons name="add-circle-outline" size={26} color={COLORS.primary} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 10 }]}>
                                    S'applique à tous les retraits, envois directs compris. 1 : vous pouvez agir seul. 2 ou plus : chaque sortie de fonds attend d'être validée par ce nombre de commissaires avant de partir.
                                </Text>

                                <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 16, marginBottom: 6, fontWeight: '700' }]}>
                                    Qui sont les commissaires (cochez qui peut valider) :
                                </Text>
                                {vault.members.map((m: any, idx: number) => (
                                    <View key={m.id} style={{ borderBottomWidth: idx === vault.members.length - 1 ? 0 : 1, borderColor: COLORS.border }}>
                                        <TouchableOpacity
                                            style={[styles.memberRow, { borderColor: COLORS.border, paddingHorizontal: 0, borderBottomWidth: 0, paddingBottom: m.isValidator ? 4 : 12 }]}
                                            onPress={() => handleToggleRole(m, 'isValidator')}
                                            disabled={roleUpdateLoading}
                                        >
                                            <Text style={{ color: COLORS.textPrimary }}>{m.user.name}{m.userId === user?.id ? ' (Vous)' : ''}</Text>
                                            <Ionicons name={m.isValidator ? 'checkbox' : 'square-outline'} size={22} color={m.isValidator ? COLORS.primary : COLORS.textSecondary} />
                                        </TouchableOpacity>
                                        {m.isValidator && (
                                            <TouchableOpacity
                                                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingBottom: 12 }}
                                                onPress={() => handleToggleRole(m, 'isRequiredValidator')}
                                                disabled={roleUpdateLoading}
                                            >
                                                <Text style={{ color: m.isRequiredValidator ? COLORS.error : COLORS.textSecondary, fontSize: 12, fontWeight: '600' }}>
                                                    Son approbation est obligatoire
                                                </Text>
                                                <Ionicons name={m.isRequiredValidator ? 'checkbox' : 'square-outline'} size={18} color={m.isRequiredValidator ? COLORS.error : COLORS.textSecondary} />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                ))}
                                <Text style={[styles.helper, { color: COLORS.textSecondary, marginTop: 10 }]}>
                                    « Obligatoire » : le retrait reste bloqué tant que cette personne précise n'a pas validé, même si le nombre requis ci-dessus est déjà atteint par d'autres commissaires.
                                </Text>
                            </View>
                        </>
                    )}

                    {/* Membres */}
                    <SectionHeading
                        colors={COLORS}
                        title={`Membres (${vault.members.length})`}
                        marginTop={22}
                        marginBottom={0}
                        actionIcon={myRole?.isAdmin ? (showInviteForm ? 'chevron-up' : 'person-add-outline') : undefined}
                        onAction={myRole?.isAdmin ? () => setShowInviteForm(!showInviteForm) : undefined}
                    />

                    {showInviteForm && <InlineInviteForm colors={COLORS} onInvite={handleInvite} />}

                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6, marginTop: 12 }]}>
                        {vault.members.map((m: any) => {
                            const canEdit = myRole?.isAdmin;
                            const isOpen = editingMemberId === m.id;
                            return (
                                <View key={m.id}>
                                    <TouchableOpacity
                                        style={[styles.memberRow, { borderColor: COLORS.border }]}
                                        activeOpacity={canEdit ? 0.6 : 1}
                                        onPress={() => canEdit && setEditingMemberId(isOpen ? null : m.id)}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>
                                                {m.user.name}{m.userId === user?.id ? ' (Vous)' : ''}
                                            </Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{m.user.phone}</Text>
                                        </View>
                                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: canEdit ? '38%' : '45%', justifyContent: 'flex-end' }}>
                                            {roleBadges(m).map((b) => (
                                                <View key={b} style={[styles.roleBadge, { backgroundColor: COLORS.primary + '15' }]}>
                                                    <Text style={{ color: COLORS.primary, fontSize: 10.5, fontWeight: '700' }}>{b}</Text>
                                                </View>
                                            ))}
                                        </View>
                                        {canEdit && <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} style={{ marginLeft: 6 }} />}
                                    </TouchableOpacity>

                                    {canEdit && isOpen && (
                                        <View style={styles.roleEditRow}>
                                            {ROLE_TOGGLES.map((r) => {
                                                const active = !!m[r.key];
                                                return (
                                                    <TouchableOpacity
                                                        key={r.key}
                                                        style={[styles.roleChip, { borderColor: active ? COLORS.primary : COLORS.border, backgroundColor: active ? COLORS.primary + '15' : 'transparent' }, roleUpdateLoading && styles.disabled]}
                                                        onPress={() => handleToggleRole(m, r.key)}
                                                        disabled={roleUpdateLoading}
                                                    >
                                                        <Text style={{ color: active ? COLORS.primary : COLORS.textSecondary, fontSize: 12.5, fontWeight: '700' }}>{r.label}</Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>

                    {/* Historique */}
                    {historyTx.length > 0 && (
                        <>
                            <SectionHeading colors={COLORS} title="Historique" />
                            <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                                {historyTx.map((tx: any) => (
                                    <View key={tx.id} style={[styles.memberRow, { borderColor: COLORS.border }]}>
                                        <View>
                                            <Text style={{ color: COLORS.textPrimary, fontWeight: '600' }}>{tx.type === 'DEPOSIT' ? 'Dépôt' : 'Retrait'}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{tx.requestedBy.name}</Text>
                                        </View>
                                        <Text style={{ color: tx.type === 'DEPOSIT' ? COLORS.success : COLORS.textPrimary, fontWeight: '700' }}>
                                            {tx.type === 'DEPOSIT' ? '+' : '-'}{tx.amount.toLocaleString('fr-FR')} F
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </>
                    )}

                    <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
                        <Ionicons name="exit-outline" size={18} color={COLORS.error} />
                        <Text style={[styles.leaveBtnText, { color: COLORS.error }]}>Quitter cette caisse</Text>
                    </TouchableOpacity>
                </ScrollView>
                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    inlineForm: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center' },
    inlineInput: { flex: 1, height: 42, paddingHorizontal: 12, fontSize: 15 },
    inlineBtn: { paddingHorizontal: 18, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    inlineBtnFull: { marginTop: 16, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
    inlineBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    disabled: { opacity: 0.5 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 10 },
    cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

    input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 15, marginBottom: 14 },
    label: { fontSize: 12.5, fontWeight: '600', marginBottom: 8 },
    toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    toggleBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
    toggleText: { fontSize: 13, fontWeight: '700' },
    helper: { fontSize: 12.5, lineHeight: 18 },
    recipientFound: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
    memberPick: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },

    approveBtn: { marginTop: 12, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
    transferTag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    roleEditRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingBottom: 14, paddingTop: 2 },
    roleChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5 },
    stepperSmall: { flexDirection: 'row', alignItems: 'center' },

    memberRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1 },
    roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },

    leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 14 },
    leaveBtnText: { fontSize: 14, fontWeight: '700' },
});
