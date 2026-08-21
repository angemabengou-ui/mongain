import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import {
    apiCreateTontine,
    apiGetTontineDetails,
    apiGetTontineGroups,
    apiInviteToTontine,
    apiReorderTontine
} from '../../services/api';

interface TontineGroup {
    id: string;
    name: string;
    contribution: number;
    frequency: string;
    startDate: string;
    currentCycle: number;
    _count: { participants: number };
}

interface Participant {
    id: string;
    tontineGroupId: string;
    status: string;
    payoutOrder: number;
    group: TontineGroup;
}

export default function TontineScreen() {
    const { user } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [myParticipations, setMyParticipations] = useState<Participant[]>([]);
    const [loading, setLoading] = useState(true);

    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupContribution, setNewGroupContribution] = useState('');
    const [newGroupFrequency, setNewGroupFrequency] = useState('MONTHLY');

    // Management Modal States
    const [detailsModalVisible, setDetailsModalVisible] = useState(false);
    const [selectedGroupDetails, setSelectedGroupDetails] = useState<any>(null);
    const [invitePhone, setInvitePhone] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);
    const [inviteMessage, setInviteMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await apiGetTontineGroups();
            if (res.data) {
                setMyParticipations(res.data.myParticipations);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleCreate = async () => {
        if (!newGroupName || !newGroupContribution) {
            Alert.alert("Erreur", "Veuillez remplir le nom et la contribution.");
            return;
        }
        try {
            const res = await apiCreateTontine(newGroupName, parseFloat(newGroupContribution.replace(/\s/g, '').replace(',', '.')), newGroupFrequency);
            Alert.alert("Succès", res.message || "Club créé avec succès.");
            setCreateModalVisible(false);
            setNewGroupName('');
            setNewGroupContribution('');
            loadData();
        } catch (e: any) {
            Alert.alert("Erreur", e.message || "Erreur lors de la création.");
        }
    };

    const openManagementModal = async (groupId: string) => {
        try {
            const res = await apiGetTontineDetails(groupId);
            if (res.success) {
                setSelectedGroupDetails(res.data);
                setInviteMessage(null);
                setDetailsModalVisible(true);
            } else {
                Alert.alert("Erreur", res.message);
            }
        } catch (error: any) {
            Alert.alert("Erreur", "Impossible de charger les détails : " + error.message);
        }
    };

    const handleInvite = async () => {
        if (!invitePhone || !selectedGroupDetails) return;
        setInviteLoading(true);
        setInviteMessage(null);

        let formatted = invitePhone.trim();
        if (!formatted.startsWith('+')) {
            if (formatted.startsWith('0')) formatted = formatted.substring(1);
            formatted = '+241' + formatted;
        }

        try {
            const res = await apiInviteToTontine(selectedGroupDetails.id, formatted);
            setInviteMessage({ type: 'success', text: "✓ " + res.message });
            setInvitePhone('');
            const updated = await apiGetTontineDetails(selectedGroupDetails.id);
            setSelectedGroupDetails(updated.data);
        } catch (error: any) {
            setInviteMessage({ type: 'error', text: "❌ " + (error.message || "Erreur d'invitation.") });
        } finally {
            setInviteLoading(false);
        }
    };

    const handleReorder = async (participantId: string, direction: 'UP' | 'DOWN') => {
        if (!selectedGroupDetails) return;
        const currentList = selectedGroupDetails.participants.map((p: any) => ({ ...p }));
        const index = currentList.findIndex((p: any) => p.id === participantId);
        if (index < 0) return;

        if (direction === 'UP' && index > 0) {
            const temp = currentList[index - 1].payoutOrder;
            currentList[index - 1].payoutOrder = currentList[index].payoutOrder;
            currentList[index].payoutOrder = temp;
        } else if (direction === 'DOWN' && index < currentList.length - 1) {
            const temp = currentList[index + 1].payoutOrder;
            currentList[index + 1].payoutOrder = currentList[index].payoutOrder;
            currentList[index].payoutOrder = temp;
        } else {
            return;
        }

        const map = currentList.map((p: any) => ({ participantId: p.id, newOrder: p.payoutOrder }));
        try {
            await apiReorderTontine(selectedGroupDetails.id, map);
            const updated = await apiGetTontineDetails(selectedGroupDetails.id);
            setSelectedGroupDetails(updated.data);
        } catch (e: any) {
            Alert.alert("Erreur", e.message || "Erreur lors de la réorganisation");
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#4ADE80" />
                <Text style={{ color: '#fff', marginTop: 15, fontWeight: '600' }}>Chargement des clubs...</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.headerHero}>
                <View style={styles.headerRow}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconBtnLayer}>
                        <Ionicons name="arrow-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <Text style={styles.heroTitle}>Tontines</Text>
                    <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.iconBtnLayerSolid}>
                        <Ionicons name="add" size={24} color="#FFF" />
                    </TouchableOpacity>
                </View>
                <Text style={styles.heroDesc}>
                    Épargnez ensemble, gagnez plus vite.
                </Text>
            </View>

            <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 10 }} showsVerticalScrollIndicator={false}>
                {myParticipations.length === 0 ? (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconCircle}>
                            <Ionicons name="wallet-outline" size={48} color="#208AEF" />
                        </View>
                        <Text style={styles.emptyTitle}>Aucune tontine active</Text>
                        <Text style={styles.emptySubtitle}>
                            Créez votre premier club pour commencer à épargner avec vos amis ou votre famille.
                        </Text>
                        <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.primaryPillBtn}>
                            <Text style={styles.primaryPillText}>Lancer un nouveau club</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.section}>
                        <Text style={styles.sectionLabel}>VOS CLUBS ACTIFS</Text>

                        {myParticipations.map(p => {
                            const isMyTurn = p.payoutOrder === p.group.currentCycle;
                            return (
                                <TouchableOpacity key={p.id} style={[styles.glassCard, isMyTurn && styles.glassCardGolden]} onPress={() => openManagementModal(p.group.id)}>
                                    <View style={styles.cardTop}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.cardHeaderTitle}>{p.group.name}</Text>
                                            <Text style={styles.cardMetaInfo}>
                                                <Ionicons name="time-outline" size={14} color="#A19BB0" /> {p.group.frequency === 'MONTHLY' ? 'Mensuel' : 'Hebdo'}  •  #{p.payoutOrder} sur {p.group._count?.participants || '?'}
                                            </Text>
                                        </View>
                                        <View style={styles.circleBadge}>
                                            <Ionicons name="chevron-forward" size={18} color="#A19BB0" />
                                        </View>
                                    </View>

                                    <View style={styles.divider} />

                                    <View style={styles.cardBottom}>
                                        <View>
                                            <Text style={styles.lightLabel}>Cotisation</Text>
                                            <Text style={styles.mainFigure}>{p.group.contribution.toLocaleString('fr-FR')} FCFA</Text>
                                        </View>

                                        <View style={{ alignItems: 'flex-end' }}>
                                            <Text style={styles.lightLabel}>Cycle Actuel</Text>
                                            <View style={[styles.statusBadge, isMyTurn && styles.statusBadgeGolden]}>
                                                {isMyTurn ? (
                                                    <Ionicons name="gift" size={12} color="#F59E0B" style={{ marginRight: 4 }} />
                                                ) : (
                                                    <Ionicons name="sync" size={12} color="#208AEF" style={{ marginRight: 4 }} />
                                                )}
                                                <Text style={[styles.statusBadgeText, isMyTurn && { color: '#F59E0B' }]}>
                                                    {isMyTurn ? "C'est votre tour !" : `N° ${p.group.currentCycle}`}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}
            </ScrollView>

            {/* Modal: Creation */}
            <Modal visible={createModalVisible} transparent animationType="slide" onRequestClose={() => setCreateModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom + 20, 30) }]}>
                        <View style={styles.sheetHandle} />
                        <Text style={styles.sheetTitle}>Nouveau Club de Tontine</Text>
                        <Text style={styles.sheetSubtitle}>Configurez les règles de cotisation de votre futur groupe.</Text>

                        <Text style={styles.inputLabel}>Nom du Club</Text>
                        <TextInput style={styles.inputField} placeholderTextColor="#71717A" placeholder="Ex: Tontine Famille" value={newGroupName} onChangeText={setNewGroupName} autoCapitalize="words" />

                        <Text style={styles.inputLabel}>Montant de la cotisation (FCFA)</Text>
                        <TextInput style={styles.inputField} placeholderTextColor="#71717A" placeholder="Ex: 10000" keyboardType="numeric" value={newGroupContribution} onChangeText={setNewGroupContribution} />

                        <Text style={styles.inputLabel}>Fréquence des prélèvements</Text>
                        <View style={styles.radioGroup}>
                            <TouchableOpacity style={[styles.radioBtn, newGroupFrequency === 'WEEKLY' && styles.radioBtnActive]} onPress={() => setNewGroupFrequency('WEEKLY')}>
                                <Text style={[styles.radioText, newGroupFrequency === 'WEEKLY' && styles.radioTextActive]}>Hebdomadaire</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.radioBtn, newGroupFrequency === 'MONTHLY' && styles.radioBtnActive]} onPress={() => setNewGroupFrequency('MONTHLY')}>
                                <Text style={[styles.radioText, newGroupFrequency === 'MONTHLY' && styles.radioTextActive]}>Mensuelle</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.btnSecondary} onPress={() => setCreateModalVisible(false)}>
                                <Text style={styles.btnSecondaryText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate}>
                                <Text style={styles.btnPrimaryText}>Créer le club</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Modal: Management */}
            <Modal visible={detailsModalVisible} transparent animationType="slide" onRequestClose={() => setDetailsModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.bottomSheet, { height: '85%', paddingBottom: Math.max(insets.bottom + 20, 30) }]}>
                        <View style={styles.sheetHandle} />

                        {selectedGroupDetails && (
                            <View style={{ flex: 1 }}>
                                <View style={styles.sheetHeaderWithAction}>
                                    <View>
                                        <Text style={styles.sheetTitle}>{selectedGroupDetails.name}</Text>
                                        <Text style={styles.sheetSubtitle}>Cagnotte totale : <Text style={{ color: '#4ADE80', fontWeight: 'bold' }}>{(selectedGroupDetails.contribution * selectedGroupDetails.participants.length).toLocaleString('fr-FR')} FCFA</Text></Text>
                                    </View>
                                    <TouchableOpacity onPress={() => { setDetailsModalVisible(false); loadData(); }} style={styles.closeBtn}>
                                        <Ionicons name="close" size={24} color="#FFF" />
                                    </TouchableOpacity>
                                </View>

                                <ScrollView style={{ flex: 1, marginTop: 10 }} showsVerticalScrollIndicator={false}>

                                    {selectedGroupDetails.creatorId === user?.id && (
                                        <View style={styles.inviteBox}>
                                            <Text style={[styles.inputLabel, { color: '#FFF' }]}>Ajouter un membre</Text>
                                            <View style={styles.inviteRow}>
                                                <TextInput
                                                    style={styles.inviteInput}
                                                    placeholderTextColor="#A19BB0"
                                                    placeholder="Téléphone (ex: 074...)"
                                                    keyboardType="phone-pad"
                                                    value={invitePhone}
                                                    onChangeText={setInvitePhone}
                                                />
                                                <TouchableOpacity style={styles.inviteActionBtn} onPress={handleInvite} disabled={inviteLoading}>
                                                    {inviteLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#FFF" />}
                                                </TouchableOpacity>
                                            </View>
                                            {inviteMessage && (
                                                <Text style={{ color: inviteMessage.type === 'error' ? '#EF4444' : '#4ADE80', marginTop: 10, fontSize: 13, fontWeight: '600' }}>
                                                    {inviteMessage.text}
                                                </Text>
                                            )}
                                        </View>
                                    )}

                                    <View style={styles.membersHeader}>
                                        <Text style={styles.sectionLabel}>ORDRE DE PASSAGE ({selectedGroupDetails.participants.length})</Text>
                                    </View>

                                    <View style={styles.membersList}>
                                        {selectedGroupDetails.participants.map((p: any, idx: number) => {
                                            const isMe = p.user.id === user?.id;
                                            const isCurrentTurn = p.payoutOrder === selectedGroupDetails.currentCycle;
                                            const isPast = p.payoutOrder < selectedGroupDetails.currentCycle;

                                            return (
                                                <View key={p.id} style={[styles.memberRow, isMe && styles.memberRowMe]}>
                                                    <View style={[styles.orderCircle, isCurrentTurn && { backgroundColor: '#F59E0B' }, isPast && { opacity: 0.5 }]}>
                                                        {isPast ? <Ionicons name="checkmark" size={14} color="#FFF" /> : <Text style={styles.orderCircleText}>{p.payoutOrder}</Text>}
                                                    </View>
                                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                                        <Text style={[styles.memberName, isMe && { color: '#4ADE80' }, isPast && { color: '#71717A' }]}>
                                                            {p.user.name} {isMe ? '(Vous)' : ''}
                                                        </Text>
                                                        <Text style={styles.memberPhone}>{p.user.phone}</Text>
                                                    </View>

                                                    {selectedGroupDetails.creatorId === user?.id && !isMe && (
                                                        <View style={{ flexDirection: 'row', gap: 6 }}>
                                                            {idx > 0 && (
                                                                <TouchableOpacity style={styles.sortBtn} onPress={() => handleReorder(p.id, 'UP')}>
                                                                    <Ionicons name="chevron-up" size={18} color="#A19BB0" />
                                                                </TouchableOpacity>
                                                            )}
                                                            {idx < selectedGroupDetails.participants.length - 1 && (
                                                                <TouchableOpacity style={styles.sortBtn} onPress={() => handleReorder(p.id, 'DOWN')}>
                                                                    <Ionicons name="chevron-down" size={18} color="#A19BB0" />
                                                                </TouchableOpacity>
                                                            )}
                                                        </View>
                                                    )}
                                                </View>
                                            );
                                        })}
                                    </View>
                                </ScrollView>
                            </View>
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#090514' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#090514' },

    headerHero: { paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 40 : 10, paddingBottom: 30, backgroundColor: '#110A24', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    iconBtnLayer: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
    iconBtnLayerSolid: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#208AEF', justifyContent: 'center', alignItems: 'center', shadowColor: '#208AEF', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
    heroTitle: { fontSize: 24, fontWeight: '800', color: '#FFF' },
    heroDesc: { fontSize: 15, color: '#A19BB0', lineHeight: 22 },

    container: { flex: 1, paddingHorizontal: 20 },
    section: { marginTop: 20 },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: '#71717A', letterSpacing: 1.2, marginBottom: 15, textTransform: 'uppercase' },

    glassCard: { backgroundColor: '#160E2A', borderRadius: 24, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
    glassCardGolden: { borderColor: 'rgba(245, 158, 11, 0.3)', backgroundColor: '#1A1423' },

    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#FFF', marginBottom: 4 },
    cardMetaInfo: { fontSize: 13, color: '#A19BB0', fontWeight: '500' },
    circleBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },

    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 16 },

    cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    lightLabel: { fontSize: 12, color: '#71717A', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    mainFigure: { fontSize: 20, fontWeight: '800', color: '#FFF' },
    statusBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(32,138,239,0.15)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
    statusBadgeGolden: { backgroundColor: 'rgba(245,158,11,0.15)' },
    statusBadgeText: { fontSize: 13, fontWeight: '700', color: '#208AEF' },

    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
    emptyIconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(32, 138, 239, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    emptyTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12 },
    emptySubtitle: { fontSize: 15, color: '#A19BB0', textAlign: 'center', paddingHorizontal: 20, lineHeight: 22, marginBottom: 32 },
    primaryPillBtn: { backgroundColor: '#208AEF', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 30, shadowColor: '#208AEF', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 6 }, shadowRadius: 15 },
    primaryPillText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    bottomSheet: { backgroundColor: '#110A24', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 24 },
    sheetHeaderWithAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    sheetTitle: { fontSize: 22, fontWeight: '800', color: '#FFF', marginBottom: 6 },
    sheetSubtitle: { fontSize: 15, color: '#A19BB0', marginBottom: 24, lineHeight: 22 },

    inputLabel: { fontSize: 13, fontWeight: '600', color: '#A19BB0', marginBottom: 10, marginTop: 10 },
    inputField: { backgroundColor: '#1A1130', borderRadius: 16, padding: 16, color: '#FFF', fontSize: 16, borderWidth: 1, borderColor: '#2A1D45', marginBottom: 10 },

    radioGroup: { flexDirection: 'row', gap: 12, marginBottom: 30 },
    radioBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: '#1A1130', borderWidth: 1, borderColor: '#2A1D45', alignItems: 'center' },
    radioBtnActive: { backgroundColor: 'rgba(32,138,239,0.15)', borderColor: '#208AEF' },
    radioText: { color: '#71717A', fontWeight: '600', fontSize: 14 },
    radioTextActive: { color: '#208AEF', fontWeight: '700' },

    actionRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
    btnSecondary: { flex: 1, paddingVertical: 16, borderRadius: 16, backgroundColor: '#2A1D45', alignItems: 'center' },
    btnSecondaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
    btnPrimary: { flex: 1, paddingVertical: 16, borderRadius: 16, backgroundColor: '#4ADE80', alignItems: 'center' },
    btnPrimaryText: { color: '#090514', fontSize: 16, fontWeight: '700' },

    inviteBox: { backgroundColor: '#1A1130', borderRadius: 20, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(74, 222, 128, 0.2)' },
    inviteRow: { flexDirection: 'row', gap: 12 },
    inviteInput: { flex: 1, backgroundColor: '#090514', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: '#FFF', fontSize: 15 },
    inviteActionBtn: { width: 48, backgroundColor: '#4ADE80', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },

    membersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    membersList: { backgroundColor: '#160E2A', borderRadius: 20, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    memberRowMe: { backgroundColor: 'rgba(74, 222, 128, 0.05)', borderRadius: 12, borderBottomWidth: 0 },
    orderCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#208AEF', justifyContent: 'center', alignItems: 'center' },
    orderCircleText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
    memberName: { fontSize: 15, fontWeight: '700', color: '#FFF', marginBottom: 2 },
    memberPhone: { fontSize: 13, color: '#71717A' },
    sortBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#090514', justifyContent: 'center', alignItems: 'center' }
});
