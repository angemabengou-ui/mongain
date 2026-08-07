import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiCreateTontine, apiGetTontineGroups, apiJoinTontine } from '../../services/api';

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
    const router = useRouter();
    const [groups, setGroups] = useState<TontineGroup[]>([]);
    const [myParticipations, setMyParticipations] = useState<Participant[]>([]);
    const [loading, setLoading] = useState(true);

    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupContribution, setNewGroupContribution] = useState('');
    const [newGroupFrequency, setNewGroupFrequency] = useState('MONTHLY');

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await apiGetTontineGroups();
            if (res.data) {
                setGroups(res.data.groups);
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

    const handleJoin = async (groupId: string, groupName: string, contribution: number) => {
        Alert.alert(
            "Rejoindre le Club",
            `Voulez-vous vraiment rejoindre "${groupName}" ?\nUne cotisation automatique de ${contribution} FCFA sera prélevée à chaque cycle.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Confirmer',
                    onPress: async () => {
                        try {
                            const res = await apiJoinTontine(groupId);
                            Alert.alert("Félicitations", res.message || "Vous faites désormais partie de cette tontine !");
                            loadData();
                        } catch (e: any) {
                            Alert.alert("Erreur", e.message || "Erreur de connexion.");
                        }
                    }
                }
            ]
        );
    };

    const handleCreate = async () => {
        if (!newGroupName || !newGroupContribution) {
            Alert.alert("Erreur", "Veuillez remplir le nom et la contribution.");
            return;
        }
        try {
            const res = await apiCreateTontine(newGroupName, parseFloat(newGroupContribution), newGroupFrequency);
            Alert.alert("Félicitations", res.message || "Votre club a été créé avec succès.");
            setCreateModalVisible(false);
            setNewGroupName('');
            setNewGroupContribution('');
            loadData();
        } catch (e: any) {
            Alert.alert("Erreur", e.message || "Erreur lors de la création.");
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
                        <View key={p.id} style={styles.cardActive}>
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

                            <Text style={styles.statusText}>Statut Participation: {p.status}</Text>
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Clubs Disponibles</Text>
                    <TouchableOpacity onPress={() => setCreateModalVisible(true)} style={styles.createBtn}>
                        <Ionicons name="add" size={20} color="#FFF" />
                        <Text style={styles.createBtnText}>Créer</Text>
                    </TouchableOpacity>
                </View>

                {groups.filter(g => !myParticipations.find(m => m.tontineGroupId === g.id)).length === 0 ? (
                    <Text style={styles.emptyText}>Aucun nouveau club disponible pour le moment.</Text>
                ) : (
                    groups.filter(g => !myParticipations.find(m => m.tontineGroupId === g.id)).map(g => (
                        <View key={g.id} style={styles.card}>
                            <View style={styles.cardHeader}>
                                <Text style={styles.cardTitle}>{g.name}</Text>
                                <View style={styles.participantsBadge}>
                                    <Ionicons name="people" size={14} color="#208AEF" style={{ marginRight: 4 }} />
                                    <Text style={styles.participantsText}>{g._count.participants}/10</Text>
                                </View>
                            </View>
                            <Text style={styles.cardDesc}>
                                Cotisation de <Text style={styles.bold}>{g.contribution} FCFA</Text> {g.frequency === 'MONTHLY' ? 'mensuels' : 'hebdomadaires'}.
                            </Text>
                            <TouchableOpacity style={styles.joinBtn} onPress={() => handleJoin(g.id, g.name, g.contribution)}>
                                <Text style={styles.joinBtnText}>Rejoindre le club</Text>
                            </TouchableOpacity>
                        </View>
                    ))
                )}
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
