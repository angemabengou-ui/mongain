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
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import {
    apiApproveVault,
    apiCreateVault,
    apiDepositVault,
    apiGetVaultDetails,
    apiGetVaults,
    apiInviteVault,
    apiWithdrawRequestVault,
} from '../../services/api';

export default function VaultsScreen() {
    const { user } = useAuth();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [vaults, setVaults] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [newVaultName, setNewVaultName] = useState('');
    const [newVaultDesc, setNewVaultDesc] = useState('');

    const [detailsModalVisible, setDetailsModalVisible] = useState(false);
    const [selectedVault, setSelectedVault] = useState<any>(null);
    const [myRole, setMyRole] = useState<any>(null);

    const [invitePhone, setInvitePhone] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);

    const [actionAmount, setActionAmount] = useState('');

    useEffect(() => {
        loadVaults();
    }, []);

    const loadVaults = async () => {
        try {
            const res = await apiGetVaults();
            setVaults(res.data.data);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newVaultName.trim()) return Alert.alert("Erreur", "Le nom est requis");
        try {
            await apiCreateVault({ name: newVaultName, description: newVaultDesc });
            setCreateModalVisible(false);
            setNewVaultName('');
            loadVaults();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Erreur création");
        }
    };

    const openDetails = async (vaultId: string) => {
        try {
            const res = await apiGetVaultDetails(vaultId);
            setSelectedVault(res.data.data);
            setMyRole(res.data.role);
            setDetailsModalVisible(true);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Impossible de charger la caisse");
        }
    };

    const handleInvite = async () => {
        if (!invitePhone) return;
        setInviteLoading(true);
        try {
            await apiInviteVault(selectedVault.id, invitePhone);
            Alert.alert("Succès", "Membre invité");
            setInvitePhone('');
            openDetails(selectedVault.id);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Échec invitation");
        } finally {
            setInviteLoading(false);
        }
    };

    const handleDeposit = async () => {
        if (!actionAmount) return;
        try {
            await apiDepositVault(selectedVault.id, actionAmount);
            Alert.alert("Succès", "Dépôt effectué !");
            setActionAmount('');
            openDetails(selectedVault.id);
            loadVaults();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Échec");
        }
    };

    const handleWithdraw = async (destType: string) => {
        if (!actionAmount) return;
        try {
            await apiWithdrawRequestVault(selectedVault.id, { amount: actionAmount, destinationType: destType });
            Alert.alert("Succès", "Demande initiée. Les valideurs doivent l'approuver.");
            setActionAmount('');
            openDetails(selectedVault.id);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Échec");
        }
    };

    const handleApprove = async (txId: string) => {
        try {
            const res = await apiApproveVault(selectedVault.id, txId);
            Alert.alert("Succès", res.data.message);
            openDetails(selectedVault.id);
            loadVaults();
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.message || "Échec approbation");
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#F59E0B" />
                <Text style={{ color: '#fff', marginTop: 15 }}>Chargement des coffres...</Text>
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
                    <Text style={styles.heroTitle}>Caisses Communes</Text>
                    <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.iconBtnLayerSolid}>
                        <Ionicons name="add" size={24} color="#FFF" />
                    </TouchableOpacity>
                </View>
                <Text style={styles.heroDesc}>
                    Le compte commun ultra-sécurisé à validation multi-signatures.
                </Text>
            </View>

            <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 100, paddingTop: 10 }}>
                {vaults.length === 0 ? (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconCircle}>
                            <Ionicons name="lock-closed" size={48} color="#F59E0B" />
                        </View>
                        <Text style={styles.emptyTitle}>Aucune caisse active</Text>
                        <Text style={styles.emptySubtitle}>Créez un coffre-fort sécurisé avec vos partenaires pour collecter et gérer vos fonds en commun.</Text>
                        <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.primaryPillBtn}>
                            <Text style={styles.primaryPillText}>Ouvrir un coffre</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    vaults.map(v => (
                        <TouchableOpacity key={v.id} style={styles.glassCard} onPress={() => openDetails(v.vault.id)}>
                            <View style={styles.cardTop}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.cardHeaderTitle}>{v.vault.name}</Text>
                                    <Text style={styles.cardMetaInfo}>
                                        <Ionicons name="people" size={14} /> {v.vault._count.members} membres
                                    </Text>
                                </View>
                                <View style={styles.circleBadge}>
                                    <Ionicons name="chevron-forward" size={18} color="#A19BB0" />
                                </View>
                            </View>
                            <View style={styles.divider} />
                            <View style={styles.cardBottom}>
                                <View>
                                    <Text style={styles.lightLabel}>Solde</Text>
                                    <Text style={styles.mainFigure}>{v.vault.balance.toLocaleString('fr-FR')} FCFA</Text>
                                </View>
                                {v.vault._count.transactions > 0 && (
                                    <View style={styles.pendingBadge}>
                                        <Text style={styles.pendingText}>{v.vault._count.transactions} en attente</Text>
                                    </View>
                                )}
                            </View>
                        </TouchableOpacity>
                    ))
                )}
            </ScrollView>

            <Modal visible={createModalVisible} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom + 20, 30) }]}>
                        <View style={styles.sheetHandle} />
                        <Text style={styles.sheetTitle}>Nouvelle Caisse</Text>

                        <Text style={styles.inputLabel}>Nom de la Caisse</Text>
                        <TextInput style={styles.inputField} placeholderTextColor="#71717A" placeholder="Ex: Caisse Mariage" value={newVaultName} onChangeText={setNewVaultName} />

                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.btnSecondary} onPress={() => setCreateModalVisible(false)}><Text style={styles.btnSecondaryText}>Annuler</Text></TouchableOpacity>
                            <TouchableOpacity style={styles.btnPrimary} onPress={handleCreate}><Text style={styles.btnPrimaryText}>Créer</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={detailsModalVisible} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.bottomSheet, { height: '90%', paddingBottom: Math.max(insets.bottom + 20, 30) }]}>
                        <View style={styles.sheetHandle} />
                        {selectedVault && (
                            <View style={{ flex: 1 }}>
                                <View style={styles.sheetHeaderWithAction}>
                                    <View>
                                        <Text style={styles.sheetTitle}>{selectedVault.name}</Text>
                                        <Text style={styles.sheetSubtitle}>Solde commun : <Text style={{ color: '#F59E0B', fontWeight: 'bold' }}>{selectedVault.balance.toLocaleString('fr-FR')} FCFA</Text></Text>
                                    </View>
                                    <TouchableOpacity onPress={() => setDetailsModalVisible(false)} style={styles.closeBtn}>
                                        <Ionicons name="close" size={24} color="#FFF" />
                                    </TouchableOpacity>
                                </View>

                                <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                                    {/* Actions */}
                                    <View style={styles.walletActions}>
                                        <Text style={styles.inputLabel}>Montant d'opération</Text>
                                        <TextInput style={styles.inputField} keyboardType="numeric" placeholder="Ex: 50000" placeholderTextColor="#71717A" value={actionAmount} onChangeText={setActionAmount} />

                                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                                            <TouchableOpacity style={[styles.btnPrimary, { flex: 1 }]} onPress={handleDeposit}>
                                                <Text style={styles.btnPrimaryText}>Faire un dépôt</Text>
                                            </TouchableOpacity>
                                        </View>

                                        {myRole?.isInitiator && (
                                            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                                                <TouchableOpacity style={[styles.btnSecondary, { flex: 1, borderColor: '#F59E0B' }]} onPress={() => handleWithdraw('VOUCHER')}>
                                                    <Text style={[styles.btnSecondaryText, { color: '#F59E0B' }]}>Demander Bon</Text>
                                                </TouchableOpacity>
                                            </View>
                                        )}
                                    </View>

                                    {/* Transactions Pending */}
                                    {selectedVault.transactions.length > 0 && (
                                        <View style={{ marginTop: 24 }}>
                                            <Text style={styles.sectionLabel}>Transactions (50 dernières)</Text>
                                            {selectedVault.transactions.map((tx: any) => (
                                                <View key={tx.id} style={styles.txRow}>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{tx.type === 'DEPOSIT' ? 'Dépôt' : 'Demande Retrait'}</Text>
                                                        <Text style={{ color: '#A19BB0', fontSize: 13 }}>Par {tx.requestedBy.name}</Text>

                                                        {tx.status === 'PENDING' ? (
                                                            <Text style={{ color: '#F59E0B', fontSize: 12, marginTop: 4 }}>
                                                                En attente de validation ({tx.approvals?.length || 0}/2+)
                                                            </Text>
                                                        ) : (
                                                            <Text style={{ color: '#4ADE80', fontSize: 12, marginTop: 4 }}>Traitée</Text>
                                                        )}
                                                    </View>
                                                    <View style={{ alignItems: 'flex-end' }}>
                                                        <Text style={{ color: tx.type === 'DEPOSIT' ? '#4ADE80' : '#EF4444', fontWeight: 'bold' }}>
                                                            {tx.amount.toLocaleString()} F
                                                        </Text>
                                                        {tx.status === 'PENDING' && myRole?.isValidator && (
                                                            <TouchableOpacity style={styles.approveBtn} onPress={() => handleApprove(tx.id)}>
                                                                <Text style={styles.approveBtnText}>Approuver</Text>
                                                            </TouchableOpacity>
                                                        )}
                                                    </View>
                                                </View>
                                            ))}
                                        </View>
                                    )}

                                    {/* Members */}
                                    <View style={{ marginTop: 24 }}>
                                        <Text style={styles.sectionLabel}>Membres du coffre</Text>

                                        {myRole?.isAdmin && (
                                            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 15 }}>
                                                <TextInput style={[styles.inputField, { flex: 1, marginBottom: 0 }]} placeholder="Tél du membre" placeholderTextColor="#71717A" value={invitePhone} onChangeText={setInvitePhone} />
                                                <TouchableOpacity style={styles.primaryPillBtn} onPress={handleInvite}>
                                                    <Ionicons name="send" size={20} color="#FFF" />
                                                </TouchableOpacity>
                                            </View>
                                        )}

                                        {selectedVault.members.map((m: any) => (
                                            <View key={m.id} style={styles.memberRow}>
                                                <View>
                                                    <Text style={{ color: '#FFF', fontWeight: '600' }}>{m.user.name}</Text>
                                                    <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                                                        {m.isAdmin && <Text style={styles.roleBadge}>Admin</Text>}
                                                        {m.isInitiator && <Text style={styles.roleBadge}>Resp.</Text>}
                                                        {m.isValidator && <Text style={[styles.roleBadge, { backgroundColor: '#F59E0B' }]}>Valid</Text>}
                                                    </View>
                                                </View>
                                                <Text style={{ color: '#A19BB0', fontSize: 13 }}>{m.user.phone}</Text>
                                            </View>
                                        ))}
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
    iconBtnLayerSolid: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F59E0B', justifyContent: 'center', alignItems: 'center', shadowColor: '#F59E0B', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
    heroTitle: { fontSize: 24, fontWeight: '800', color: '#FFF' },
    heroDesc: { fontSize: 15, color: '#A19BB0', lineHeight: 22 },
    container: { flex: 1, paddingHorizontal: 20 },

    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
    emptyIconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(245, 158, 11, 0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
    emptyTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12 },
    emptySubtitle: { fontSize: 15, color: '#A19BB0', textAlign: 'center', paddingHorizontal: 20, lineHeight: 22, marginBottom: 32 },
    primaryPillBtn: { backgroundColor: '#F59E0B', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
    primaryPillText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

    glassCard: { backgroundColor: '#160E2A', borderRadius: 24, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#FFF', marginBottom: 4 },
    cardMetaInfo: { fontSize: 13, color: '#A19BB0', fontWeight: '500' },
    circleBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
    divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 16 },
    cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    lightLabel: { fontSize: 12, color: '#71717A', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
    mainFigure: { fontSize: 20, fontWeight: '800', color: '#FFF' },
    pendingBadge: { backgroundColor: 'rgba(239, 68, 68, 0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    pendingText: { color: '#EF4444', fontSize: 12, fontWeight: '600' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
    bottomSheet: { backgroundColor: '#110A24', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 24 },
    sheetHeaderWithAction: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
    sheetTitle: { fontSize: 22, fontWeight: '800', color: '#FFF', marginBottom: 6 },
    sheetSubtitle: { fontSize: 15, color: '#A19BB0', marginBottom: 24 },

    inputLabel: { fontSize: 13, color: '#A19BB0', fontWeight: '600', marginBottom: 8, textTransform: 'uppercase' },
    inputField: { backgroundColor: 'rgba(255,255,255,0.05)', color: '#FFF', borderRadius: 16, padding: 16, fontSize: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },

    actionRow: { flexDirection: 'row', gap: 12, marginTop: 10 },
    btnSecondary: { flex: 1, paddingVertical: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center' },
    btnSecondaryText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
    btnPrimary: { flex: 1, paddingVertical: 16, borderRadius: 16, backgroundColor: '#F59E0B', alignItems: 'center' },
    btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },

    walletActions: { backgroundColor: '#160E2A', padding: 16, borderRadius: 16, marginBottom: 20 },
    sectionLabel: { fontSize: 13, color: '#A19BB0', fontWeight: '700', textTransform: 'uppercase', marginBottom: 12 },

    txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
    approveBtn: { backgroundColor: '#F59E0B', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginTop: 8 },
    approveBtnText: { color: '#FFF', fontSize: 12, fontWeight: '600' },

    memberRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 12, marginBottom: 8 },
    roleBadge: { backgroundColor: '#208AEF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontSize: 10, color: '#FFF', overflow: 'hidden' }
});
