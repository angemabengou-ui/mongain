import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { useAppTheme } from '../../constants/theme';
import { findMongainContacts, MongainContact } from '../../services/contacts';

// Sélecteur "qui de mes contacts est sur Mongain" (même principe que WhatsApp) — remplace
// la saisie manuelle d'un numéro par une liste pré-filtrée de comptes déjà inscrits, en
// comparant le carnet d'adresses du téléphone à la base Mongain côté serveur.
export default function ContactPickerModal({ visible, onClose, onSelect, colors }: {
    visible: boolean;
    onClose: () => void;
    onSelect: (contact: MongainContact) => void;
    colors: ReturnType<typeof useAppTheme>;
}) {
    const [loading, setLoading] = useState(false);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [contacts, setContacts] = useState<MongainContact[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [search, setSearch] = useState('');

    const load = async () => {
        setLoading(true);
        setPermissionDenied(false);
        setLoadError(false);
        try {
            const { granted, contacts: found } = await findMongainContacts();
            if (!granted) { setPermissionDenied(true); return; }
            setContacts(found);
            setLoaded(true);
        } catch {
            // Sans ce catch, un échec réseau (l'appel serveur derrière findMongainContacts)
            // laissait `contacts` vide sans jamais le signaler — l'écran "aucun contact sur
            // Mongain" s'affichait alors à tort, faisant croire à l'utilisateur qu'il n'a
            // vraiment personne sur l'app plutôt que la synchronisation a simplement échoué.
            setLoadError(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (visible && !loaded) load();
    }, [visible]);

    const filtered = contacts.filter((c) =>
        (c.contactName || c.name).toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    );

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <Ionicons name="close" size={26} color={colors.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>Mes contacts sur Mongain</Text>
                    <View style={{ width: 40 }} />
                </View>

                {!permissionDenied && !loading && contacts.length > 0 && (
                    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                        <TextInput
                            style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
                            placeholder="Rechercher..."
                            placeholderTextColor={colors.textSecondary}
                            value={search}
                            onChangeText={setSearch}
                        />
                    </View>
                )}

                {loading ? (
                    <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
                ) : permissionDenied ? (
                    <View style={styles.center}>
                        <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            Autorisez l'accès à vos contacts pour voir qui est déjà sur Mongain.
                        </Text>
                        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={load}>
                            <Text style={styles.retryBtnText}>Autoriser l'accès</Text>
                        </TouchableOpacity>
                    </View>
                ) : loadError ? (
                    <View style={styles.center}>
                        <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            Impossible de vérifier vos contacts pour l'instant. Vérifiez votre connexion et réessayez.
                        </Text>
                        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={load}>
                            <Text style={styles.retryBtnText}>Réessayer</Text>
                        </TouchableOpacity>
                    </View>
                ) : filtered.length === 0 ? (
                    <View style={styles.center}>
                        <Ionicons name="people-outline" size={40} color={colors.textSecondary} />
                        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                            {contacts.length === 0 ? "Aucun de vos contacts n'a de compte Mongain pour l'instant." : 'Aucun résultat.'}
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={filtered}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item }) => (
                            <TouchableOpacity style={[styles.row, { borderBottomColor: colors.border }]} onPress={() => onSelect(item)}>
                                <View style={[styles.avatar, { backgroundColor: colors.primary + '18' }]}>
                                    <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>
                                        {(item.contactName || item.name).charAt(0).toUpperCase()}
                                    </Text>
                                </View>
                                <View style={{ marginLeft: 12, flex: 1 }}>
                                    <Text style={[styles.name, { color: colors.textPrimary }]}>{item.contactName || item.name}</Text>
                                    <Text style={[styles.phone, { color: colors.textSecondary }]}>{item.phone}</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                            </TouchableOpacity>
                        )}
                    />
                )}
            </SafeAreaView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
    closeBtn: { width: 40 },
    title: { fontSize: 17, fontWeight: '800' },
    search: { borderRadius: 12, borderWidth: 1, height: 44, paddingHorizontal: 14, fontSize: 15 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 },
    emptyText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
    retryBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
    retryBtnText: { color: '#fff', fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
    avatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    name: { fontSize: 15, fontWeight: '700' },
    phone: { fontSize: 13, marginTop: 2 },
});
