import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { apiCreateTontine, apiGetTontineDetails, apiGetTontineGroups, apiInviteToTontine, apiReorderTontine } from '../../services/api';

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
            Alert.alert("Félicitations", res.message || "Votre club a été créé avec succès.");
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
                setInviteMessage(null); // Reset UI alert when opening
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
        // Si le numéro ne contient pas de +, on assume le préfixe +241
        if (!formatted.startsWith('+')) {
            // Nettoyer si l'utilisateur a écrit 074... 
            if (formatted.startsWith('0')) formatted = formatted.substring(1);
            formatted = '+241' + formatted;
        }

        try {
            const res = await apiInviteToTontine(selectedGroupDetails.id, formatted);
            setInviteMessage({ type: 'success', text: "✓ " + res.message });
            setInvitePhone('');
            // Reload details
            const updated = await apiGetTontineDetails(selectedGroupDetails.id);
            setSelectedGroupDetails(updated.data);
        } catch (error: any) {
            setInviteMessage({ type: 'error', text: "❌ " + (error.message || "Erreur lors de l'invitation.") });
        } finally {
            setInviteLoading(false);
        }
    };

    const handleReorder = async (participantId: string, direction: 'UP' | 'DOWN') => {
        if (!selectedGroupDetails) return;
        // Copie profonde des participants concernés : les muter directement (même après un
        // spread superficiel de l'array) modifiait les mêmes objets que l'état React
        // affiché, donc un ordre jamais confirmé par le serveur restait visible à l'écran
        // en cas d'échec de la requête ci-dessous.
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
            return; // invalid move
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
                <ActivityIndicator size="large" color="#208AEF" />
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 50 }}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Épargne & Tontine</Text>
            </View>

            {myParticipations.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Mes Cotisations en cours</Text>
                    {myParticipations.map(p => (
                        <TouchableOpacity key={p.id} style={styles.cardActive} onPress={() => openManagementModal(p.group.id)}>
                            <View style={styles.cardHeader}>
                                <Text style={styles.cardTitle}>{p.group.name}</Text>
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>Ordre: #{p.payoutOrder}</Text>
                                </View>
                            </View>
                            <Text style={styles.cardDesc}>
                                Prélèvement : <Text style={styles.bold}>{p.group.contribution} FCFA</Text> / {p.group.frequency === 'MONTHLY' ? 'Mois' : 'Semaine'}
                            </Text>

                            {p.payoutOrder === p.group.currentCycle ? (
                                <Text style={[styles.statusText, { color: '#FBBF24', fontSize: 14, fontWeight: '800' }]}>🎉 C'est à vous de recevoir la cagnotte (Cycle #{p.group.currentCycle}) !</Text>
                            ) : (
                                <Text style={[styles.statusText, { color: '#A19BB0' }]}>Cycle actuel : #{p.group.currentCycle} (En attente de votre tour)</Text>
                            )}
                            <Text style={[styles.statusText, { color: '#888', marginTop: 10 }]}>Tapotez pour voir les détails 👀</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Nouveau Club</Text>
                    <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.createBtn}>
                        <Ionicons name="add" size={20} color="#FFF" />
                        <Text style={styles.createBtnText}>Créer</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.emptyText}>Créez votre club puis invitez des membres par numéro de téléphone depuis sa page de gestion.</Text>
            </View>

            {/* Modal de Création de Tontine */}
            <Modal visible={createModalVisible} transparent animationType="slide" onRequestClose={() => setCreateModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Créer un Club de Tontine</Text>

                        <Text style={styles.label}>Nom du club</Text>
                        <TextInput style={styles.input} placeholderTextColor="#A19BB0" placeholder="Ex: Tontine Famille" value={newGroupName} onChangeText={setNewGroupName} autoCapitalize="words" />

                        <Text style={styles.label}>Cotisation (FCFA)</Text>
                        <TextInput style={styles.input} placeholderTextColor="#A19BB0" placeholder="Ex: 5000" keyboardType="numeric" value={newGroupContribution} onChangeText={setNewGroupContribution} />

                        <Text style={styles.label}>Fréquence</Text>
                        <View style={styles.frequencyRow}>
                            <TouchableOpacity style={[styles.freqBtn, newGroupFrequency === 'WEEKLY' && styles.freqBtnActive]} onPress={() => setNewGroupFrequency('WEEKLY')}>
                                <Text style={[styles.freqText, newGroupFrequency === 'WEEKLY' && styles.freqTextActive]}>Hebdomadaire</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.freqBtn, newGroupFrequency === 'MONTHLY' && styles.freqBtnActive]} onPress={() => setNewGroupFrequency('MONTHLY')}>
                                <Text style={[styles.freqText, newGroupFrequency === 'MONTHLY' && styles.freqTextActive]}>Mensuelle</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreateModalVisible(false)}>
                                <Text style={styles.cancelBtnText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.confirmCreateBtn} onPress={handleCreate}>
                                <Text style={styles.confirmCreateText}>Créer le club</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal de Détails (Gestion) */}
            <Modal visible={detailsModalVisible} transparent animationType="slide" onRequestClose={() => setDetailsModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        {selectedGroupDetails && (
                            <>
                                <View style={styles.cardHeader}>
                                    <Text style={styles.modalTitle}>{selectedGroupDetails.name}</Text>
                                    <TouchableOpacity onPress={() => { setDetailsModalVisible(false); loadData(); }}>
                                        <Ionicons name="close" size={24} color="#FFF" />
                                    </TouchableOpacity>
                                </View>
                                <Text style={styles.cardDesc}>
                                    Cagnotte totale attendue : <Text style={{ color: '#4ADE80', fontWeight: 'bold' }}>{selectedGroupDetails.contribution * selectedGroupDetails.participants.length} FCFA</Text>
                                </Text>

                                {selectedGroupDetails.creatorId === user?.id && (
                                    <View style={{ marginTop: 15, marginBottom: 15 }}>
                                        <Text style={styles.label}>Inviter un membre (N° Téléphone)</Text>
                                        <View style={{ flexDirection: 'row', gap: 10 }}>
                                            <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholderTextColor="#A19BB0" placeholder="Ex: 07455..." keyboardType="phone-pad" value={invitePhone} onChangeText={setInvitePhone} />
                                            <TouchableOpacity style={{ backgroundColor: '#208AEF', paddingHorizontal: 15, borderRadius: 12, justifyContent: 'center' }} onPress={handleInvite} disabled={inviteLoading}>
                                                {inviteLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Inviter</Text>}
                                            </TouchableOpacity>
                                        </View>
                                        {inviteMessage && (
                                            <Text style={{ color: inviteMessage.type === 'error' ? '#EF4444' : '#4ADE80', marginTop: 10, fontWeight: 'bold', fontSize: 13 }}>
                                                {inviteMessage.text}
                                            </Text>
                                        )}
                                    </View>
                                )}

                                <Text style={styles.sectionTitle}>Membres du Club</Text>
                                <ScrollView style={{ maxHeight: 250 }}>
                                    {selectedGroupDetails.participants.map((p: any) => (
                                        <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#2D1F4D', padding: 12, borderRadius: 8, marginBottom: 8 }}>
                                            <Text style={{ color: p.user.id === user?.id ? '#208AEF' : '#FFF', flex: 1, fontWeight: 'bold' }}>
                                                #{p.payoutOrder} - {p.user.name} {p.user.id === user?.id ? '(Moi)' : ''}
                                            </Text>

                                            {selectedGroupDetails.creatorId === user?.id && p.user.id !== user?.id && (
                                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                                    <TouchableOpacity onPress={() => handleReorder(p.id, 'UP')}>
                                                        <Ionicons name="caret-up-circle" size={24} color="#4ADE80" />
                                                    </TouchableOpacity>
                                                    <TouchableOpacity onPress={() => handleReorder(p.id, 'DOWN')}>
                                                        <Ionicons name="caret-down-circle" size={24} color="#FBBF24" />
                                                    </TouchableOpacity>
                                                </View>
                                            )}
                                        </View>
                                    ))}
                                </ScrollView>
                            </>
                        )}
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#130925',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#130925',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 20,
        paddingHorizontal: 20,
        backgroundColor: '#1C1236',
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        marginBottom: 20,
    },
    backButton: {
        padding: 5,
        marginRight: 15,
    },
    headerTitle: {
        color: '#FFF',
        fontSize: 22,
        fontWeight: '700',
    },
    section: {
        paddingHorizontal: 20,
        marginBottom: 30,
    },
    sectionTitle: {
        color: '#A19BB0',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 15,
        textTransform: 'uppercase',
    },
    card: {
        backgroundColor: '#1C1236',
        borderRadius: 16,
        padding: 18,
        marginBottom: 15,
        borderWidth: 1,
        borderColor: '#2D1F4D',
    },
    cardActive: {
        backgroundColor: 'rgba(32, 138, 239, 0.1)',
        borderRadius: 16,
        padding: 18,
        marginBottom: 15,
        borderWidth: 1,
        borderColor: '#208AEF',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    cardTitle: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    badge: {
        backgroundColor: '#208AEF',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        color: '#FFF',
        fontSize: 12,
        fontWeight: 'bold',
    },
    participantsBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(32, 138, 239, 0.15)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    participantsText: {
        color: '#208AEF',
        fontSize: 13,
        fontWeight: 'bold',
    },
    cardDesc: {
        color: '#A19BB0',
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 5,
    },
    bold: {
        color: '#FFF',
        fontWeight: 'bold',
    },
    statusText: {
        color: '#4ADE80',
        fontSize: 13,
        fontWeight: '600',
        marginTop: 5,
    },
    emptyText: {
        color: '#666',
        fontStyle: 'italic',
        textAlign: 'center',
        marginTop: 10,
    },
    joinBtn: {
        backgroundColor: '#208AEF',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 15,
    },
    joinBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 15,
    },
    createBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#4ADE80',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
    },
    createBtnText: {
        color: '#FFF',
        fontWeight: 'bold',
        marginLeft: 4,
        fontSize: 14,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#1C1236',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
    },
    modalTitle: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 20,
        textAlign: 'center',
    },
    label: {
        color: '#A19BB0',
        marginBottom: 8,
        fontWeight: '600',
    },
    input: {
        backgroundColor: '#130925',
        color: '#FFF',
        borderRadius: 12,
        padding: 14,
        fontSize: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#2D1F4D',
    },
    frequencyRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 30,
    },
    freqBtn: {
        flex: 1,
        backgroundColor: '#130925',
        paddingVertical: 12,
        borderRadius: 12,
        marginHorizontal: 5,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#2D1F4D',
    },
    freqBtnActive: {
        backgroundColor: 'rgba(32, 138, 239, 0.2)',
        borderColor: '#208AEF',
    },
    freqText: {
        color: '#A19BB0',
        fontWeight: 'bold',
    },
    freqTextActive: {
        color: '#208AEF',
    },
    modalActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    cancelBtn: {
        flex: 1,
        backgroundColor: '#2D1F4D',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginRight: 10,
    },
    cancelBtnText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 16,
    },
    confirmCreateBtn: {
        flex: 1,
        backgroundColor: '#208AEF',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginLeft: 10,
    },
    confirmCreateText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 16,
    }
});
