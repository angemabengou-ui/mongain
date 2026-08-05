import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
        <SafeAreaView style={[styles.safeArea, { backgroundColor: '#f8fafc' }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Envoyer de l'argent</Text>
                    <TouchableOpacity style={styles.qrButton} onPress={() => router.push('/qr')}>
                        <Ionicons name="qr-code-outline" size={24} color={COLORS.primary} />
                    </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 150 }]} keyboardShouldPersistTaps="handled">

                    <View style={styles.heroSection}>
                        <View style={styles.iconCircle}>
                            <Ionicons name="send" size={32} color={COLORS.primary} />
                        </View>
                        <Text style={styles.heroTitle}>À qui souhaitez-vous envoyer ?</Text>
                        <Text style={styles.heroSub}>Saisissez un numéro ou choisissez un contact depuis votre répertoire.</Text>
                    </View>

                    {/* Saisie manuelle */}
                    <Text style={styles.inputLabel}>Numéro de téléphone</Text>
                    <View style={[styles.inputContainer, (isLooking || recipient) ? styles.inputActive : null]}>
                        <Text style={styles.prefix}>+241</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Ex: 077... ou 066..."
                            keyboardType="phone-pad"
                            placeholderTextColor="#94a3b8"
                            value={phone}
                            onChangeText={setPhone}
                            autoFocus
                        />
                        {isLooking ? (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ padding: 8 }} />
                        ) : phone.length > 0 ? (
                            <TouchableOpacity onPress={() => { setPhone(''); setRecipient(null); setLookupError(''); }} style={{ padding: 8 }}>
                                <Ionicons name="close-circle" size={22} color="#94a3b8" />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity onPress={handleContactSelect} style={{ padding: 8 }}>
                                <Ionicons name="call" size={22} color={COLORS.primary} />
                            </TouchableOpacity>
                        )}
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
                            opacity: cardAnim,
                            transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }]
                        }]}>
                            <View style={styles.recipientHeader}>
                                <View style={styles.recipientAvatar}>
                                    <Text style={styles.recipientInitial}>
                                        {recipient.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                    </Text>
                                </View>
                                <View style={styles.recipientInfo}>
                                    <Text style={styles.recipientName}>{recipient.name}</Text>
                                    <Text style={styles.recipientPhone}>{recipient.phone}</Text>
                                </View>
                                <View style={styles.checkBadge}>
                                    <Ionicons name="checkmark" size={16} color="#059669" />
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
                        style={[styles.sendButton, !recipient && { backgroundColor: '#cbd5e1', shadowOpacity: 0 }]}
                        onPress={handleContinue}
                        disabled={!recipient}
                    >
                        <Text style={[styles.sendButtonText, !recipient && { color: '#ffffff' }]}>Continuer vers le montant</Text>
                        {recipient && <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />}
                    </TouchableOpacity>

                </ScrollView>

                <Modal
                    visible={contactsModalVisible}
                    animationType="slide"
                    presentationStyle="formSheet"
                    onRequestClose={() => setContactsModalVisible(false)}
                >
                    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
                        <View style={styles.header}>
                            <TouchableOpacity onPress={() => setContactsModalVisible(false)} style={styles.backButton}>
                                <Ionicons name="close" size={28} color={COLORS.textPrimary} />
                            </TouchableOpacity>
                            <Text style={styles.headerTitle}>Mes Contacts</Text>
                            <View style={{ width: 44 }} />
                        </View>
                        <View style={{ padding: 16 }}>
                            <TextInput
                                style={{ backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 16, height: 48, borderColor: '#e2e8f0', borderWidth: 1, fontSize: 16, color: '#0f172a' }}
                                placeholder="Rechercher par nom..."
                                placeholderTextColor="#94a3b8"
                                value={searchContact}
                                onChangeText={setSearchContact}
                            />
                        </View>
                        <FlatList
                            data={contactsList.filter(c => c.name?.toLowerCase().includes(searchContact.toLowerCase()))}
                            keyExtractor={(item, index) => (item as any).id || index.toString()}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={{ flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', backgroundColor: '#fff' }}
                                    onPress={() => item.phoneNumbers && pickContact(item.phoneNumbers[0].number || '')}
                                >
                                    <View style={[styles.recipientAvatar, { width: 40, height: 40, borderRadius: 20 }]}>
                                        <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.primary }}>
                                            {(item.name || '?').charAt(0).toUpperCase()}
                                        </Text>
                                    </View>
                                    <View style={{ marginLeft: 12, justifyContent: 'center' }}>
                                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#1e293b' }}>{item.name}</Text>
                                        <Text style={{ fontSize: 14, color: '#64748b' }}>{item.phoneNumbers?.[0]?.number}</Text>
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
    qrButton: { padding: 8, marginRight: -12, backgroundColor: '#e0f2fe', borderRadius: 40 },
    headerTitle: { color: '#1a1d2e', fontSize: 18, fontWeight: '700' },
    content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 154 },
    heroSection: { alignItems: 'center', marginBottom: 32 },
    iconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e0f2fe', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    heroTitle: { fontSize: 22, fontWeight: '800', color: '#1a1d2e', marginBottom: 8, textAlign: 'center' },
    heroSub: { fontSize: 15, color: '#64748b', textAlign: 'center', lineHeight: 22, paddingHorizontal: 10 },

    inputLabel: { fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 8, marginLeft: 4 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
        borderRadius: 16, paddingHorizontal: 16, height: 60, marginBottom: 16,
        borderWidth: 1.5, borderColor: '#e2e8f0',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 2
    },
    inputActive: { borderColor: '#1DC5E9', backgroundColor: '#f0f9ff' },
    prefix: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginRight: 12, paddingRight: 12, borderRightWidth: 1, borderRightColor: '#cbd5e1' },
    input: { flex: 1, fontSize: 18, color: '#0f172a', fontWeight: '600', height: '100%', letterSpacing: 1 },

    errorBox: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2',
        borderRadius: 12, padding: 16, marginVertical: 8, gap: 10,
    },
    errorText: { color: '#E11D48', fontSize: 14, flex: 1, fontWeight: '500', lineHeight: 20 },

    recipientCard: {
        backgroundColor: '#ffffff', borderRadius: 20, padding: 20, marginTop: 12,
        borderWidth: 1, borderColor: '#D1FAE5',
        shadowColor: '#10B981', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 8
    },
    recipientHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    recipientAvatar: {
        width: 52, height: 52, borderRadius: 26,
        backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center',
    },
    recipientInitial: { fontSize: 20, fontWeight: '800', color: '#059669' },
    recipientInfo: { flex: 1 },
    recipientName: { fontSize: 18, fontWeight: '800', color: '#1a1d2e', marginBottom: 4 },
    recipientPhone: { fontSize: 14, color: '#64748b', fontWeight: '500' },
    checkBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#A7F3D0', justifyContent: 'center', alignItems: 'center' },
    merchantBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignSelf: 'flex-start', marginTop: 16, gap: 6 },
    merchantText: { color: '#D97706', fontSize: 12, fontWeight: '700' },

    sendButton: {
        backgroundColor: '#1DC5E9', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 60, borderRadius: 16,
        shadowColor: '#1DC5E9', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8,
    },
    sendButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
});
