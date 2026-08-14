import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { apiLookupUser } from '../services/api';

export default function TransferScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();
    const [phone, setPhone] = useState('');
    const [recipient, setRecipient] = useState<{ id: string; name: string; phone: string; role?: string } | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [isLooking, setIsLooking] = useState(false);

    // Contact Picker State
    const [contactsModalVisible, setContactsModalVisible] = useState(false);
    const [contactsList, setContactsList] = useState<Contacts.Contact[]>([]);
    const [searchContact, setSearchContact] = useState('');

    // Animation de la carte destinataire
    const cardAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(cardAnim, {
            toValue: recipient ? 1 : 0,
            duration: 250,
            useNativeDriver: true,
        }).start();
    }, [recipient]);

    // Lookup automatique quand le numéro a au moins 8 chiffres
    useEffect(() => {
        const cleaned = phone.replace(/\s/g, '');
        if (cleaned.length < 8) {
            setRecipient(null);
            setLookupError('');
            return;
        }

        const timer = setTimeout(async () => {
            setIsLooking(true);
            setLookupError('');
            setRecipient(null);
            try {
                const fullPhone = cleaned.startsWith('+') ? cleaned : `+241${cleaned}`;
                const found = await apiLookupUser(fullPhone);
                setRecipient(found);
            } catch (e: any) {
                setLookupError(e.message);
            } finally {
                setIsLooking(false);
            }
        }, 600); // debounce 600ms

        return () => clearTimeout(timer);
    }, [phone]);

    const handleContinue = () => {
        if (!recipient) return;
        router.push({
            pathname: '/transfer-confirm',
            params: { receiverPhone: recipient.phone, receiverName: recipient.name, isMerchant: recipient.role === 'MERCHANT' ? 'true' : 'false' },
        });
    };

    const handleContactSelect = async () => {
        const { status } = await Contacts.requestPermissionsAsync();
        if (status === 'granted') {
            const { data } = await Contacts.getContactsAsync({
                fields: [Contacts.Fields.PhoneNumbers],
                sort: Contacts.SortTypes.FirstName,
            });
            setContactsList(data.filter(c => c.phoneNumbers && c.phoneNumbers.length > 0));
            setContactsModalVisible(true);
        }
    };

    const pickContact = (phoneString: string) => {
        setContactsModalVisible(false);
        let cPhone = phoneString.replace(/\D/g, ''); // enlever espaces
        if (cPhone.startsWith('241')) cPhone = cPhone.slice(3);
        if (cPhone.startsWith('0')) cPhone = cPhone.slice(1);
        setPhone(cPhone);
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

                {/* Header Clean, sans bouton caché */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Envoyer de l'argent</Text>
                    <View style={{ width: 44 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                    {/* Grille d'Actions Massives */}
                    <View style={styles.actionGrid}>
                        <TouchableOpacity style={[styles.actionCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]} onPress={() => router.push('/qr')}>
                            <View style={[styles.actionIconWrap, { backgroundColor: '#3B82F615' }]}>
                                <Ionicons name="qr-code" size={28} color="#3B82F6" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: COLORS.textPrimary }]}>Scanner QR</Text>
                            <Text style={styles.actionCardSub}>Instantané</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.actionCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]} onPress={handleContactSelect}>
                            <View style={[styles.actionIconWrap, { backgroundColor: '#8B5CF615' }]}>
                                <Ionicons name="people" size={28} color="#8B5CF6" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: COLORS.textPrimary }]}>Mes Contacts</Text>
                            <Text style={styles.actionCardSub}>Répertoire</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.sectionTitle}>Saisie Manuelle</Text>

                    {/* Saisie manuelle Modernisée */}
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }, (isLooking || recipient) ? { borderColor: COLORS.primary } : null]}>
                        <Text style={[styles.prefix, { color: COLORS.textPrimary }]}>+241</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="Ex: 077..."
                            keyboardType="phone-pad"
                            placeholderTextColor={COLORS.textSecondary}
                            value={phone}
                            onChangeText={setPhone}
                        />
                        {isLooking ? (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ padding: 8 }} />
                        ) : phone.length > 0 ? (
                            <TouchableOpacity onPress={() => { setPhone(''); setRecipient(null); setLookupError(''); }} style={{ padding: 8 }}>
                                <Ionicons name="close-circle" size={22} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        ) : null}
                    </View>

                    {/* Ligne d'erreur */}
                    {lookupError ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle" size={20} color="#E11D48" />
                            <Text style={styles.errorText}>{lookupError}</Text>
                        </View>
                    ) : null}

                    {/* Carte Destinataire Validé */}
                    {recipient && (
                        <Animated.View style={[styles.recipientCard, {
                            borderColor: COLORS.primary + '40',
                            backgroundColor: COLORS.primary + '05',
                            opacity: cardAnim,
                            transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }]
                        }]}>
                            <View style={styles.recipientHeader}>
                                <View style={[styles.recipientAvatar, { backgroundColor: COLORS.primary + '20' }]}>
                                    <Text style={[styles.recipientInitial, { color: COLORS.primary }]}>
                                        {recipient.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                    </Text>
                                </View>
                                <View style={styles.recipientInfo}>
                                    <Text style={[styles.recipientName, { color: COLORS.textPrimary }]}>{recipient.name}</Text>
                                    <Text style={styles.recipientPhone}>{recipient.phone}</Text>
                                </View>
                                <View style={[styles.checkBadge, { backgroundColor: COLORS.primary }]}>
                                    <Ionicons name="checkmark" size={16} color="#fff" />
                                </View>
                            </View>
                            {recipient.role === 'MERCHANT' && (
                                <View style={styles.merchantBadge}>
                                    <Ionicons name="business" size={14} color="#D97706" />
                                    <Text style={styles.merchantText}>Compte Marchand</Text>
                                </View>
                            )}
                        </Animated.View>
                    )}

                    <View style={{ flex: 1 }} />

                    {/* Bouton Continuer */}
                    <TouchableOpacity
                        style={[styles.sendButton, !recipient && { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, shadowOpacity: 0 }, recipient && { backgroundColor: COLORS.primary }]}
                        onPress={handleContinue}
                        disabled={!recipient}
                    >
                        <Text style={[styles.sendButtonText, !recipient ? { color: COLORS.textSecondary } : { color: '#ffffff' }]}>Continuer vers le montant</Text>
                        {recipient && <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />}
                    </TouchableOpacity>

                </ScrollView>

                {/* MODAL CONTACTS (Même logique, styles propres) */}
                <Modal
                    visible={contactsModalVisible}
                    animationType="slide"
                    presentationStyle="formSheet"
                    onRequestClose={() => setContactsModalVisible(false)}
                >
                    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
                        <View style={styles.header}>
                            <TouchableOpacity onPress={() => setContactsModalVisible(false)} style={styles.backButton}>
                                <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                            </TouchableOpacity>
                            <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Mes Contacts</Text>
                            <View style={{ width: 44 }} />
                        </View>
                        <View style={{ padding: 16 }}>
                            <TextInput
                                style={[styles.searchInput, { backgroundColor: COLORS.surface, borderColor: COLORS.border, color: COLORS.textPrimary }]}
                                placeholder="Rechercher un nom..."
                                placeholderTextColor={COLORS.textSecondary}
                                value={searchContact}
                                onChangeText={setSearchContact}
                            />
                        </View>
                        <FlatList
                            data={contactsList.filter(c => c.name?.toLowerCase().includes(searchContact.toLowerCase()))}
                            keyExtractor={(item, index) => (item as any).id || index.toString()}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={[styles.contactRow, { backgroundColor: COLORS.surface, borderBottomColor: COLORS.border }]}
                                    onPress={() => item.phoneNumbers && pickContact(item.phoneNumbers[0].number || '')}
                                >
                                    <View style={[styles.contactAvatar, { backgroundColor: COLORS.primary + '15' }]}>
                                        <Text style={{ fontSize: 16, fontWeight: '800', color: COLORS.primary }}>
                                            {(item.name || '?').charAt(0).toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={{ marginLeft: 12, justifyContent: 'center' }}>
                                        <Text style={[styles.contactName, { color: COLORS.textPrimary }]}>{item.name}</Text>
                                        <Text style={styles.contactPhone}>{item.phoneNumbers?.[0]?.number}</Text>
                                    </View>
                                </TouchableOpacity>
                            )}
                        />
                    </SafeAreaView>
                </Modal>

            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
    },
    backButton: { padding: 8, marginLeft: -12 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 60 },

    actionGrid: { flexDirection: 'row', gap: 16, marginBottom: 32 },
    actionCard: { flex: 1, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1 },
    actionIconWrap: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    actionCardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    actionCardSub: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },

    sectionTitle: { fontSize: 14, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12, marginLeft: 4, letterSpacing: 1 },

    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 16, paddingHorizontal: 16, height: 60, marginBottom: 16,
        borderWidth: 1.5,
    },
    prefix: { fontSize: 17, fontWeight: '800', marginRight: 12, paddingRight: 12, borderRightWidth: 1, borderRightColor: '#e2e8f0' },
    input: { flex: 1, fontSize: 18, fontWeight: '700', height: '100%', letterSpacing: 1 },

    errorBox: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2',
        borderRadius: 12, padding: 16, marginVertical: 8, gap: 10,
    },
    errorText: { color: '#E11D48', fontSize: 14, flex: 1, fontWeight: '500', lineHeight: 20 },

    recipientCard: {
        borderRadius: 20, padding: 20, marginTop: 12,
        borderWidth: 1,
    },
    recipientHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    recipientAvatar: {
        width: 52, height: 52, borderRadius: 26,
        justifyContent: 'center', alignItems: 'center',
    },
    recipientInitial: { fontSize: 20, fontWeight: '800' },
    recipientInfo: { flex: 1 },
    recipientName: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
    recipientPhone: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
    checkBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    merchantBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignSelf: 'flex-start', marginTop: 16, gap: 6 },
    merchantText: { color: '#D97706', fontSize: 12, fontWeight: '700' },

    sendButton: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 60, borderRadius: 16, marginTop: 32,
    },
    sendButtonText: { fontSize: 17, fontWeight: '800' },

    // Modal
    searchInput: { borderRadius: 12, paddingHorizontal: 16, height: 50, borderWidth: 1, fontSize: 16, fontWeight: '600' },
    contactRow: { flexDirection: 'row', padding: 16, borderBottomWidth: 1 },
    contactAvatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    contactName: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
    contactPhone: { fontSize: 14, color: '#94a3b8', fontWeight: '500' }
});
