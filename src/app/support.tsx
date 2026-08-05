import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';
import { apiCreateReclamation, apiGetReclamations } from '../services/api';

export default function SupportScreen() {
    const router = useRouter();
    const COLORS = useAppTheme();
    const [reclamations, setReclamations] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [showForm, setShowForm] = useState(false);

    useEffect(() => {
        loadReclamations();
    }, []);

    const loadReclamations = async () => {
        try {
            const data = await apiGetReclamations();
            setReclamations(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!title.trim() || !description.trim()) {
            Alert.alert("Erreur", "Veuillez remplir tous les champs.");
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await apiCreateReclamation(title, description);
            setReclamations([res.reclamation, ...reclamations]);
            setShowForm(false);
            setTitle('');
            setDescription('');
            Alert.alert("Succès", "Votre ticket a été envoyé au service client.");
        } catch (e: any) {
            Alert.alert("Erreur", e.message || "Erreur lors de l'envoi");
        } finally {
            setIsSubmitting(false);
        }
    };

    const renderItem = ({ item }: { item: any }) => {
        const isOpen = item.status === 'OPEN';
        return (
            <View style={styles.ticketCard}>
                <View style={styles.ticketHeader}>
                    <Text style={styles.ticketTitle}>{item.title}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: isOpen ? '#FEF3C7' : '#D1FAE5' }]}>
                        <Text style={[styles.statusText, { color: isOpen ? '#D97706' : '#059669' }]}>
                            {isOpen ? 'EN COURS' : 'RÉSOLU'}
                        </Text>
                    </View>
                </View>
                <Text style={styles.ticketDesc}>{item.description}</Text>
                <Text style={styles.ticketDate}>{new Date(item.createdAt).toLocaleString('fr-FR')}</Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: '#f8fafc' }]}>
            <View style={[styles.header, { backgroundColor: COLORS.surface }]}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Service Client</Text>
                <View style={{ width: 28 }} />
            </View>

            <View style={styles.content}>
                {showForm ? (
                    <View style={styles.formContainer}>
                        <Text style={styles.formLabel}>Quel est le problème ?</Text>
                        <TextInput
                            style={styles.inputTitle}
                            placeholder="Sujet (ex: Transfert non reçu)"
                            value={title}
                            onChangeText={setTitle}
                        />
                        <TextInput
                            style={styles.inputDesc}
                            placeholder="Décrivez votre problème en détail..."
                            value={description}
                            onChangeText={setDescription}
                            multiline
                            numberOfLines={5}
                            textAlignVertical="top"
                        />
                        <View style={styles.formActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                                <Text style={styles.cancelBtnText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.submitBtn, { backgroundColor: COLORS.primary }]} onPress={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Envoyer</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <>
                        <TouchableOpacity style={[styles.newTicketBtn, { backgroundColor: COLORS.primary }]} onPress={() => setShowForm(true)}>
                            <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.newTicketBtnText}>Nouvelle Demande</Text>
                        </TouchableOpacity>

                        {loading ? (
                            <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 40 }} />
                        ) : reclamations.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="shield-checkmark-outline" size={64} color="#cbd5e1" />
                                <Text style={styles.emptyText}>Aucune réclamation. Tout va bien !</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={reclamations}
                                keyExtractor={(item) => item.id}
                                renderItem={renderItem}
                                contentContainerStyle={{ paddingBottom: 40 }}
                                showsVerticalScrollIndicator={false}
                            />
                        )}
                    </>
                )}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backBtn: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a1d2e' },
    content: { flex: 1, padding: 20 },
    newTicketBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, borderRadius: 16, marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 3 },
    newTicketBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    ticketCard: { backgroundColor: '#fff', padding: 20, borderRadius: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    ticketTitle: { fontSize: 16, fontWeight: '700', color: '#1a1d2e', flex: 1, marginRight: 12 },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusText: { fontSize: 11, fontWeight: '800' },
    ticketDesc: { fontSize: 14, color: '#475569', lineHeight: 22, marginBottom: 12 },
    ticketDate: { fontSize: 12, color: '#94a3b8' },
    emptyState: { alignItems: 'center', marginTop: 60 },
    emptyText: { fontSize: 15, color: '#94a3b8', marginTop: 16 },
    formContainer: { backgroundColor: '#fff', padding: 20, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
    formLabel: { fontSize: 16, fontWeight: '700', color: '#1a1d2e', marginBottom: 16 },
    inputTitle: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0' },
    inputDesc: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, fontSize: 15, marginBottom: 24, borderWidth: 1, borderColor: '#e2e8f0', minHeight: 120 },
    formActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    cancelBtn: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: '#f1f5f9', alignItems: 'center' },
    cancelBtnText: { color: '#64748b', fontWeight: '700', fontSize: 15 },
    submitBtn: { flex: 2, padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 }
});
